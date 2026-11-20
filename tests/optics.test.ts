/**
 * 光学物理验证:斯涅尔定律、全内反射、菲涅尔、色散。
 * 所有期望值由独立公式直接计算(不经过被测实现),角度容差 0.01°。
 */
import { describe, it, expect } from 'vitest';
import { refract, reflect, fresnelUnpolarized, diamondIOR, criticalAngleDeg } from '../src/physics/optics';
import { Vec3, normalize, dot, angleDeg, length } from '../src/math/vec3';

const DEG = Math.PI / 180;
const TOL_DEG = 0.01;

/** 独立参考实现:由入射角直接算折射角(斯涅尔定律 n1 sinθ1 = n2 sinθ2) */
function snellRefractAngleDeg(incidentDeg: number, n1: number, n2: number): number {
  const sinT = (n1 / n2) * Math.sin(incidentDeg * DEG);
  return Math.asin(sinT) / DEG;
}

describe('斯涅尔折射', () => {
  // 空气→钻石,多个入射角
  const nD = diamondIOR(589.3); // ≈2.4175
  const cases = [5, 15, 30, 45, 60, 75, 89];
  for (const thetaI of cases) {
    it(`空气→钻石 入射 ${thetaI}°`, () => {
      const I: Vec3 = normalize([Math.sin(thetaI * DEG), -Math.cos(thetaI * DEG), 0]);
      const N: Vec3 = [0, 1, 0];
      const T = refract(I, N, 1.0, nD);
      expect(T).not.toBeNull();
      // 折射角(与 -N 的夹角)必须符合斯涅尔定律
      const refractedDeg = angleDeg(T!, [0, -1, 0]);
      expect(Math.abs(refractedDeg - snellRefractAngleDeg(thetaI, 1.0, nD))).toBeLessThan(TOL_DEG);
      // 折射光线在入射面内且为单位向量
      expect(Math.abs(T![2])).toBeLessThan(1e-12);
      expect(length(T!)).toBeCloseTo(1, 12);
      // 斯涅尔不变量:n1 sinθ1 = n2 sinθ2 直接验证
      const sinT = Math.abs(T![0]);
      expect(Math.abs(1.0 * Math.sin(thetaI * DEG) - nD * sinT)).toBeLessThan(1e-12);
    });
  }

  it('钻石→空气 内部出射', () => {
    const thetaI = 20; // 小于临界角
    const I: Vec3 = normalize([Math.sin(thetaI * DEG), -Math.cos(thetaI * DEG), 0]);
    const T = refract(I, [0, 1, 0], nD, 1.0)!;
    const refractedDeg = angleDeg(T, [0, -1, 0]);
    expect(Math.abs(refractedDeg - snellRefractAngleDeg(thetaI, nD, 1.0))).toBeLessThan(TOL_DEG);
  });

  it('斜法线 + 三维入射:折射光在入射面内且角度正确', () => {
    const N: Vec3 = normalize([0.3, 0.9, -0.2]);
    const I: Vec3 = normalize([0.5, -0.8, 0.31]);
    const cosI = -dot(I, N);
    const thetaI = Math.acos(cosI) / DEG;
    const T = refract(I, N, 1.0, nD)!;
    const refractedDeg = angleDeg(T, [-N[0], -N[1], -N[2]]);
    expect(Math.abs(refractedDeg - snellRefractAngleDeg(thetaI, 1.0, nD))).toBeLessThan(TOL_DEG);
    // 共面性:T 在 I 与 N 张成的平面内(混合积为 0)
    const triple = T[0] * (I[1] * N[2] - I[2] * N[1])
      - T[1] * (I[0] * N[2] - I[2] * N[0])
      + T[2] * (I[0] * N[1] - I[1] * N[0]);
    expect(Math.abs(triple)).toBeLessThan(1e-12);
  });
});

describe('全内反射', () => {
  const nD = diamondIOR(589.3);
  it('超过临界角返回 null', () => {
    const crit = criticalAngleDeg(nD); // ≈24.44°
    expect(crit).toBeGreaterThan(24.3);
    expect(crit).toBeLessThan(24.5);
    for (const thetaI of [crit + 0.5, 30, 45, 60, 89]) {
      const I: Vec3 = normalize([Math.sin(thetaI * DEG), -Math.cos(thetaI * DEG), 0]);
      expect(refract(I, [0, 1, 0], nD, 1.0)).toBeNull();
    }
  });
  it('临界角之内仍可折射', () => {
    const crit = criticalAngleDeg(nD);
    const I: Vec3 = normalize([Math.sin((crit - 0.5) * DEG), -Math.cos((crit - 0.5) * DEG), 0]);
    expect(refract(I, [0, 1, 0], nD, 1.0)).not.toBeNull();
  });
});

describe('反射', () => {
  it('反射角等于入射角', () => {
    const N: Vec3 = normalize([0.2, 1, 0.3]);
    const I: Vec3 = normalize([0.6, -0.7, 0.2]);
    const R = reflect(I, N);
    expect(Math.abs(angleDeg(R, N) - angleDeg([-I[0], -I[1], -I[2]], N))).toBeLessThan(TOL_DEG);
    expect(length(R)).toBeCloseTo(1, 12);
  });
});

describe('菲涅尔(非偏振精确解)', () => {
  it('正入射:((n1-n2)/(n1+n2))²', () => {
    const nD = diamondIOR(589.3);
    const expected = ((1 - nD) / (1 + nD)) ** 2; // ≈0.1719
    expect(fresnelUnpolarized(1.0, 1.0, nD)).toBeCloseTo(expected, 10);
  });
  it('全内反射时反射率为 1', () => {
    const nD = diamondIOR(589.3);
    const cosI = Math.cos(45 * DEG);
    expect(fresnelUnpolarized(cosI, nD, 1.0)).toBe(1);
  });
  it('同介质无反射', () => {
    expect(fresnelUnpolarized(0.7, 1.5, 1.5)).toBeCloseTo(0, 12);
  });
});

describe('柯西色散', () => {
  it('n_D(589.3nm) ≈ 2.417(文献值 2.417)', () => {
    expect(Math.abs(diamondIOR(589.3) - 2.417)).toBeLessThan(0.001);
  });
  it('拟合锚点:F 线 2.4354 / C 线 2.4103', () => {
    expect(diamondIOR(486.1)).toBeCloseTo(2.4354, 3);
    expect(diamondIOR(656.3)).toBeCloseTo(2.4103, 3);
  });
  it('折射率随波长增大而减小(正常色散)', () => {
    expect(diamondIOR(486.1)).toBeGreaterThan(diamondIOR(656.3));
  });
});
