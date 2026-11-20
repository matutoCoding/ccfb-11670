/**
 * 光学分析(CPU 参考追踪器):
 * - 亮度:均匀白光环境下返回观察方向的光通量
 * - 火彩:红/蓝波长出射方向的角度分离(色散)
 * - 闪烁:视角微动时返回光强的变化率
 * - 漏光:从冠部入射却从亭部向下逃逸的能量,按刻面归属
 */
import { Gem } from '../geometry/gem';
import { traceRay } from '../physics/raytrace';
import { diamondIOR } from '../physics/optics';
import { Vec3, normalize, angleDeg } from '../math/vec3';
import { envColor, EnvType } from '../render/env';

export interface AnalysisResult {
  /** 0-100,100 = 入射光全部返回上半球 */
  brightness: number;
  /** 0-100,色散角分离加权平均,3° 记满分 */
  fire: number;
  /** 0-100,±2° 转动时强度显著变化的像素比例 */
  scintillation: number;
  /** 漏光能量占进入能量百分比 */
  leakagePct: number;
  /** 光返回图(所选环境下看到的亮度分布),RGB 线性 */
  lightReturn: { width: number; height: number; data: Float32Array };
  /** 每个刻面的漏出能量(用于漏光图着色) */
  facetLeakEnergy: Float32Array;
  /** 每个刻面的返回能量 */
  facetReturnEnergy: Float32Array;
  /** 进入宝石的总能量(菲涅尔透射后) */
  totalEntryEnergy: number;
}

const GREEN_NM = 546.1;
const RED_NM = 656.3;
const BLUE_NM = 486.1;

/** 观察方向(从宝石指向观察者,略偏离正上方) */
const VIEW_DIR: Vec3 = normalize([0, 1, 0.12]);

interface GridRay {
  ro: Vec3;
  rd: Vec3;
}

/** 生成覆盖宝石轮廓的正交平行光线网格(光线从观察者一侧射向宝石) */
function makeGrid(gem: Gem, viewDir: Vec3, n: number, yawOffsetDeg = 0): GridRay[] {
  const up: Vec3 = Math.abs(viewDir[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  const right = normalize([
    viewDir[1] * up[2] - viewDir[2] * up[1],
    viewDir[2] * up[0] - viewDir[0] * up[2],
    viewDir[0] * up[1] - viewDir[1] * up[0],
  ]);
  const up2: Vec3 = [
    right[1] * viewDir[2] - right[2] * viewDir[1],
    right[2] * viewDir[0] - right[0] * viewDir[2],
    right[0] * viewDir[1] - right[1] * viewDir[0],
  ];
  // 轮廓半径:从网格顶点直接量(椭圆长轴也能覆盖)
  let maxR = 0;
  for (let i = 0; i < gem.meshPositions.length; i += 3) {
    maxR = Math.max(maxR, Math.hypot(gem.meshPositions[i], gem.meshPositions[i + 2]));
  }
  const extent = 1.1 * maxR;
  const back = 3; // 起点沿观察方向后撤距离
  const inDir: Vec3 = [-viewDir[0], -viewDir[1], -viewDir[2]]; // 光线行进方向(射向宝石)
  const rays: GridRay[] = [];
  const yaw = (yawOffsetDeg * Math.PI) / 180;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = ((i + 0.5) / n) * 2 - 1;
      const v = ((j + 0.5) / n) * 2 - 1;
      let px = (right[0] * u + up2[0] * v) * extent + viewDir[0] * back;
      let pz = (right[2] * u + up2[2] * v) * extent + viewDir[2] * back;
      const py = (right[1] * u + up2[1] * v) * extent + viewDir[1] * back;
      let rd = inDir;
      if (yawOffsetDeg !== 0) {
        const rx = px * cy - pz * sy;
        const rz = px * sy + pz * cy;
        px = rx; pz = rz;
        rd = [inDir[0] * cy - inDir[2] * sy, inDir[1], inDir[0] * sy + inDir[2] * cy];
      }
      rays.push({ ro: [px, py, pz], rd });
    }
  }
  return rays;
}

/** 单波长光返回强度图(均匀白光 env=1,只统计返回上半球的光) */
function returnIntensity(gem: Gem, rays: GridRay[], ior: number): Float32Array {
  const out = new Float32Array(rays.length);
  for (let i = 0; i < rays.length; i++) {
    const r = traceRay(gem.planes, rays[i].ro, rays[i].rd, ior, 12);
    if (r.hit && r.exitDir && r.exitDir[1] > 0) out[i] = r.throughput;
  }
  return out;
}

export async function analyzeGem(
  gem: Gem,
  envType: EnvType,
  gridN = 128,
  onProgress?: (frac: number, stage: string) => void,
): Promise<AnalysisResult> {
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));
  const n = gridN;
  const rays = makeGrid(gem, VIEW_DIR, n);

  // 1) 三波长追踪:光返回图 + 漏光归属 + 火彩
  onProgress?.(0.05, '追踪三波长光线');
  const iorR = diamondIOR(RED_NM);
  const iorG = diamondIOR(GREEN_NM);
  const iorB = diamondIOR(BLUE_NM);
  const image = new Float32Array(n * n * 3);
  const facetLeak = new Float32Array(gem.facets.length);
  const facetReturn = new Float32Array(gem.facets.length);
  let entrySum = 0;
  let hitCount = 0;
  let leakSum = 0;
  let returnSum = 0;
  let fireNum = 0; // 色散角 × 权重
  let fireDen = 0;

  for (let i = 0; i < rays.length; i++) {
    const { ro, rd } = rays[i];
    const rR = traceRay(gem.planes, ro, rd, iorR, 12);
    const rG = traceRay(gem.planes, ro, rd, iorG, 12);
    const rB = traceRay(gem.planes, ro, rd, iorB, 12);
    if (!rG.hit) continue;
    hitCount++;
    entrySum += 1; // 每条命中光线携带单位能量

    // 光返回图:所选环境
    const er = rR.exitDir ? envColor(rR.exitDir, envType) : [0, 0, 0];
    const eg = rG.exitDir ? envColor(rG.exitDir, envType) : [0, 0, 0];
    const eb = rB.exitDir ? envColor(rB.exitDir, envType) : [0, 0, 0];
    image[i * 3] = rR.throughput * er[0];
    image[i * 3 + 1] = rG.throughput * eg[1];
    image[i * 3 + 2] = rB.throughput * eb[2];

    // 漏光/返回归属(以绿光为准)
    if (rG.exitDir && rG.exitFacetIndex >= 0) {
      if (rG.exitDir[1] > 0) {
        facetReturn[rG.exitFacetIndex] += rG.throughput;
        returnSum += rG.throughput;
      } else {
        facetLeak[rG.exitFacetIndex] += rG.throughput;
        leakSum += rG.throughput;
      }
    }
    // 火彩:红蓝出射方向角分离
    if (rR.exitDir && rB.exitDir && rR.exitDir[1] > 0 && rB.exitDir[1] > 0) {
      const sep = angleDeg(rR.exitDir, rB.exitDir);
      const w = Math.min(rR.throughput, rB.throughput);
      fireNum += sep * w;
      fireDen += w;
    }
    if ((i & 0x3ff) === 0) {
      onProgress?.(0.05 + 0.55 * (i / rays.length), '追踪三波长光线');
      await tick();
    }
  }

  // 2) 亮度:返回上半球的能量 / 命中光线数(理想全内反射钻石约 0.65,归一到 100)
  const brightness = hitCount > 0 ? Math.min(100, (returnSum / hitCount) * 100 * 1.45) : 0;

  // 3) 闪烁:±2° 转动的强度变化
  onProgress?.(0.7, '计算闪烁');
  await tick();
  const coarse = 64;
  const i0 = returnIntensity(gem, makeGrid(gem, VIEW_DIR, coarse, -2), iorG);
  const i1 = returnIntensity(gem, makeGrid(gem, VIEW_DIR, coarse, 2), iorG);
  let changed = 0;
  let lit = 0;
  for (let i = 0; i < i0.length; i++) {
    const m = Math.max(i0[i], i1[i]);
    if (m > 0.02) {
      lit++;
      if (Math.abs(i0[i] - i1[i]) / m > 0.25) changed++;
    }
  }
  const scintillation = lit > 0 ? (changed / lit) * 100 : 0;

  onProgress?.(0.9, '汇总');
  await tick();

  const fire = fireDen > 0 ? Math.min(100, (fireNum / fireDen / 3) * 100) : 0;
  const totalExit = returnSum + leakSum;
  const leakagePct = totalExit > 0 ? (leakSum / totalExit) * 100 : 0;

  onProgress?.(1, '完成');
  return {
    brightness,
    fire,
    scintillation,
    leakagePct,
    lightReturn: { width: n, height: n, data: image },
    facetLeakEnergy: facetLeak,
    facetReturnEnergy: facetReturn,
    totalEntryEnergy: entrySum,
  };
}

/** 漏光图刻面颜色:红=漏光,绿=返回,灰=无贡献 */
export function facetLeakColors(result: AnalysisResult): Float32Array {
  const n = result.facetLeakEnergy.length;
  const colors = new Float32Array(n * 3);
  let maxE = 0;
  for (let i = 0; i < n; i++) {
    maxE = Math.max(maxE, result.facetLeakEnergy[i] + result.facetReturnEnergy[i]);
  }
  for (let i = 0; i < n; i++) {
    const leak = result.facetLeakEnergy[i];
    const ret = result.facetReturnEnergy[i];
    const tot = leak + ret;
    if (tot < maxE * 0.01) {
      colors.set([0.35, 0.35, 0.38], i * 3);
    } else {
      const leakFrac = leak / tot;
      const intensity = 0.3 + 0.7 * (tot / maxE);
      colors.set([
        intensity * (0.25 + 0.75 * leakFrac),
        intensity * (0.25 + 0.75 * (1 - leakFrac)),
        intensity * 0.25,
      ], i * 3);
    }
  }
  return colors;
}
