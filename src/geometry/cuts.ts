import { Vec3, cross, sub, normalize, dot } from '../optics/vec3';
import { Plane } from '../optics/raytrace';

export type CutType = 'round' | 'princess' | 'oval';

export interface CutParams {
  /** 台面比：台面直径 / 腰棱直径 (%)，典型 53–66 */
  tablePct: number;
  /** 冠角（度），典型 30–35 */
  crownAngle: number;
  /** 亭角（度），典型 40.2–41.2 */
  pavilionAngle: number;
  /** 腰棱厚度占直径 (%)，典型 1.5–3 */
  girdlePct: number;
  /** 星刻面长度比 (%)，0–100 */
  starLengthPct: number;
  /** 下腰刻面长度比 (%)，0–100 */
  lowerGirdlePct: number;
  /** 椭圆长宽比（仅 oval 使用） */
  ratio: number;
}

export const DEFAULT_PARAMS: CutParams = {
  tablePct: 57,
  crownAngle: 34.5,
  pavilionAngle: 40.8,
  girdlePct: 2.0,
  starLengthPct: 50,
  lowerGirdlePct: 75,
  ratio: 1.35,
};

export type FacetKind =
  | 'table' | 'star' | 'bezel' | 'upperGirdle'
  | 'girdle' | 'lowerGirdle' | 'pavilion' | 'culet';

export const FACET_KIND_LABEL: Record<FacetKind, string> = {
  table: '台面', star: '星刻面', bezel: '冠部主刻面', upperGirdle: '上腰刻面',
  girdle: '腰棱', lowerGirdle: '下腰刻面', pavilion: '亭部主刻面', culet: '底尖',
};

export interface Facet {
  name: string;
  kind: FacetKind;
  /** 多边形顶点（从外侧看逆时针） */
  vertices: Vec3[];
  area: number;
}

export interface GemGeometry {
  planes: Plane[];
  facets: Facet[];
  /** 三角化后的顶点流（每 3 个顶点一个三角形），供网格渲染 */
  triangles: Float32Array;
  bboxMin: Vec3;
  bboxMax: Vec3;
}

const deg = (d: number) => (d * Math.PI) / 180;

/** 由刻面多边形构建几何：自动统一法线朝外、三角化、算面积 */
export function buildGeometry(facets: Facet[]): GemGeometry {
  // 整体质心（用于判断外法线方向）
  const center: Vec3 = [0, 0, 0];
  let count = 0;
  for (const f of facets) for (const v of f.vertices) {
    center[0] += v[0]; center[1] += v[1]; center[2] += v[2]; count++;
  }
  center[0] /= count; center[1] /= count; center[2] /= count;

  const planes: Plane[] = [];
  const tris: number[] = [];
  const bboxMin: Vec3 = [Infinity, Infinity, Infinity];
  const bboxMax: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const f of facets) {
    const vs = f.vertices;
    // Newell 法求法线，对非严格平面多边形也稳健
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    let n = normalize([nx, ny, nz]);
    // 质心
    const c: Vec3 = [0, 0, 0];
    for (const v of vs) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }
    c[0] /= vs.length; c[1] /= vs.length; c[2] /= vs.length;
    // 法线必须背离整体质心
    if (dot(n, sub(c, center)) < 0) {
      n = [-n[0], -n[1], -n[2]];
      vs.reverse();
    }
    planes.push({ n, w: dot(n, vs[0]) });
    // 面积（扇形三角剖分）
    let area = 0;
    for (let i = 1; i < vs.length - 1; i++) {
      const e1 = sub(vs[i], vs[0]);
      const e2 = sub(vs[i + 1], vs[0]);
      const cr = cross(e1, e2);
      area += Math.hypot(cr[0], cr[1], cr[2]) / 2;
      tris.push(...vs[0], ...vs[i], ...vs[i + 1]);
    }
    f.area = area;
    for (const v of vs) for (let k = 0; k < 3; k++) {
      bboxMin[k] = Math.min(bboxMin[k], v[k]);
      bboxMax[k] = Math.max(bboxMax[k], v[k]);
    }
  }
  return { planes, facets, triangles: new Float32Array(tris), bboxMin, bboxMax };
}

/** 圆形明亮式（8 重对称，57 刻面结构 + 腰棱） */
export function buildRoundBrilliant(p: CutParams): GemGeometry {
  const rT = p.tablePct / 100;
  const tanC = Math.tan(deg(p.crownAngle));
  const tanP = Math.tan(deg(p.pavilionAngle));
  const g = (p.girdlePct / 100) * 2; // 直径为 2
  const hC = (1 - rT) * tanC;
  const hP = tanP;
  const s = p.starLengthPct / 100;
  const l = p.lowerGirdlePct / 100;
  const cos22 = Math.cos(deg(22.5));

  // 星刻面顶点：半径线性插值，高度严格落在冠部主刻面平面上（保证风筝面共面）
  const rB = (1 - s) * rT * cos22 + s * 1;
  const hB = (1 - rB * cos22) * tanC;
  // 下腰刻面顶点同理
  const rL = 1 - l;
  const hL = -g - (1 - rL * cos22) * tanP;

  const pt = (az: number, r: number, y: number): Vec3 => [
    r * Math.cos(deg(az)), y, r * Math.sin(deg(az)),
  ];

  const T: Vec3[] = [], B: Vec3[] = [], G: Vec3[] = [], H: Vec3[] = [];
  const G2: Vec3[] = [], H2: Vec3[] = [], L: Vec3[] = [];
  for (let k = 0; k < 8; k++) {
    T.push(pt(45 * k, rT, hC));
    B.push(pt(22.5 + 45 * k, rB, hB));
    G.push(pt(45 * k, 1, 0));
    H.push(pt(22.5 + 45 * k, 1, 0));
    G2.push(pt(45 * k, 1, -g));
    H2.push(pt(22.5 + 45 * k, 1, -g));
    L.push(pt(22.5 + 45 * k, rL, hL));
  }
  const C: Vec3 = [0, -g - hP, 0];
  const M = (k: number) => ((k % 8) + 8) % 8;

  const facets: Facet[] = [];
  facets.push({ name: '台面', kind: 'table', vertices: [...T], area: 0 });
  for (let k = 0; k < 8; k++) {
    facets.push({ name: `星刻面 ${k + 1}`, kind: 'star', vertices: [T[k], T[M(k + 1)], B[k]], area: 0 });
    facets.push({ name: `冠部主刻面 ${k + 1}`, kind: 'bezel', vertices: [T[k], B[M(k - 1)], G[k], B[k]], area: 0 });
    facets.push({ name: `上腰刻面 ${2 * k + 1}`, kind: 'upperGirdle', vertices: [B[k], H[k], G[k]], area: 0 });
    facets.push({ name: `上腰刻面 ${2 * k + 2}`, kind: 'upperGirdle', vertices: [B[k], G[M(k + 1)], H[k]], area: 0 });
    facets.push({ name: `下腰刻面 ${2 * k + 1}`, kind: 'lowerGirdle', vertices: [L[k], G2[M(k + 1)], H2[k]], area: 0 });
    facets.push({ name: `下腰刻面 ${2 * k + 2}`, kind: 'lowerGirdle', vertices: [L[k], H2[k], G2[k]], area: 0 });
    facets.push({ name: `亭部主刻面 ${k + 1}`, kind: 'pavilion', vertices: [G2[k], L[M(k - 1)], C, L[k]], area: 0 });
  }
  for (let k = 0; k < 8; k++) {
    facets.push({ name: `腰棱 ${2 * k + 1}`, kind: 'girdle', vertices: [G[k], H[k], H2[k], G2[k]], area: 0 });
    facets.push({ name: `腰棱 ${2 * k + 2}`, kind: 'girdle', vertices: [H[k], G[M(k + 1)], G2[M(k + 1)], H2[k]], area: 0 });
  }
  return buildGeometry(facets);
}

/** 公主方（方形腰棱，简化结构：台面 + 4 冠部主刻面 + 腰棱 + 4 亭部主刻面） */
export function buildPrincess(p: CutParams): GemGeometry {
  const t = p.tablePct / 100;
  const tanC = Math.tan(deg(p.crownAngle));
  const tanP = Math.tan(deg(p.pavilionAngle));
  const g = (p.girdlePct / 100) * 2;
  const hC = (1 - t) * tanC;
  const hP = tanP;
  const C: Vec3 = [0, -g - hP, 0];

  // 四个角：(±1, ±1)，边中点方向为主刻面法向
  const tc: Vec3[] = [[t, hC, t], [-t, hC, t], [-t, hC, -t], [t, hC, -t]]; // 台面四角
  const gc: Vec3[] = [[1, 0, 1], [-1, 0, 1], [-1, 0, -1], [1, 0, -1]];     // 腰棱顶四角
  const gc2: Vec3[] = gc.map((v) => [v[0], -g, v[2]] as Vec3);            // 腰棱底四角

  const facets: Facet[] = [];
  facets.push({ name: '台面', kind: 'table', vertices: [...tc], area: 0 });
  // 冠部主刻面：每边一个梯形（相邻梯形共用 台角→腰角 的棱，天然封闭）
  for (let k = 0; k < 4; k++) {
    const a = tc[k], b = tc[(k + 1) % 4];
    const ga = gc[k], gb = gc[(k + 1) % 4];
    facets.push({ name: `冠部主刻面 ${k + 1}`, kind: 'bezel', vertices: [a, b, gb, ga], area: 0 });
  }
  for (let k = 0; k < 4; k++) {
    const ga = gc[k], gb = gc[(k + 1) % 4];
    const ga2 = gc2[k], gb2 = gc2[(k + 1) % 4];
    facets.push({ name: `腰棱 ${k + 1}`, kind: 'girdle', vertices: [ga, gb, gb2, ga2], area: 0 });
    facets.push({ name: `亭部主刻面 ${k + 1}`, kind: 'pavilion', vertices: [ga2, gb2, C], area: 0 });
  }
  return buildGeometry(facets);
}

/** 椭圆切工：圆形明亮式沿 z 轴拉伸，法线由顶点重算 */
export function buildOval(p: CutParams): GemGeometry {
  const ratio = Math.max(1.05, p.ratio);
  const round = buildRoundBrilliant(p);
  // 注意：顶点数组在多个刻面间共享，必须先收集唯一顶点再缩放
  const unique = new Set<Vec3>();
  for (const f of round.facets) {
    for (const v of f.vertices) unique.add(v);
  }
  for (const v of unique) v[2] *= ratio;
  return buildGeometry(round.facets);
}

export function buildCut(cut: CutType, params: CutParams): GemGeometry {
  switch (cut) {
    case 'round': return buildRoundBrilliant(params);
    case 'princess': return buildPrincess(params);
    case 'oval': return buildOval(params);
  }
}
