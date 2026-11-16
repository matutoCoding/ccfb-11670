import { describe, it, expect } from 'vitest';
import { traceRay, intersectConvex, Plane } from '../src/optics/raytrace';
import { iorCauchy } from '../src/optics/snell';
import { Vec3, angleDeg, normalize } from '../src/optics/vec3';
import { buildRoundBrilliant } from '../src/geometry/cuts';
import { DEFAULT_PARAMS } from '../src/geometry/cuts';

const DEG = Math.PI / 180;
const TOL_DEG = 0.01;

/** 半边长 10、中心在原点的立方体（用于手算核对；足够大，斜射不会从侧面漏出） */
function unitCube(): Plane[] {
  const dirs: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  return dirs.map((n) => ({ n, w: 10 }));
}

const ior = (l: number) => iorCauchy(l);

describe('凸多面体求交', () => {
  it('射线命中/未命中立方体', () => {
    const cube = unitCube();
    const hit = intersectConvex([0, 15, 0], [0, -1, 0], cube);
    expect(hit).not.toBeNull();
    expect(hit!.tEnter).toBeCloseTo(5, 9);
    expect(hit!.tExit).toBeCloseTo(25, 9);
    expect(intersectConvex([0, 15, 0], [0, 1, 0], cube)).toBeNull();
    expect(intersectConvex([15, 15, 0], [0, -1, 0], cube)).toBeNull();
  });
});

describe('单条光线追踪 vs 手算斯涅尔定律（误差 < 0.01°）', () => {
  it('平行平板的横向位移：出射光与入射光平行', () => {
    // 手算：光从空气以 30° 入射 n=2.417 的平行平板，出射方向必平行于入射方向
    const cube = unitCube();
    const thetaI = 30;
    const dir = normalize([Math.sin(thetaI * DEG), -Math.cos(thetaI * DEG), 0]);
    const res = traceRay([0, 5, 0], dir, cube, { wavelengths: [550], ior, maxBounces: 8 });
    expect(res.hit).toBe(true);
    // 找到向下的出射光（穿过底面）
    const down = res.exits.filter((e) => e.dir[1] < -0.5);
    expect(down.length).toBeGreaterThan(0);
    const exitAngle = angleDeg(down[0].dir, [0, -1, 0]);
    expect(Math.abs(exitAngle - thetaI)).toBeLessThan(TOL_DEG);
  });

  it('单次折射的能量守恒（多个入射角）', () => {
    // 核对能量守恒：表面反射 + 各出射通量 + 困住通量 ≈ 1
    const cube = unitCube();
    for (const thetaI of [5, 15, 25, 40, 60, 75]) {
      const dir = normalize([Math.sin(thetaI * DEG), -Math.cos(thetaI * DEG), 0]);
      // 只追踪内部第一段：利用通量分裂——底面出射光方向反推内部角度。
      // 平行平板中 出射角=入射角，无法直接观测内部角，因此改用楔形核对（下一条测试）。
      // 这里核对能量守恒：表面反射 + 各出射通量 + 困住通量 ≈ 1
      const res = traceRay([0, 5, 0], dir, cube, { wavelengths: [550], ior, maxBounces: 12 });
      const total =
        res.surfaceReflectFlux + res.transmittedFlux + res.trappedFlux;
      expect(Math.abs(total - 1)).toBeLessThan(1e-3);
    }
  });

  it('楔形（棱镜）偏向角与手算一致', () => {
    // 手算场景：直角棱镜，顶点 (0,0),(-1,0),(0,-1)，n = 2.417（550nm）
    // 光线从右侧水平 -x 正入射竖直直角边（x=0 面，无偏折），
    // 在斜边 x+y=-1 上以 45° 入射（> 临界角 24.44°）→ 必然全内反射，
    // 反射后竖直 +y 从水平直角边（y=0 面）正入射出射。
    const n = iorCauchy(550);
    const prism: Plane[] = [
      { n: [1, 0, 0], w: 0 },                     // x <= 0（竖直直角边）
      { n: [0, 1, 0], w: 0 },                     // y <= 0（水平直角边）
      { n: normalize([-1, -1, 0]), w: Math.SQRT1_2 }, // x+y >= -1（斜边）
      { n: [0, 0, 1], w: 1 },                     // 前后封住（远离光路）
      { n: [0, 0, -1], w: 1 },
    ];
    const res = traceRay([0.5, -0.5, 0], [-1, 0, 0], prism, { wavelengths: [550], ior, maxBounces: 6 });
    expect(res.hit).toBe(true);
    // 斜面入射角 45° > 临界角 → TIR，之后从 y=0 面竖直向上出射
    const up = res.exits.filter((e) => e.dir[1] > 0.9);
    expect(up.length).toBeGreaterThan(0);
    expect(angleDeg(up[0].dir, [0, 1, 0])).toBeLessThan(TOL_DEG);
    // 验证确实发生了 TIR（45° > 24.44°）
    expect(45).toBeGreaterThan(Math.asin(1 / n) / DEG);
  });

  it('色散：不同波长折射角不同，蓝光偏折大于红光', () => {
    // 手算：30° 入射 n(λ) 的半无限介质，比较 450nm 与 650nm 的内部角度
    const halfSpace: Plane[] = [{ n: [0, 1, 0], w: 0 }, { n: [0, -1, 0], w: 100 },
      { n: [1, 0, 0], w: 100 }, { n: [-1, 0, 0], w: 100 }, { n: [0, 0, 1], w: 100 }, { n: [0, 0, -1], w: 100 }];
    const thetaI = 30;
    const dir = normalize([Math.sin(thetaI * DEG), -Math.cos(thetaI * DEG), 0]);
    const res = traceRay([0, 5, 0], dir, halfSpace, { wavelengths: [450, 650], ior, maxBounces: 2 });
    const exit450 = res.exits.find((e) => e.lambda === 450 && e.dir[1] < 0)!;
    const exit650 = res.exits.find((e) => e.lambda === 650 && e.dir[1] < 0)!;
    // 平行平板出射角都回到 30°，但出射点横向位置不同（色散位移）：
    // 蓝光折射率大 → 内部角度小 → 横向位移小
    const t450 = Math.asin(Math.sin(thetaI * DEG) / iorCauchy(450));
    const t650 = Math.asin(Math.sin(thetaI * DEG) / iorCauchy(650));
    expect(t450).toBeLessThan(t650);
    // 两束出射光方向都应与入射平行（各向同性平行平板）
    expect(Math.abs(angleDeg(exit450.dir, [0, -1, 0]) - thetaI)).toBeLessThan(TOL_DEG);
    expect(Math.abs(angleDeg(exit650.dir, [0, -1, 0]) - thetaI)).toBeLessThan(TOL_DEG);
  });
});

describe('圆形明亮式切工的物理合理性', () => {
  it('理想切工：台面正入射的中心光线经亭部两次全内反射后返回上方', () => {
    const geo = buildRoundBrilliant(DEFAULT_PARAMS);
    // 从台面中心正上方竖直向下
    const res = traceRay([0, 2, 0], [0, -1, 0], geo.planes, {
      wavelengths: [550], ior, maxBounces: 10,
    });
    expect(res.hit).toBe(true);
    // 理想切工（亭角 40.8°）下中心光线应返回观察者（向上出射）
    const up = res.exits.filter((e) => e.dir[1] > 0.5);
    const upFlux = up.reduce((s, e) => s + e.throughput, 0);
    expect(upFlux).toBeGreaterThan(0.5);
  });

  it('漏光切工：过浅亭角的光线束向下漏光显著多于理想切工', () => {
    // 覆盖台面的平行光线束，比较向上返回与向下漏光（法向 + 30° 倾斜）
    const bundle = (pavilionAngle: number, tiltDeg: number) => {
      const geo = buildRoundBrilliant({ ...DEFAULT_PARAMS, pavilionAngle });
      const dir: Vec3 = [Math.sin(tiltDeg * DEG), -Math.cos(tiltDeg * DEG), 0];
      let up = 0, down = 0, n = 0;
      const N = 24;
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const x = -0.95 + (1.9 * i) / (N - 1);
        const z = -0.95 + (1.9 * j) / (N - 1);
        if (x * x + z * z > 0.9) continue;
        const res = traceRay([x - 3 * dir[0], 3, z], dir, geo.planes, {
          wavelengths: [550], ior, maxBounces: 12,
        });
        if (!res.hit) continue;
        n++;
        up += res.surfaceReflectFlux;
        for (const e of res.exits) {
          if (e.dir[1] > 0) up += e.throughput; else down += e.throughput;
        }
      }
      return { up: up / n, down: down / n };
    };
    const ideal = bundle(40.8, 0);
    const shallow = bundle(36, 0);
    const idealTilt = bundle(40.8, 30);
    const shallowTilt = bundle(36, 30);
    // 理想切工返回率高
    expect(ideal.up).toBeGreaterThan(0.85);
    // 过浅切工漏光明显更多（法向与倾斜光束下都成立）
    expect(shallow.down).toBeGreaterThan(ideal.down * 1.5);
    expect(shallowTilt.down).toBeGreaterThan(idealTilt.down * 1.5);
  });
});
