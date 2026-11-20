/**
 * 光学物理核心:斯涅尔折射、反射、菲涅尔、柯西色散。
 * 全部为纯函数,float64 精度,是 GPU(WGSL)实现的对照基准。
 */
import { Vec3, dot } from '../math/vec3';

/**
 * 斯涅尔折射。
 * @param I  入射方向(单位向量,指向界面)
 * @param N  界面法线(单位向量,必须满足 dot(I,N) < 0,即迎着光线)
 * @param n1 入射侧折射率
 * @param n2 出射侧折射率
 * @returns 折射方向(单位向量);发生全内反射时返回 null
 */
export function refract(I: Vec3, N: Vec3, n1: number, n2: number): Vec3 | null {
  const eta = n1 / n2;
  const cosI = -dot(I, N);
  const sin2T = eta * eta * (1 - cosI * cosI);
  if (sin2T > 1) return null; // 全内反射
  const cosT = Math.sqrt(1 - sin2T);
  const k = eta * cosI - cosT;
  return [eta * I[0] + k * N[0], eta * I[1] + k * N[1], eta * I[2] + k * N[2]];
}

/** 镜面反射。I 入射方向,N 法线(无需定向)。 */
export function reflect(I: Vec3, N: Vec3): Vec3 {
  const d = 2 * dot(I, N);
  return [I[0] - d * N[0], I[1] - d * N[1], I[2] - d * N[2]];
}

/**
 * 非偏振菲涅尔反射率(精确解,非 Schlick 近似)。
 * @param cosI 入射角余弦(取正值)
 * @returns 反射能量比例 ∈ [0,1];全内反射时为 1
 */
export function fresnelUnpolarized(cosI: number, n1: number, n2: number): number {
  const eta = n1 / n2;
  const sin2T = eta * eta * (1 - cosI * cosI);
  if (sin2T >= 1) return 1;
  const cosT = Math.sqrt(1 - sin2T);
  const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
  const rp = (n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI);
  return (rs * rs + rp * rp) / 2;
}

/**
 * 金刚石色散:柯西公式 n(λ) = A + B/λ²。
 * 系数由钻石实测夫琅禾费谱线拟合:
 *   n_F = 2.4354 @ 486.1nm(氢蓝线)
 *   n_C = 2.4103 @ 656.3nm(氢红线)
 * 得 B = 0.013135 µm², A = 2.37981;校验 n_D @ 589.3nm ≈ 2.4175(文献 2.417)。
 */
export const CAUCHY_A = 2.37981;
export const CAUCHY_B_UM2 = 0.013135;

/** 波长(nm)→ 钻石折射率 */
export function diamondIOR(lambdaNm: number): number {
  const um = lambdaNm / 1000;
  return CAUCHY_A + CAUCHY_B_UM2 / (um * um);
}

/** 渲染/分析用的采样波长(nm):红(C线)、绿(e线附近)、蓝(F线) */
export const WAVELENGTHS_NM = [656.3, 546.1, 486.1] as const;

/** 临界角(度),钻石→空气 */
export function criticalAngleDeg(n: number): number {
  return (Math.asin(1 / n) * 180) / Math.PI;
}
