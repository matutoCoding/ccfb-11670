import { describe, it, expect } from 'vitest';
import { refract, reflect, fresnelUnpolarized, iorCauchy, snellRefractedAngle, criticalAngleDeg, CAUCHY_A_DEFAULT, CAUCHY_B_DEFAULT } from '../src/optics/snell';
import { Vec3, normalize, cross, dot, angleDeg } from '../src/optics/vec3';

const DEG = Math.PI / 180;
/** 误差容忍：0.01 度（用户验收标准） */
const TOL_DEG = 0.01;

/** 构造过原点、法线为 N 的界面，从方向 thetaI（度，相对法线）入射的单位向量 */
function incidentRay(N: Vec3, thetaIDeg: number): Vec3 {
  // 在包含 N 的平面内构造切向
  const t: Vec3 = Math.abs(N[1]) < 0.9 ? [N[2], 0, -N[0]] : [0, -N[2], N[1]];
  const tangent = normalize(t);
  const th = thetaIDeg * DEG;
  // I 指向界面：I = sin·tangent - cos·N
  return normalize([
    tangent[0] * Math.sin(th) - N[0] * Math.cos(th),
    tangent[1] * Math.sin(th) - N[1] * Math.cos(th),
    tangent[2] * Math.sin(th) - N[2] * Math.cos(th),
  ]);
}

describe('斯涅尔折射定律（与手算核对，误差 < 0.01°）', () => {
  const normals: Vec3[] = [[0, 1, 0], [1, 0, 0], normalize([1, 2, 3]), normalize([-0.3, 0.8, 0.52])];
  const indexPairs: [number, number][] = [[1, 2.417], [2.417, 1], [1.5, 2.1], [2.417, 1.77], [1, 1.5]];

  it('折射角满足 n1·sinθi = n2·sinθt（多角度、多折射率组合）', () => {
    let maxErr = 0;
    for (const N of normals) {
      for (const [n1, n2] of indexPairs) {
        for (let thetaI = 0.5; thetaI < 89; thetaI += 3.7) {
          const expected = snellRefractedAngle(thetaI * DEG, n1, n2);
          const I = incidentRay(N, thetaI);
          const T = refract(I, N, n1 / n2);
          if (expected === null) {
            expect(T).toBeNull(); // 必须判为全内反射
            continue;
          }
          expect(T).not.toBeNull();
          // 折射角 = 折射光线与 -N 的夹角
          const negN: Vec3 = [-N[0], -N[1], -N[2]];
          const thetaT = angleDeg(T!, negN);
          const err = Math.abs(thetaT - expected / DEG);
          maxErr = Math.max(maxErr, err);
          expect(err).toBeLessThan(TOL_DEG);
        }
      }
    }
    // 实际精度应远优于容忍度
    expect(maxErr).toBeLessThan(1e-6);
  });

  it('折射光线保持在入射面内', () => {
    for (const N of normals) {
      const I = incidentRay(N, 37);
      const T = refract(I, N, 1 / 2.417)!;
      const planeNormal = normalize(cross(I, N));
      expect(Math.abs(dot(planeNormal, T))).toBeLessThan(1e-9);
    }
  });

  it('折射结果为严格单位向量', () => {
    for (const N of normals) {
      const I = incidentRay(N, 55);
      const T = refract(I, N, 1 / 2.417)!;
      expect(Math.abs(Math.hypot(...T) - 1)).toBeLessThan(1e-12);
    }
  });

  it('全内反射：超过临界角返回 null，临界角处折射角恰为 90°', () => {
    const n1 = 2.417, n2 = 1;
    const thetaC = criticalAngleDeg(n1, n2)!;
    expect(thetaC).toBeCloseTo(24.44, 1); // 钻石临界角 ≈ 24.44°
    const N: Vec3 = [0, 1, 0];
    // 临界角之内可以折射
    expect(refract(incidentRay(N, thetaC - 0.5), N, n1 / n2)).not.toBeNull();
    // 超过临界角必须 TIR
    for (const d of [0.001, 0.5, 5, 30]) {
      expect(refract(incidentRay(N, thetaC + d), N, n1 / n2)).toBeNull();
    }
    // 临界角处手算：折射角 = 90°
    const T = refract(incidentRay(N, thetaC - 1e-9), N, n1 / n2)!;
    const negN: Vec3 = [0, -1, 0];
    expect(Math.abs(angleDeg(T, negN) - 90)).toBeLessThan(TOL_DEG);
  });

  it('反射定律：入射角 = 反射角，且切向分量保持', () => {
    for (const N of normals) {
      for (const th of [5, 22, 45, 70, 88]) {
        const I = incidentRay(N, th);
        const R = reflect(I, N);
        expect(Math.abs(angleDeg(R, N) - th)).toBeLessThan(1e-9);
        // 反射光在入射面内
        const planeNormal = normalize(cross(I, N));
        expect(Math.abs(dot(planeNormal, R))).toBeLessThan(1e-9);
      }
    }
  });

  it('菲涅尔：正入射时 R = ((n1-n2)/(n1+n2))²', () => {
    expect(fresnelUnpolarized(1, 1, 2.417)).toBeCloseTo(((1 - 2.417) / (1 + 2.417)) ** 2, 12);
    // 钻石表面正入射反射率 ≈ 17.2%
    expect(fresnelUnpolarized(1, 1, 2.417)).toBeCloseTo(0.172, 2);
    // TIR 时 R = 1
    expect(fresnelUnpolarized(Math.cos(30 * DEG), 2.417, 1)).toBe(1);
  });

  it('柯西色散：n_d ≈ 2.417，n_F - n_C ≈ 0.025', () => {
    const nd = iorCauchy(587.6);
    expect(nd).toBeCloseTo(2.417, 2);
    const nF = iorCauchy(486.1);
    const nC = iorCauchy(656.3);
    expect(nF - nC).toBeCloseTo(0.0251, 3);
    // 蓝光折射率高于红光（正常色散）
    expect(iorCauchy(450)).toBeGreaterThan(iorCauchy(650));
    // 自定义系数生效
    expect(iorCauchy(550, 2.0, 0.02)).toBeCloseTo(2.0 + 0.02 / 0.3025, 9);
    expect(CAUCHY_A_DEFAULT).toBeGreaterThan(2);
    expect(CAUCHY_B_DEFAULT).toBeGreaterThan(0);
  });
});
