/**
 * 亮度 / 火彩 / 闪烁评分。
 * 全部基于确定性网格采样(无随机数),保证参数微调时得分连续。
 *
 * 分档口径(在评级页明示):
 *   亮度 = 台面朝上时返回观察者视锥的光通量(含头部遮挡权重与菲涅尔损失)
 *   火彩 = 出射光在 486–656nm 间的角色散强度加权平均
 *   闪烁 = 转台转动下闪烁格点的亮灭切换率
 *   三项均以 Tolkowsky 理想切工同光源实测值为基准 1.0 归一,
 *   优 EX ≥ 0.90,良 VG ≥ 0.75,中 G ≥ 0.55,差 F < 0.55
 */
import { GemModel, buildGem } from '../geometry/gem';
import { traceRay } from './tracer';
import { diamondIOR } from '../core/optics';
import { radiance, LightSettings } from './lighting';
import { v3, Vec3 } from '../core/vec3';

export interface ScoreBreakdown {
  brightness: number;      // 0..1
  fire: number;            // 0..1
  scintillation: number;   // 0..1
  brightnessGrade: string;
  fireGrade: string;
  scintillationGrade: string;
  overall: string;
  overallScore: number;    // 0..100
}

export interface ScoreSettings {
  grid: number;            // 采样网格(默认 48)
  rotationSteps: number;   // 闪烁采样步数(默认 12,即每 30°)
  light: LightSettings;
}

export function gradeOf(v: number): string {
  for (const b of GRADE_BANDS) if (v >= b.min) return b.label;
  return '差 F';
}

/** 亮度 + 火彩:俯视反向追迹,出射方向查光源分布 */
export function brightnessFire(model: GemModel, s: ScoreSettings): { brightness: number; fire: number } {
  const n = s.grid;
  const extent = 1.1 * (model.params.shape === 'oval' ? model.params.ratio : 1);
  const lamBlue = 486.1, lamRed = 656.3, lamMid = 589.3;
  const nB = diamondIOR(lamBlue), nR = diamondIOR(lamRed), nM = diamondIOR(lamMid);
  let bSum = 0, fSum = 0, count = 0;
  for (let py = 0; py < n; py++) {
    for (let px = 0; px < n; px++) {
      const x = (px + 0.5) / n * 2 * extent - extent;
      const y = extent - (py + 0.5) / n * 2 * extent;
      const o = v3(x, y, 5), d = v3(0, 0, -1);
      const rM = traceRay(model, { o, d }, nM, lamMid);
      if (rM.events.length === 0) continue;
      count++;
      if (rM.escaped !== 'up' || !rM.exitDir) continue; // 漏光:亮度 0
      bSum += radiance(rM.exitDir, s.light) * rM.throughput;
      // 火彩:同一点蓝/红光出射方向的角分离
      const rB = traceRay(model, { o, d }, nB, lamBlue);
      const rR = traceRay(model, { o, d }, nR, lamRed);
      if (rB.escaped === 'up' && rR.escaped === 'up' && rB.exitDir && rR.exitDir) {
        const cosA = Math.min(1, Math.max(-1,
          rB.exitDir.x * rR.exitDir.x + rB.exitDir.y * rR.exitDir.y + rB.exitDir.z * rR.exitDir.z));
        const spreadDeg = Math.acos(cosA) * 180 / Math.PI;
        // 角色散达到 ~0.5° 记为满分火彩单元,再乘观察者处光源权重
        const vis = radiance(rM.exitDir, s.light);
        fSum += Math.min(1, spreadDeg / 0.5) * vis * rM.throughput;
      }
    }
  }
  if (count === 0) return { brightness: 0, fire: 0 };
  return { brightness: bSum / count, fire: fSum / count };
}

/** 闪烁:绕竖直轴旋转模型,统计亮灭切换 */
export function scintillation(model: GemModel, s: ScoreSettings): number {
  const n = Math.max(16, Math.floor(s.grid / 2));
  const steps = s.rotationSteps;
  const extent = 1.1 * (model.params.shape === 'oval' ? model.params.ratio : 1);
  const ior = diamondIOR(589.3);
  const rot = (v: Vec3, a: number): Vec3 => ({
    x: v.x * Math.cos(a) - v.y * Math.sin(a),
    y: v.x * Math.sin(a) + v.y * Math.cos(a),
    z: v.z,
  });
  let prev: Uint8Array | null = null;
  let toggles = 0, cells = 0;
  for (let st = 0; st < steps; st++) {
    const a = st * 2 * Math.PI / steps;
    const cur = new Uint8Array(n * n);
    for (let py = 0; py < n; py++) {
      for (let px = 0; px < n; px++) {
        const x = (px + 0.5) / n * 2 * extent - extent;
        const y = extent - (py + 0.5) / n * 2 * extent;
        // 反向追迹:入射点随转台旋转(等价于转石头)
        const o = rot(v3(x, y, 5), -a);
        const r = traceRay(model, { o, d: v3(0, 0, -1) }, ior, 589.3);
        if (r.events.length === 0) continue;
        const lit = r.escaped === 'up' && r.exitDir && radiance(r.exitDir, s.light) * r.throughput > 0.25;
        cur[py * n + px] = lit ? 1 : 0;
      }
    }
    if (prev) {
      for (let i = 0; i < cur.length; i++) {
        if (cur[i] !== prev[i]) toggles++;
        cells++;
      }
    }
    prev = cur;
  }
  if (cells === 0) return 0;
  // 原始切换率(归一化在 fullScore 中按理想基准完成)
  return toggles / cells;
}

/**
 * 分档口径:以 Tolkowsky 理想切工(台面 53 / 冠角 34.5 / 亭角 40.75)
 * 在相同光源、相同采样下的实测值为基准 1.0,各项指标取与其比值(封顶 1.0)。
 * 分档:优 EX ≥ 0.90,良 VG ≥ 0.75,中 G ≥ 0.55,差 F < 0.55。
 */
export const GRADE_BANDS = [
  { min: 0.90, label: '优 EX' },
  { min: 0.75, label: '良 VG' },
  { min: 0.55, label: '中 G' },
  { min: 0.0, label: '差 F' },
];

interface RawScores { brightness: number; fire: number; scintRate: number; }
const refCache = new Map<string, RawScores>();

function referenceScores(s: ScoreSettings): RawScores {
  const key = JSON.stringify({ g: s.grid, r: s.rotationSteps, l: s.light });
  const hit = refCache.get(key);
  if (hit) return hit;
  const refModel = buildGem({
    shape: 'round', tablePct: 53, crownAngle: 34.5, pavilionAngle: 40.75,
    girdlePct: 2, culetPct: 0, ratio: 1.35, starLengthPct: 50, lowerGirdlePct: 78, chevrons: 3,
  }, { tilts: [], girdleWaveAmpPct: 0, girdleWaveLobes: 3, girdleWavePhaseDeg: 0 });
  const bf = brightnessFire(refModel, s);
  const raw: RawScores = { brightness: bf.brightness, fire: bf.fire, scintRate: scintillation(refModel, s) };
  refCache.set(key, raw);
  return raw;
}

export function fullScore(model: GemModel, s: ScoreSettings): ScoreBreakdown {
  const ref = referenceScores(s);
  const bf = brightnessFire(model, s);
  const scintRate = scintillation(model, s);
  const norm = (v: number, r: number) => (r > 0 ? Math.min(1, v / r) : 0);
  const brightness = norm(bf.brightness, ref.brightness);
  const fire = norm(bf.fire, ref.fire);
  const scint = norm(scintRate, ref.scintRate);
  const overallScore = Math.round((brightness * 0.45 + fire * 0.30 + scint * 0.25) * 100);
  return {
    brightness, fire, scintillation: scint,
    brightnessGrade: gradeOf(brightness),
    fireGrade: gradeOf(fire),
    scintillationGrade: gradeOf(scint),
    overallScore,
    overall: gradeOf(overallScore / 100),
  };
}
