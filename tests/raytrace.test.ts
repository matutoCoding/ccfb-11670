/**
 * 光线追踪器验证:平行平板(经典结果:出射光平行于入射光)、
 * 直角棱镜全反射、能量守恒趋势。
 */
import { describe, it, expect } from 'vitest';
import { traceRay, Plane } from '../src/physics/raytrace';
import { Vec3, normalize, angleDeg } from '../src/math/vec3';
import { diamondIOR } from '../src/physics/optics';

const DEG = Math.PI / 180;

/** 轴对齐盒子的 6 个平面 */
function boxPlanes(hx: number, hy: number, hz: number): Plane[] {
  const mk = (n: Vec3, d: number, i: number): Plane => ({ n, d, facetIndex: i });
  return [
    mk([1, 0, 0], hx, 0), mk([-1, 0, 0], hx, 1),
    mk([0, 1, 0], hy, 2), mk([0, -1, 0], hy, 3),
    mk([0, 0, 1], hz, 4), mk([0, 0, -1], hz, 5),
  ];
}

describe('平行平板', () => {
  const nD = diamondIOR(589.3);
  it('出射方向与入射方向平行(误差 < 0.01°)', () => {
    const slab = boxPlanes(6, 0.5, 6); // 足够宽,大角度也不会射出侧面
    for (const thetaI of [10, 25, 40, 55, 70]) {
      const I: Vec3 = normalize([Math.sin(thetaI * DEG), -Math.cos(thetaI * DEG), 0]);
      const r = traceRay(slab, [0, 2, 0], I, nD);
      expect(r.hit).toBe(true);
      expect(r.exitDir).not.toBeNull();
      expect(angleDeg(r.exitDir!, I)).toBeLessThan(0.01);
      expect(r.bounces.length).toBe(0); // 平板内不应发生全反射
    }
  });

  it('横向位移符合斯涅尔定律推导', () => {
    const slab = boxPlanes(2, 0.5, 2);
    const thetaI = 45;
    const I: Vec3 = normalize([Math.sin(thetaI * DEG), -Math.cos(thetaI * DEG), 0]);
    const r = traceRay(slab, [0, 2, 0], I, nD);
    // 手算:板内折射角 θt,出射 x = 入射 x + h·tanθt
    const sinT = Math.sin(thetaI * DEG) / nD;
    const tanT = sinT / Math.sqrt(1 - sinT * sinT);
    const exitX = r.exitPoint![0];
    // 入射点 x = 1.5·tan45° = 1.5(从 y=2 到 y=0.5),板内下落 1.0 到 y=-0.5
    const entryX = 1.5 * Math.tan(thetaI * DEG);
    expect(Math.abs(exitX - (entryX + 1.0 * tanT))).toBeLessThan(1e-6);
  });
});

describe('直角棱镜全反射', () => {
  const nD = diamondIOR(589.3);
  it('45° 入射斜面发生全反射并偏转 90°', () => {
    // 棱镜:斜面法线 (0, √2/2, √2/2),光线 +z 方向进入底面后 45° 射向斜面
    const s = Math.SQRT1_2;
    const prism: Plane[] = [
      { n: [1, 0, 0], d: 1, facetIndex: 0 },
      { n: [-1, 0, 0], d: 1, facetIndex: 1 },
      { n: [0, 1, 0], d: 1, facetIndex: 2 },
      { n: [0, -1, 0], d: 1, facetIndex: 3 },
      { n: [0, 0, -1], d: 1, facetIndex: 4 },
      { n: [0, s, s], d: 1, facetIndex: 5 }, // 斜面 y+z = √2... d=1
    ];
    const I: Vec3 = [0, 0, 1];
    const r = traceRay(prism, [0, -0.5, -2], I, nD);
    expect(r.hit).toBe(true);
    expect(r.bounces.length).toBe(1);
    expect(r.bounces[0].tir).toBe(true);
    // 反射后应沿 +y 或 -y?入射 +z 射向斜面(法线 (0,s,s)),反射方向 = +z 关于斜面法线的镜像
    // reflect((0,0,1), (0,s,s)) = (0,0,1) - 2·s·(0,s,s) = (0,-1,0)·? 计算:2·dot=2s → (0, -2s·s, 1-2s·s) = (0,-1,0)
    expect(r.exitDir).not.toBeNull();
    expect(angleDeg(r.exitDir!, [0, -1, 0])).toBeLessThan(0.01);
  });
});

describe('能量', () => {
  it('直通平板的透过率与菲涅尔公式一致', () => {
    const nD = diamondIOR(589.3);
    const slab = boxPlanes(2, 0.5, 2);
    const r = traceRay(slab, [0, 2, 0], [0, -1, 0], nD);
    // 正入射:每次界面透射 1-R,R=((n-1)/(n+1))²
    const R = ((nD - 1) / (nD + 1)) ** 2;
    expect(r.throughput).toBeCloseTo((1 - R) * (1 - R), 6);
  });
});
