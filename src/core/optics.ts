/**
 * 光学内核:色散折射率、斯涅尔折射、镜面反射、菲涅尔能量。
 * 约定:所有方向向量为单位向量;法线指向"入射侧"以外(折射时按需要翻转)。
 */
import { Vec3, dot, scale, sub, add, norm } from './vec3';

/**
 * 钻石色散:Sellmeier 方程(λ 单位 nm)
 * n² - 1 = 0.3306 λ²/(λ²-175²) + 4.3356 λ²/(λ²-106²)
 * 参考值:n(486.1nm)≈2.4354, n(589.3nm)≈2.4175, n(656.3nm)≈2.4103
 */
export function diamondIOR(lambdaNm: number): number {
  const l2 = lambdaNm * lambdaNm;
  const n2 = 1 + 0.3306 * l2 / (l2 - 175 * 175) + 4.3356 * l2 / (l2 - 106 * 106);
  return Math.sqrt(n2);
}

/** 标准采样波长(nm):F 蓝紫 / D 黄 / C 红,以及网格采样 */
export const WAVELENGTHS = {
  F: 486.1, D: 589.3, C: 656.3,
  samples: [420, 460, 500, 540, 580, 620, 660, 700],
};

/**
 * 斯涅尔折射。
 * @param i 入射方向(单位,指向界面)
 * @param n 界面法线(单位,指向入射介质一侧,即 dot(i,n)<0)
 * @param n1 入射介质折射率
 * @param n2 出射介质折射率
 * @returns 折射方向(单位)或 null(全内反射)
 */
export function refract(i: Vec3, n: Vec3, n1: number, n2: number): Vec3 | null {
  const eta = n1 / n2;
  const cosI = -dot(i, n);
  const sin2T = eta * eta * (1 - cosI * cosI);
  if (sin2T > 1) return null; // 全内反射
  const cosT = Math.sqrt(1 - sin2T);
  // t = eta*i + (eta*cosI - cosT)*n
  return norm(add(scale(i, eta), scale(n, eta * cosI - cosT)));
}

/** 镜面反射方向:r = i - 2(i·n)n */
export function reflect(i: Vec3, n: Vec3): Vec3 {
  return sub(i, scale(n, 2 * dot(i, n)));
}

/**
 * 菲涅尔反射率(非偏振平均),用于能量权重。
 * n1→n2,cosI 为入射角余弦(>0)。全内反射时返回 1。
 */
export function fresnel(n1: number, n2: number, cosI: number): number {
  const sin2T = (n1 / n2) ** 2 * (1 - cosI * cosI);
  if (sin2T >= 1) return 1;
  const cosT = Math.sqrt(1 - sin2T);
  const rs = ((n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT)) ** 2;
  const rp = ((n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI)) ** 2;
  return (rs + rp) / 2;
}

/** 入射角/折射角(度),用于单条光线的逐刻面角度展示 */
export function incidenceAngleDeg(i: Vec3, n: Vec3): number {
  const c = Math.min(1, Math.abs(dot(i, n)));
  return Math.acos(c) * 180 / Math.PI;
}

export function refractionAngleDeg(i: Vec3, n: Vec3, n1: number, n2: number): number | null {
  const cosI = Math.abs(dot(i, n));
  const sin2T = (n1 / n2) ** 2 * (1 - cosI * cosI);
  if (sin2T > 1) return null;
  return Math.asin(Math.sqrt(sin2T)) * 180 / Math.PI;
}

/** 钻石临界角(度) */
export const criticalAngleDeg = (lambdaNm: number): number =>
  Math.asin(1 / diamondIOR(lambdaNm)) * 180 / Math.PI;
