/** 三维向量工具,统一用元组表示,物理计算全部用 float64(JS number) */
export type Vec3 = [number, number, number];

export const v3 = (x: number, y: number, z: number): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const negate = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

/** 两向量夹角(度)。先各自归一化:只比较方向,不受长度误差影响 */
export const angleDeg = (a: Vec3, b: Vec3): number => {
  const cos = dot(a, b) / (length(a) * length(b));
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
};
