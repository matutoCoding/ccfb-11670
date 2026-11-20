/**
 * 双精度三维向量 / 光线几何基础。
 * 全部用 number(f64) 计算,保证斯涅尔定律逐次折射角与手算误差 < 0.01°。
 */

export interface Vec3 { x: number; y: number; z: number; }

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 0 ? scale(a, 1 / l) : { x: 0, y: 0, z: 0 };
};
/** 两向量夹角(度) */
export const angleDeg = (a: Vec3, b: Vec3): number =>
  Math.acos(Math.min(1, Math.max(-1, dot(norm(a), norm(b))))) * 180 / Math.PI;

/** 绕任意单位轴旋转向量(罗德里格斯公式),angle 弧度 */
export function rotateAround(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const k = norm(axis);
  const term1 = scale(v, c);
  const term2 = scale(cross(k, v), s);
  const term3 = scale(k, dot(k, v) * (1 - c));
  return add(add(term1, term2), term3);
}

export interface Ray { o: Vec3; d: Vec3; } // d 为单位向量

/** 三角形(刻面三角化后的最小单元) */
export interface Tri {
  a: Vec3; b: Vec3; c: Vec3;
  n: Vec3;        // 单位法线,指向宝石外部
  facetId: number; // 所属刻面
}

/** Möller–Trumbore 射线-三角形求交,返回距离 t 或 null */
export function intersectTri(ray: Ray, tri: Tri): number | null {
  const EPS = 1e-12;
  const e1 = sub(tri.b, tri.a);
  const e2 = sub(tri.c, tri.a);
  const p = cross(ray.d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < EPS) return null;
  const inv = 1 / det;
  const tvec = sub(ray.o, tri.a);
  const u = dot(tvec, p) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const q = cross(tvec, e1);
  const v = dot(ray.d, q) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const t = dot(e2, q) * inv;
  return t > 1e-9 ? t : null;
}

/** 射线与三角网格最近交点 */
export function intersectMesh(ray: Ray, tris: Tri[]): { t: number; tri: Tri } | null {
  let best: { t: number; tri: Tri } | null = null;
  for (const tri of tris) {
    const t = intersectTri(ray, tri);
    if (t !== null && (best === null || t < best.t)) best = { t, tri };
  }
  return best;
}
