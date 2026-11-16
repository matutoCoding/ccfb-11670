import { Vec3, dot } from './vec3';

/**
 * 斯涅尔折射 / 反射 / 菲涅尔 —— 物理核心。
 * 该模块与 GPU 着色器中的实现一一对应，并由 tests/snell.test.ts
 * 用手算的斯涅尔定律结果核对（误差要求 < 0.01°）。
 */

/**
 * 折射（GLSL refract 同款公式）。
 * @param I 入射方向（单位向量，指向界面）
 * @param N 界面法线（单位向量，指向入射侧，即 dot(N, I) < 0）
 * @param eta n1 / n2（入射侧折射率 / 出射侧折射率）
 * @returns 折射方向（单位向量），全内反射时返回 null
 */
export function refract(I: Vec3, N: Vec3, eta: number): Vec3 | null {
  const cosI = -dot(N, I);
  const sinT2 = eta * eta * (1 - cosI * cosI);
  if (sinT2 > 1) return null; // 全内反射
  const cosT = Math.sqrt(1 - sinT2);
  const k = eta * cosI - cosT;
  return [eta * I[0] + k * N[0], eta * I[1] + k * N[1], eta * I[2] + k * N[2]];
}

/** 镜面反射。I 指向界面，N 指向入射侧。 */
export function reflect(I: Vec3, N: Vec3): Vec3 {
  const d = 2 * dot(N, I);
  return [I[0] - d * N[0], I[1] - d * N[1], I[2] - d * N[2]];
}

/**
 * 非偏振菲涅尔反射率（完整形式，非 Schlick 近似）。
 * @param cosI 入射角余弦（>0）
 * @param n1 入射侧折射率
 * @param n2 出射侧折射率
 * @returns 反射率 ∈ [0,1]；全内反射时返回 1
 */
export function fresnelUnpolarized(cosI: number, n1: number, n2: number): number {
  const sinT2 = (n1 / n2) ** 2 * (1 - cosI * cosI);
  if (sinT2 >= 1) return 1; // TIR
  const cosT = Math.sqrt(1 - sinT2);
  const rs = ((n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT)) ** 2;
  const rp = ((n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI)) ** 2;
  return (rs + rp) / 2;
}

/**
 * 柯西色散公式：n(λ) = A + B / λ²，λ 单位 µm。
 * 钻石默认值拟合自 n_F(486.1nm)=2.4354, n_C(656.3nm)=2.4103，
 * 在钠灯 d 线(587.6nm)处给出 n_d ≈ 2.417，色散 0.044。
 */
export const CAUCHY_A_DEFAULT = 2.3798;
export const CAUCHY_B_DEFAULT = 0.01315; // µm²

export function iorCauchy(
  lambdaNm: number,
  A: number = CAUCHY_A_DEFAULT,
  B: number = CAUCHY_B_DEFAULT,
): number {
  const um = lambdaNm / 1000;
  return A + B / (um * um);
}

/** 解析斯涅尔定律（用于测试核对）：sinθt = n1/n2 · sinθi */
export function snellRefractedAngle(thetaI: number, n1: number, n2: number): number | null {
  const s = (n1 / n2) * Math.sin(thetaI);
  if (Math.abs(s) > 1) return null;
  return Math.asin(s);
}

/** 临界角（度），n1 > n2 时存在 */
export function criticalAngleDeg(n1: number, n2: number): number | null {
  if (n1 <= n2) return null;
  return (Math.asin(n2 / n1) * 180) / Math.PI;
}
