/**
 * CPU 参考光线追踪器:对凸多面体宝石做折射 + 全内反射追踪。
 * 用途:1) 光学分析(亮度/火彩/闪烁/漏光) 2) GPU 渲染结果的物理正确性基准。
 * WGSL 着色器里的 traceGem 与本文件逻辑一一对应,改动必须两边同步。
 */
import { Vec3, add, scale, dot, negate } from '../math/vec3';
import { refract, reflect, fresnelUnpolarized } from './optics';

/** 凸多面体的一个面:平面方程 dot(n, p) = d,n 为朝外单位法线 */
export interface Plane {
  n: Vec3;
  d: number;
  /** 刻面在原始宝石中的索引(用于漏光归属分析) */
  facetIndex: number;
}

const EPS = 1e-9;
const SURF_OFFSET = 1e-7;

export interface ConvexHit {
  tEnter: number;
  tExit: number;
  enterPlane: number;
  exitPlane: number;
}

/** 射线与凸多面体求交(板条法)。返回进入/离开参数与对应平面。 */
export function intersectConvex(planes: Plane[], ro: Vec3, rd: Vec3): ConvexHit | null {
  let tEnter = -Infinity;
  let tExit = Infinity;
  let enterPlane = -1;
  let exitPlane = -1;
  for (let i = 0; i < planes.length; i++) {
    const denom = dot(planes[i].n, rd);
    const dist = planes[i].d - dot(planes[i].n, ro);
    if (Math.abs(denom) < EPS) {
      if (dist < 0) return null; // 平行且在平面外侧
      continue;
    }
    const t = dist / denom;
    if (denom < 0) {
      if (t > tEnter) { tEnter = t; enterPlane = i; }
    } else {
      if (t < tExit) { tExit = t; exitPlane = i; }
    }
  }
  if (enterPlane < 0 || tEnter > tExit || tExit < 0) return null;
  return { tEnter, tExit, enterPlane, exitPlane };
}

/** 从内部找最近出射平面 */
function nearestExit(planes: Plane[], ro: Vec3, rd: Vec3): { t: number; plane: number } | null {
  let tBest = Infinity;
  let best = -1;
  for (let i = 0; i < planes.length; i++) {
    const denom = dot(planes[i].n, rd);
    if (denom <= EPS) continue;
    const t = (planes[i].d - dot(planes[i].n, ro)) / denom;
    if (t > EPS && t < tBest) { tBest = t; best = i; }
  }
  return best < 0 ? null : { t: tBest, plane: best };
}

export interface Bounce {
  point: Vec3;
  facetIndex: number;
  tir: boolean;
}

export interface TraceResult {
  /** 是否进入宝石(未命中为 false) */
  hit: boolean;
  /** 出射方向(未出射/未命中为 null) */
  exitDir: Vec3 | null;
  exitPoint: Vec3 | null;
  /** 出射时剩余能量比例(入/出界面菲涅尔透射累积) */
  throughput: number;
  /** 出射刻面索引;漏光分析用 */
  exitFacetIndex: number;
  /** 进入刻面索引 */
  enterFacetIndex: number;
  /** 内部反射次数 */
  bounces: Bounce[];
  /** 是否因达到反弹上限而未出射 */
  trapped: boolean;
}

/**
 * 追踪一条光线穿过宝石。
 * @param ior 该波长的折射率(色散由调用方按波长分别调用实现)
 */
export function traceRay(
  planes: Plane[],
  ro: Vec3,
  rd: Vec3,
  ior: number,
  maxBounces = 12,
): TraceResult {
  const none: TraceResult = {
    hit: false, exitDir: null, exitPoint: null, throughput: 0,
    exitFacetIndex: -1, enterFacetIndex: -1, bounces: [], trapped: false,
  };
  const hit = intersectConvex(planes, ro, rd);
  if (!hit) return none;

  const enterPlane = planes[hit.enterPlane];
  let p = add(ro, scale(rd, hit.tEnter));
  // 进入:空气(1.0)→ 宝石(ior)。光线从外向内,朝外法线 n 本身就迎着光线(dot(rd,n)<0)
  const nIn = enterPlane.n;
  const cosEntry = -dot(rd, nIn);
  let throughput = 1 - fresnelUnpolarized(cosEntry, 1.0, ior);
  let dir = refract(rd, nIn, 1.0, ior);
  if (!dir) return none; // 从空气进入不可能全反射,防御性返回
  const bounces: Bounce[] = [];

  for (let b = 0; b < maxBounces; b++) {
    p = add(p, scale(dir, SURF_OFFSET));
    const exit = nearestExit(planes, p, dir);
    if (!exit) {
      return { ...none, hit: true, throughput, enterFacetIndex: enterPlane.facetIndex, bounces, trapped: true };
    }
    p = add(p, scale(dir, exit.t));
    const pl = planes[exit.plane];
    const n = negate(pl.n); // 迎着光线的法线
    const cosI = -dot(dir, n);
    const out = refract(dir, n, ior, 1.0);
    if (out === null) {
      // 全内反射,能量无损
      bounces.push({ point: p, facetIndex: pl.facetIndex, tir: true });
      dir = reflect(dir, pl.n);
      continue;
    }
    // 部分透出:透射部分作为出射光,内反射部分能量小,忽略(钻石临界角小,绝大多数内反射为 TIR)
    const r = fresnelUnpolarized(cosI, ior, 1.0);
    throughput *= 1 - r;
    return {
      hit: true, exitDir: out, exitPoint: p, throughput,
      exitFacetIndex: pl.facetIndex, enterFacetIndex: enterPlane.facetIndex,
      bounces, trapped: false,
    };
  }
  return { ...none, hit: true, throughput, enterFacetIndex: enterPlane.facetIndex, bounces, trapped: true };
}
