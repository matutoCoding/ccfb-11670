/**
 * 圆形明亮式切工参数化生成器。
 * 结构(标准 57 刻面拓扑):台面 1 + 星刻面 8 + 风筝面 8 + 上腰面 16
 * + 腰棱 16 + 下腰面 16 + 亭部主刻面 8 (+ 底尖)。
 * 半径归一化为 1(腰棱),y 轴向上,腰棱中心在原点。
 */
import { Vec3 } from '../math/vec3';
import { CutParams, FacetPoly } from './types';

const COS225 = Math.cos(Math.PI / 8); // cos 22.5°

/** 圆柱坐标 → 直角坐标(角度:度) */
function cyl(r: number, deg: number, y: number): Vec3 {
  const a = (deg * Math.PI) / 180;
  return [r * Math.cos(a), y, r * Math.sin(a)];
}

export function generateRoundBrilliant(p: CutParams): FacetPoly[] {
  const facets: FacetPoly[] = [];
  const rt = p.tablePct / 100;
  const rc = p.culetPct / 100;
  const gt = p.girdlePct / 100;
  const ygt = gt / 2; // 腰棱顶
  const ygb = -gt / 2; // 腰棱底
  const tanA = Math.tan((p.crownAngleDeg * Math.PI) / 180);
  const tanP = Math.tan((p.pavilionAngleDeg * Math.PI) / 180);

  // 各环高度(沿刻面平面的投影半径线性插值)
  const yt = ygt + (1 - rt) * tanA;
  // 星刻面顶点(风筝面肩点):投影半径在台面边与腰棱之间按 starPct 插值
  const projM = rt * COS225 + (1 - rt * COS225) * (p.starPct / 100);
  const rm = projM / COS225;
  const ym = ygt + (1 - projM) * tanA;
  // 下腰环:投影半径从腰棱到底尖按 lowerGirdlePct 插值
  const projL = 1 - (1 - rc) * (p.lowerGirdlePct / 100);
  const rp = projL / COS225;
  const yp = ygb - (1 - projL) * tanP;
  const yc = ygb - (1 - rc) * tanP;

  const T = (k: number) => cyl(rt, 45 * k, yt); // 台面八角 k=0..7
  const M = (k: number) => cyl(rm, 22.5 + 45 * k, ym); // 冠部中环(肩点) k=0..7
  const GT = (j: number) => cyl(1, 22.5 * j, ygt); // 腰棱顶 16 点
  const GB = (j: number) => cyl(1, 22.5 * j, ygb); // 腰棱底 16 点
  const L = (k: number) => cyl(rp, 22.5 + 45 * k, yp); // 亭部下腰环 k=0..7
  const C = (k: number) => cyl(rc, 45 * k, yc); // 底尖八角(rc=0 时为同一点)

  // 台面
  facets.push({
    name: '台面', group: 'table',
    verts: Array.from({ length: 8 }, (_, k) => T(k)),
  });
  // 星刻面:底边在台面边上,顶点指向肩点
  for (let k = 0; k < 8; k++) {
    facets.push({ name: `星刻面${k + 1}`, group: 'crown', verts: [T(k), T(k + 1), M(k)] });
  }
  // 风筝面(冠部主刻面)
  for (let k = 0; k < 8; k++) {
    facets.push({
      name: `风筝面${k + 1}`, group: 'crown',
      verts: [T(k), M(((k - 1) % 8 + 8) % 8), GT(2 * k), M(k)],
    });
  }
  // 上腰刻面 16
  for (let k = 0; k < 8; k++) {
    facets.push({ name: `上腰面${2 * k + 1}`, group: 'crown', verts: [M(k), GT(2 * k), GT(2 * k + 1)] });
    facets.push({ name: `上腰面${2 * k + 2}`, group: 'crown', verts: [M(k), GT(2 * k + 1), GT(2 * k + 2)] });
  }
  // 腰棱 16
  for (let j = 0; j < 16; j++) {
    facets.push({
      name: `腰棱${j + 1}`, group: 'girdle',
      verts: [GT(j), GT(j + 1), GB(j + 1), GB(j)],
    });
  }
  // 下腰刻面 16
  for (let k = 0; k < 8; k++) {
    facets.push({ name: `下腰面${2 * k + 1}`, group: 'pavilion', verts: [L(k), GB(2 * k + 1), GB(2 * k)] });
    facets.push({ name: `下腰面${2 * k + 2}`, group: 'pavilion', verts: [L(k), GB(2 * k + 2), GB(2 * k + 1)] });
  }
  // 亭部主刻面 8
  for (let k = 0; k < 8; k++) {
    facets.push({
      name: `亭部主刻面${k + 1}`, group: 'pavilion',
      verts: [GB(2 * k), L(((k - 1) % 8 + 8) % 8), C(k), L(k)],
    });
  }
  // 底尖
  if (rc > 0) {
    facets.push({
      name: '底尖', group: 'culet',
      verts: Array.from({ length: 8 }, (_, k) => C(k)),
    });
    // 下腰环到底尖的过渡三角
    for (let k = 0; k < 8; k++) {
      facets.push({ name: `底尖过渡${k + 1}`, group: 'pavilion', verts: [L(k), C(k), C(k + 1)] });
    }
  }
  return facets;
}
