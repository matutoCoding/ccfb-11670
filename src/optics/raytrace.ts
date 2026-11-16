import { Vec3, add, dot, scale } from './vec3';
import { refract, reflect, fresnelUnpolarized } from './snell';

/**
 * CPU 凸多面体光谱光线追踪器 —— 物理参考实现。
 * 钻石是凸多面体：每个刻面是一个半空间 n·x <= w（n 为外法线）。
 * 与 GPU 着色器逻辑一一对应，单元测试用手算斯涅尔定律核对。
 */

export interface Plane {
  n: Vec3; // 单位外法线
  w: number; // n·x = w
}

export interface ExitRay {
  dir: Vec3;
  /** 该出射光携带的通量（0..1，已含所有菲涅尔损耗） */
  throughput: number;
  lambda: number;
  /** 出射刻面索引 */
  facet: number;
  bounces: number;
}

export interface TraceResult {
  hit: boolean;
  /** 入射刻面索引（未命中为 -1） */
  entryFacet: number;
  /** 表面反射（未进入石内的部分）方向与通量 */
  surfaceReflectDir: Vec3;
  surfaceReflectFlux: number;
  exits: ExitRay[];
  /** 进入石内又离开的总通量 */
  transmittedFlux: number;
  /** 追踪结束时仍困在石内的通量（反弹次数耗尽） */
  trappedFlux: number;
}

const EPS = 1e-6;

/** 凸多面体求交：返回进入/离开参数与刻面。射线起点在外部。 */
export function intersectConvex(
  o: Vec3,
  d: Vec3,
  planes: Plane[],
): { tEnter: number; tExit: number; enterFacet: number; exitFacet: number } | null {
  let tN = -Infinity, tF = Infinity, fN = -1, fF = -1;
  for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    const denom = dot(p.n, d);
    const dist = p.w - dot(p.n, o);
    if (Math.abs(denom) < 1e-12) {
      if (dist < 0) return null; // 平行且在该半空间之外
      continue;
    }
    const t = dist / denom;
    if (denom < 0) {
      if (t > tN) { tN = t; fN = i; }
    } else {
      if (t < tF) { tF = t; fF = i; }
    }
  }
  if (tN > tF || tF < 0) return null;
  return { tEnter: Math.max(tN, 0), tExit: tF, enterFacet: fN, exitFacet: fF };
}

/** 从内部找最近出射刻面（起点已在凸体内） */
function nearestExit(o: Vec3, d: Vec3, planes: Plane[]): { t: number; facet: number } | null {
  let tBest = Infinity, fBest = -1;
  for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    const denom = dot(p.n, d);
    if (denom <= 1e-12) continue;
    const t = (p.w - dot(p.n, o)) / denom;
    if (t > EPS && t < tBest) { tBest = t; fBest = i; }
  }
  return fBest >= 0 ? { t: tBest, facet: fBest } : null;
}

export interface TraceOptions {
  wavelengths: number[];
  ior: (lambdaNm: number) => number;
  maxBounces: number;
  /** 通量低于该值即终止 */
  minThroughput?: number;
}

/**
 * 追踪一条光线穿过凸多面体宝石。
 * 每个波长独立走完整路径（TIR 判断随波长折射率不同而不同，物理上严格）。
 */
export function traceRay(origin: Vec3, dir: Vec3, planes: Plane[], opts: TraceOptions): TraceResult {
  const minT = opts.minThroughput ?? 1e-4;
  const result: TraceResult = {
    hit: false,
    entryFacet: -1,
    surfaceReflectDir: [0, 0, 0],
    surfaceReflectFlux: 0,
    exits: [],
    transmittedFlux: 0,
    trappedFlux: 0,
  };

  const hit = intersectConvex(origin, dir, planes);
  if (!hit) return result;
  result.hit = true;
  result.entryFacet = hit.enterFacet;

  const entryN = planes[hit.enterFacet].n; // 外法线，指向入射侧
  const cosI = -dot(entryN, dir);

  for (const lambda of opts.wavelengths) {
    const nStone = opts.ior(lambda);
    // 入射表面：部分反射（表面光泽），部分折射进入
    const R = fresnelUnpolarized(cosI, 1, nStone);
    result.surfaceReflectFlux += R / opts.wavelengths.length;
    const refr = refract(dir, entryN, 1 / nStone);
    if (!refr) continue; // 从空气进钻石不可能 TIR，防御性
    result.surfaceReflectDir = reflect(dir, entryN);

    let o = add(add(origin, scale(dir, hit.tEnter)), scale(refr, EPS * 10));
    let d = refr;
    let throughput = 1 - R;

    for (let bounce = 0; bounce < opts.maxBounces && throughput > minT; bounce++) {
      const exit = nearestExit(o, d, planes);
      if (!exit) { result.trappedFlux += throughput / opts.wavelengths.length; throughput = 0; break; }
      const p = add(o, scale(d, exit.t));
      const fn = planes[exit.facet].n; // 外法线
      // 内部入射：入射侧法线为 -fn
      const negN: Vec3 = [-fn[0], -fn[1], -fn[2]];
      const cosI2 = dot(d, fn); // = -dot(d, negN) > 0
      const refrOut = refract(d, negN, nStone / 1);
      if (refrOut === null) {
        // 全内反射
        d = reflect(d, negN);
        o = add(p, scale(d, EPS * 10));
        continue;
      }
      const R2 = fresnelUnpolarized(cosI2, nStone, 1);
      const outFlux = throughput * (1 - R2);
      result.exits.push({
        dir: refrOut,
        throughput: outFlux / opts.wavelengths.length,
        lambda,
        facet: exit.facet,
        bounces: bounce,
      });
      result.transmittedFlux += outFlux / opts.wavelengths.length;
      // 剩余部分继续在内反射
      throughput *= R2;
      d = reflect(d, negN);
      o = add(p, scale(d, EPS * 10));
    }
    if (throughput > minT) result.trappedFlux += throughput / opts.wavelengths.length;
  }
  return result;
}
