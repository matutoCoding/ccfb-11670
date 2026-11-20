import { Vec3, Tri, v3, cross, sub, norm, add, scale, dot, rotateAround } from '../core/vec3';

/** 比例参数(证书口径) */
export interface ProportionParams {
  shape: 'round' | 'princess' | 'oval';
  tablePct: number;       // 台面比,% 直径
  crownAngle: number;     // 冠角,度
  pavilionAngle: number;  // 亭角,度
  girdlePct: number;      // 腰厚,% 直径
  culetPct: number;       // 底尖,% 直径(0=尖底)
  ratio: number;          // 椭圆长宽比(仅 oval)
  starLengthPct: number;  // 星刻面长度比 %(圆钻)
  lowerGirdlePct: number; // 下腰面长度比 %(圆钻)
  chevrons: number;       // 公主方亭部人字层数
}

export const defaultParams = (): ProportionParams => ({
  shape: 'round',
  tablePct: 57,
  crownAngle: 34.5,
  pavilionAngle: 40.75,
  girdlePct: 2.0,
  culetPct: 0,
  ratio: 1.35,
  starLengthPct: 50,
  lowerGirdlePct: 78,
  chevrons: 3,
});

/** 磨偏缺陷 */
export interface FacetTilt {
  kind: FacetKind;
  ring: number;        // 方位序号;-1 表示该组全部
  dTiltDeg: number;    // 倾角偏移(绕刻面方位切向轴)
  dAzimDeg: number;    // 方位偏移(绕竖直轴)
}
export interface DefectParams {
  tilts: FacetTilt[];
  girdleWaveAmpPct: number; // 腰部波浪径向振幅,% 半径
  girdleWaveLobes: number;  // 波浪瓣数
  girdleWavePhaseDeg: number;
}
export const defaultDefects = (): DefectParams => ({
  tilts: [], girdleWaveAmpPct: 0, girdleWaveLobes: 3, girdleWavePhaseDeg: 0,
});

export type FacetKind =
  | 'table' | 'star' | 'bezel' | 'upperGirdle' | 'girdle'
  | 'pavilionMain' | 'lowerGirdle' | 'culet'
  | 'crownSide' | 'pavilionSide'; // 公主方侧面(人字层)

export const KIND_NAMES: Record<FacetKind, string> = {
  table: '台面', star: '星刻面', bezel: '冠部主面', upperGirdle: '上腰面',
  girdle: '腰棱', pavilionMain: '亭部主面', lowerGirdle: '下腰面', culet: '底尖',
  crownSide: '冠部侧面', pavilionSide: '亭部人字面',
};

export interface Facet {
  id: number;
  kind: FacetKind;
  ring: number;      // 方位序号
  name: string;
  verts: Vec3[];     // 多边形顶点,外侧看逆时针
}

export interface GemModel {
  params: ProportionParams;
  facets: Facet[];
  tris: Tri[];
  /** 派生尺寸(以直径=2 归一) */
  derived: { crownHeightPct: number; pavilionDepthPct: number; totalDepthPct: number };
}

const DEG = Math.PI / 180;
const polar = (r: number, azDeg: number, z: number): Vec3 =>
  ({ x: r * Math.cos(azDeg * DEG), y: r * Math.sin(azDeg * DEG), z });

/** 由顶点列表构造刻面,法线按"质心朝外"定向 */
function makeFacet(id: number, kind: FacetKind, ring: number, verts: Vec3[]): Facet {
  const c = verts.reduce((a, v) => add(a, v), v3());
  const cen = scale(c, 1 / verts.length);
  const n = norm(cross(sub(verts[1], verts[0]), sub(verts[2], verts[1])));
  // 凸宝石:外法线与质心(相对中轴)同向
  const outward = dot(n, cen) > 0;
  const vs = outward ? verts : [...verts].reverse();
  const name = KIND_NAMES[kind] + (ring >= 0 ? `#${ring + 1}` : '');
  return { id, kind, ring, name, verts: vs };
}

function triangulate(facets: Facet[]): Tri[] {
  const tris: Tri[] = [];
  for (const f of facets) {
    for (let i = 1; i < f.verts.length - 1; i++) {
      const a = f.verts[0], b = f.verts[i], c = f.verts[i + 1];
      tris.push({ a, b, c, n: norm(cross(sub(b, a), sub(c, b))), facetId: f.id });
    }
  }
  return tris;
}

/** 圆形明亮式(57 刻面 + 腰棱) */
function buildRound(p: ProportionParams, wave: DefectParams): Facet[] {
  const R = 1;
  const cos22 = Math.cos(22.5 * DEG);
  const rT = (p.tablePct / 100) * R / cos22;            // 台面顶点半径(台面比按对边距)
  const g = (p.girdlePct / 100) * 2 * R;                // 腰厚(直径百分比)
  const rCu = p.culetPct > 0 ? (p.culetPct / 100) * R / cos22 : 0;
  const hC = (R - rT) * Math.tan(p.crownAngle * DEG);   // 冠高
  const dP = (R - rCu) * Math.tan(p.pavilionAngle * DEG); // 亭深
  const s = p.starLengthPct / 100;
  const rS = rT + s * (R - rT);                          // 星刻面外点半径
  const hS = hC * (R - rS * cos22) / (R - rT);           // 星点高度(保证主面共面)
  const f = p.lowerGirdlePct / 100;
  const rL = (R - f * (R - rCu)) / cos22;                // 下腰面尖点半径
  const zL = -g - f * dP;                                // 下腰面尖点深度

  // 16 个腰棱点(带波浪缺陷)
  const girdleR = (j: number) =>
    R * (1 + (wave.girdleWaveAmpPct / 100) * Math.sin(wave.girdleWaveLobes * j * 22.5 * DEG + wave.girdleWavePhaseDeg * DEG));
  const gvTop = (j: number) => polar(girdleR(((j % 16) + 16) % 16), j * 22.5, 0);
  const gvBot = (j: number) => polar(girdleR(((j % 16) + 16) % 16), j * 22.5, -g);

  const facets: Facet[] = [];
  let id = 0;
  // 台面(正八边形,顶点在主面方位)
  facets.push(makeFacet(id++, 'table', -1,
    Array.from({ length: 8 }, (_, k) => polar(rT, k * 45, hC))));
  for (let k = 0; k < 8; k++) {
    const az = k * 45;
    const T = polar(rT, az, hC);
    const Tn = polar(rT, az + 45, hC);
    const Sl = polar(rS, az - 22.5, hS);
    const Sr = polar(rS, az + 22.5, hS);
    // 星刻面
    facets.push(makeFacet(id++, 'star', k, [T, Tn, Sr]));
    // 冠部主面(风筝面)
    facets.push(makeFacet(id++, 'bezel', k, [T, Sr, gvTop(2 * k), Sl]));
    // 上腰面 ×2
    facets.push(makeFacet(id++, 'upperGirdle', 2 * k, [gvTop(2 * k), gvTop(2 * k + 1), Sr]));
    facets.push(makeFacet(id++, 'upperGirdle', 2 * k + 1, [gvTop(2 * k + 1), gvTop(2 * k + 2), Sr]));
  }
  // 腰棱 16 段
  for (let j = 0; j < 16; j++)
    facets.push(makeFacet(id++, 'girdle', j, [gvTop(j), gvTop(j + 1), gvBot(j + 1), gvBot(j)]));
  // 亭部
  const culetPt = v3(0, 0, -g - dP);
  for (let k = 0; k < 8; k++) {
    const az = k * 45;
    const Pl = polar(rL, az - 22.5, zL);
    const Pr = polar(rL, az + 22.5, zL);
    const C = rCu > 0 ? polar(rCu, az, -g - dP) : culetPt;
    facets.push(makeFacet(id++, 'pavilionMain', k, [gvBot(2 * k), Pr, C, Pl]));
    facets.push(makeFacet(id++, 'lowerGirdle', 2 * k, [gvBot(2 * k), gvBot(2 * k + 1), Pr]));
    facets.push(makeFacet(id++, 'lowerGirdle', 2 * k + 1, [gvBot(2 * k + 1), gvBot(2 * k + 2), Pr]));
  }
  if (rCu > 0)
    facets.push(makeFacet(id++, 'culet', -1,
      Array.from({ length: 8 }, (_, k) => polar(rCu, k * 45, -g - dP))));
  return facets;
}

/** 公主方(参数化人字层) */
function buildPrincess(p: ProportionParams, wave: DefectParams): Facet[] {
  const S = 1;                                        // 半宽
  const tH = (p.tablePct / 100) * S;                  // 台面半宽
  const g = (p.girdlePct / 100) * 2 * S;
  const hC = (S - tH) * Math.tan(p.crownAngle * DEG);
  const dP = S * Math.tan(p.pavilionAngle * DEG);
  const N = Math.max(1, Math.round(p.chevrons));
  const wob = (i: number) =>
    1 + (wave.girdleWaveAmpPct / 100) * Math.sin(wave.girdleWaveLobes * i * Math.PI / 2 + wave.girdleWavePhaseDeg * DEG);

  const sq = (w: number, z: number, k: number): Vec3 => { // k=0..3 四角
    const sx = k === 0 || k === 3 ? 1 : -1, sy = k < 2 ? 1 : -1;
    return v3(sx * w, sy * w, z);
  };
  const facets: Facet[] = [];
  let id = 0;
  facets.push(makeFacet(id++, 'table', -1, [sq(tH, hC, 0), sq(tH, hC, 1), sq(tH, hC, 2), sq(tH, hC, 3)]));
  // 冠部:台面→腰棱 4 个梯形
  for (let side = 0; side < 4; side++) {
    const a = sq(tH, hC, side), b = sq(tH, hC, (side + 1) % 4);
    const c = sq(S * wob(side), 0, (side + 1) % 4), d = sq(S * wob(side), 0, side);
    facets.push(makeFacet(id++, 'crownSide', side, [a, b, c, d]));
  }
  for (let side = 0; side < 4; side++)
    facets.push(makeFacet(id++, 'girdle', side,
      [sq(S * wob(side), 0, side), sq(S * wob(side), 0, (side + 1) % 4),
       sq(S * wob(side), -g, (side + 1) % 4), sq(S * wob(side), -g, side)]));
  // 亭部:N 层人字,每层 4 梯形,收到底尖点/小方底
  const rCu = p.culetPct > 0 ? (p.culetPct / 100) * S : 0;
  for (let tier = 0; tier < N; tier++) {
    const w0 = S - (S - rCu) * tier / N;
    const w1 = S - (S - rCu) * (tier + 1) / N;
    const z0 = -g - dP * tier / N, z1 = -g - dP * (tier + 1) / N;
    for (let side = 0; side < 4; side++) {
      const a = sq(w0, z0, side), b = sq(w0, z0, (side + 1) % 4);
      if (w1 <= 1e-6) {
        facets.push(makeFacet(id++, 'pavilionSide', tier * 4 + side, [a, b, v3(0, 0, z1)]));
      } else {
        facets.push(makeFacet(id++, 'pavilionSide', tier * 4 + side,
          [a, b, sq(w1, z1, (side + 1) % 4), sq(w1, z1, side)]));
      }
    }
  }
  if (rCu > 0)
    facets.push(makeFacet(id++, 'culet', -1,
      [sq(rCu, -g - dP, 0), sq(rCu, -g - dP, 1), sq(rCu, -g - dP, 2), sq(rCu, -g - dP, 3)]));
  return facets;
}

/** 应用刻面倾角缺陷(绕刻面质心旋转该刻面顶点拷贝) */
function applyTilts(facets: Facet[], tilts: FacetTilt[]): void {
  for (const t of tilts) {
    for (const f of facets) {
      if (f.kind !== t.kind) continue;
      if (t.ring >= 0 && f.ring !== t.ring) continue;
      const cen = scale(f.verts.reduce((a, v) => add(a, v), v3()), 1 / f.verts.length);
      const az = Math.atan2(cen.y, cen.x);
      const tangential = v3(-Math.sin(az), Math.cos(az), 0); // 切向轴→改倾角
      f.verts = f.verts.map(v => {
        let r = sub(v, cen);
        if (t.dTiltDeg) r = rotateAround(r, tangential, t.dTiltDeg * DEG);
        if (t.dAzimDeg) r = rotateAround(r, v3(0, 0, 1), t.dAzimDeg * DEG);
        return add(r, cen);
      });
    }
  }
}

export function buildGem(params: ProportionParams, defects: DefectParams): GemModel {
  let facets = params.shape === 'princess' ? buildPrincess(params, defects) : buildRound(params, defects);
  applyTilts(facets, defects.tilts);
  if (params.shape === 'oval') {
    for (const f of facets) f.verts = f.verts.map(v => v3(v.x * params.ratio, v.y, v.z));
  }
  // 重新定向(缺陷扰动后保持外法线)
  facets = facets.map(f => makeFacet(f.id, f.kind, f.ring, f.verts));
  const tris = triangulate(facets);
  const cos22 = Math.cos(22.5 * DEG);
  const rT = (params.tablePct / 100) / (params.shape === 'princess' ? 1 : cos22);
  const crownHeightPct = (1 - rT) * Math.tan(params.crownAngle * DEG) * 50;
  const pavilionDepthPct = Math.tan(params.pavilionAngle * DEG) * 50;
  return {
    params, facets, tris,
    derived: {
      crownHeightPct,
      pavilionDepthPct,
      totalDepthPct: crownHeightPct + pavilionDepthPct + params.girdlePct,
    },
  };
}
