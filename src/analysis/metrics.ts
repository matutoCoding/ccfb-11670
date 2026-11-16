import { GemGeometry } from '../geometry/cuts';
import { traceRay } from '../optics/raytrace';
import { iorCauchy } from '../optics/snell';
import { Vec3, normalize, cross, dot } from '../optics/vec3';

/**
 * 光学分析：基于 CPU 参考追踪器（与单元测试验证过的物理完全一致）。
 * 从观察方向正交投影光线束穿过宝石，按光路互易分析出光/漏光/色散。
 */

export interface AnalysisResult {
  /** 出光图（返回光通量 0..1），row-major，size×size */
  returnMap: Float32Array;
  /** 火彩图（色散角·通量，度） */
  fireMap: Float32Array;
  /** 漏光图（向下逃逸光通量 0..1） */
  leakMap: Float32Array;
  /** 命中掩码 */
  hitMask: Uint8Array;
  size: number;
  /** 各刻面统计（与 geometry.facets 对齐） */
  facetStats: { returned: number; leaked: number; rays: number }[];
  scores: {
    brightness: number;    // 亮度 0-100
    fire: number;          // 火彩 0-100
    scintillation: number; // 闪烁 0-100
    lightReturn: number;   // 出光率 %
    leakage: number;       // 漏光率 %
  };
}

export interface AnalysisOptions {
  size: number;
  cauchyA: number;
  cauchyB: number;
  maxBounces: number;
  /** 观察方向（从宝石指向相机的单位向量），默认正上方 */
  viewDir?: Vec3;
  /** 转台角（弧度） */
  turntable?: number;
  /** 闪烁采样方位数（0 = 跳过） */
  scintillationSteps?: number;
  /** 进度回调 0..1，返回 false 取消 */
  onProgress?: (f: number) => boolean | void;
}

const WAVELENGTHS = [470, 550, 650];

function rotY(v: Vec3, cosA: number, sinA: number): Vec3 {
  return [cosA * v[0] - sinA * v[2], v[1], sinA * v[0] + cosA * v[2]];
}

interface PixelAcc {
  returned: number;
  leaked: number;
  fire: number;
  hit: boolean;
  entryFacet: number;
}

/** 对单个像素（一条观察光线）做光谱追踪 */
function tracePixel(
  origin: Vec3, dir: Vec3, geo: GemGeometry, viewDir: Vec3,
  ior: (l: number) => number, maxBounces: number,
): PixelAcc {
  const res = traceRay(origin, dir, geo.planes, {
    wavelengths: WAVELENGTHS, ior, maxBounces,
  });
  const acc: PixelAcc = { returned: 0, leaked: 0, fire: 0, hit: res.hit, entryFacet: res.entryFacet };
  if (!res.hit) return acc;

  if (dot(res.surfaceReflectDir, viewDir) > 0) acc.returned += res.surfaceReflectFlux;
  else acc.leaked += res.surfaceReflectFlux;

  // 按波长聚合出射方向（用于色散角计算）
  const perLambda = new Map<number, { flux: number; dir: Vec3 }>();
  for (const e of res.exits) {
    const towardViewer = dot(e.dir, viewDir) > 0;
    if (towardViewer) acc.returned += e.throughput;
    else acc.leaked += e.throughput;
    if (!towardViewer || e.throughput < 1e-4) continue;
    const cur = perLambda.get(e.lambda) ?? { flux: 0, dir: [0, 0, 0] as Vec3 };
    cur.flux += e.throughput;
    cur.dir = [
      cur.dir[0] + e.dir[0] * e.throughput,
      cur.dir[1] + e.dir[1] * e.throughput,
      cur.dir[2] + e.dir[2] * e.throughput,
    ];
    perLambda.set(e.lambda, cur);
  }
  // 火彩：蓝光(470nm)与红光(650nm)出射方向的夹角（度），按通量加权
  const blue = perLambda.get(WAVELENGTHS[0]);
  const red = perLambda.get(WAVELENGTHS[WAVELENGTHS.length - 1]);
  if (blue && red && blue.flux > 1e-3 && red.flux > 1e-3) {
    const nb = normalize(blue.dir);
    const nr = normalize(red.dir);
    const cosA = Math.min(1, Math.max(-1, nb[0] * nr[0] + nb[1] * nr[1] + nb[2] * nr[2]));
    acc.fire = ((Math.acos(cosA) * 180) / Math.PI) * Math.min(blue.flux, red.flux);
  }
  return acc;
}

interface Grid {
  center: Vec3;
  radius: number;
  right: Vec3;
  up: Vec3;
}

function makeGrid(geo: GemGeometry, viewDir: Vec3): Grid {
  const center: Vec3 = [
    (geo.bboxMin[0] + geo.bboxMax[0]) / 2,
    (geo.bboxMin[1] + geo.bboxMax[1]) / 2,
    (geo.bboxMin[2] + geo.bboxMax[2]) / 2,
  ];
  const radius = Math.max(
    geo.bboxMax[0] - geo.bboxMin[0],
    geo.bboxMax[1] - geo.bboxMin[1],
    geo.bboxMax[2] - geo.bboxMin[2],
  ) / 2 * 1.05;
  const up0: Vec3 = Math.abs(viewDir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const right = normalize(cross(viewDir, up0));
  const up = cross(right, viewDir);
  return { center, radius, right, up };
}

/** 追踪一整幅出光图（可附带火彩/漏光/刻面统计） */
function traceMap(
  geo: GemGeometry, grid: Grid, viewDir: Vec3, size: number,
  turntable: number, ior: (l: number) => number, maxBounces: number,
  out: { ret: Float32Array; fire?: Float32Array; leak?: Float32Array; mask?: Uint8Array },
  facetStats: { returned: number; leaked: number; rays: number }[] | null,
  rowRange: [number, number],
): void {
  const dir: Vec3 = [-viewDir[0], -viewDir[1], -viewDir[2]];
  const cosA = Math.cos(turntable), sinA = Math.sin(turntable);
  const viewStone = rotY(viewDir, cosA, sinA);
  const dStone = rotY(dir, cosA, sinA);
  for (let row = rowRange[0]; row < rowRange[1]; row++) {
    const v = (row / (size - 1)) * 2 - 1;
    for (let col = 0; col < size; col++) {
      const u = (col / (size - 1)) * 2 - 1;
      const o: Vec3 = [
        grid.center[0] + (grid.right[0] * u + grid.up[0] * v) * grid.radius - dir[0] * 5,
        grid.center[1] + (grid.right[1] * u + grid.up[1] * v) * grid.radius - dir[1] * 5,
        grid.center[2] + (grid.right[2] * u + grid.up[2] * v) * grid.radius - dir[2] * 5,
      ];
      const acc = tracePixel(rotY(o, cosA, sinA), dStone, geo, viewStone, ior, maxBounces);
      const idx = row * size + col;
      out.ret[idx] = acc.returned;
      if (out.fire) out.fire[idx] = acc.fire;
      if (out.leak) out.leak[idx] = acc.leaked;
      if (out.mask) out.mask[idx] = acc.hit ? 1 : 0;
      if (facetStats && acc.hit && acc.entryFacet >= 0) {
        const fs = facetStats[acc.entryFacet];
        fs.rays++;
        fs.returned += acc.returned;
        fs.leaked += acc.leaked;
      }
    }
  }
}

/** 运行完整光学分析（异步分块，避免阻塞 UI） */
export async function runAnalysis(geo: GemGeometry, opts: AnalysisOptions): Promise<AnalysisResult> {
  const size = opts.size;
  const viewDir = opts.viewDir ?? [0, 1, 0];
  const ior = (l: number) => iorCauchy(l, opts.cauchyA, opts.cauchyB);

  const returnMap = new Float32Array(size * size);
  const fireMap = new Float32Array(size * size);
  const leakMap = new Float32Array(size * size);
  const hitMask = new Uint8Array(size * size);
  const facetStats = geo.facets.map(() => ({ returned: 0, leaked: 0, rays: 0 }));

  const grid = makeGrid(geo, viewDir);
  const scintSteps = opts.scintillationSteps ?? 0;
  const sSize = scintSteps > 0 ? Math.max(32, size >> 1) : 0;
  const totalRows = size + scintSteps * sSize;
  let rowsDone = 0;

  // 主视角（含火彩/漏光/刻面统计）
  const CHUNK = 8;
  for (let r0 = 0; r0 < size; r0 += CHUNK) {
    traceMap(geo, grid, viewDir, size, opts.turntable ?? 0, ior, opts.maxBounces,
      { ret: returnMap, fire: fireMap, leak: leakMap, mask: hitMask }, facetStats,
      [r0, Math.min(size, r0 + CHUNK)]);
    rowsDone += CHUNK;
    if (opts.onProgress?.(rowsDone / totalRows) === false) throw new Error('cancelled');
    await new Promise((r) => setTimeout(r, 0));
  }

  // 闪烁：在一个对称周期（45°）内采样多个转台方位，逐像素算变异系数。
  // （整圈采样对 8 重对称切工会得到完全相同的图，测不出闪烁）
  let scintillation = 0;
  if (scintSteps > 0) {
    const maps: Float32Array[] = [];
    for (let s = 0; s < scintSteps; s++) {
      const angle = (s / scintSteps) * (Math.PI / 4);
      const map = new Float32Array(sSize * sSize);
      traceMap(geo, grid, viewDir, sSize, angle, ior, opts.maxBounces, { ret: map }, null, [0, sSize]);
      maps.push(map);
      rowsDone += sSize;
      if (opts.onProgress?.(rowsDone / totalRows) === false) throw new Error('cancelled');
      await new Promise((r) => setTimeout(r, 0));
    }
    let sum = 0, cnt = 0;
    for (let i = 0; i < maps[0].length; i++) {
      let mean = 0;
      for (const m of maps) mean += m[i];
      mean /= maps.length;
      if (mean < 0.02) continue;
      let varSum = 0;
      for (const m of maps) varSum += (m[i] - mean) ** 2;
      sum += Math.sqrt(varSum / maps.length) / mean;
      cnt++;
    }
    scintillation = cnt > 0 ? sum / cnt : 0;
  }

  // 汇总评分
  let hitCount = 0, sumRet = 0, sumLeak = 0, sumFire = 0;
  for (let i = 0; i < size * size; i++) {
    if (!hitMask[i]) continue;
    hitCount++;
    sumRet += returnMap[i];
    sumLeak += leakMap[i];
    sumFire += fireMap[i];
  }
  const meanRet = hitCount ? sumRet / hitCount : 0;
  const meanLeak = hitCount ? sumLeak / hitCount : 0;
  const meanFire = hitCount ? sumFire / hitCount : 0;

  return {
    returnMap, fireMap, leakMap, hitMask, size,
    facetStats,
    scores: {
      brightness: Math.min(100, (meanRet / 0.85) * 100),
      fire: Math.min(100, (meanFire / 1.2) * 100),
      scintillation: Math.min(100, scintillation * 250),
      lightReturn: meanRet * 100,
      leakage: meanLeak * 100,
    },
  };
}
