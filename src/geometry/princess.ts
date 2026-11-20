/**
 * 公主方切工参数化生成器(简化模型)。
 * 正方形,半边长归一化为 1。冠部 4 梯形 + 台面;亭部为若干层人字刻面,
 * 每层角度递增(保证凸性),末端到底尖点/底尖方面。
 */
import { Vec3 } from '../math/vec3';
import { CutParams, FacetPoly } from './types';

export function generatePrincess(p: CutParams): FacetPoly[] {
  const facets: FacetPoly[] = [];
  const ts = p.tablePct / 100;
  const rc = p.culetPct / 100;
  const gt = p.girdlePct / 100;
  const ygt = gt / 2;
  const ygb = -gt / 2;
  const tanA = Math.tan((p.crownAngleDeg * Math.PI) / 180);
  const yt = ygt + (1 - ts) * tanA;

  // 台面
  facets.push({
    name: '台面', group: 'table',
    verts: [
      [ts, yt, ts], [-ts, yt, ts], [-ts, yt, -ts], [ts, yt, -ts],
    ],
  });
  // 冠部 4 梯形(每边一个)
  const sides: Array<[Vec3, Vec3, Vec3, Vec3]> = [
    [[1, ygt, 1], [1, ygt, -1], [ts, yt, -ts], [ts, yt, ts]],       // +x
    [[1, ygt, -1], [-1, ygt, -1], [-ts, yt, -ts], [ts, yt, -ts]],   // -z
    [[-1, ygt, -1], [-1, ygt, 1], [-ts, yt, ts], [-ts, yt, -ts]],   // -x
    [[-1, ygt, 1], [1, ygt, 1], [ts, yt, ts], [-ts, yt, ts]],       // +z
  ];
  sides.forEach((verts, i) => facets.push({ name: `冠部主刻面${i + 1}`, group: 'crown', verts }));
  // 腰棱 4
  const girdle: Vec3[][] = [
    [[1, ygt, 1], [1, ygt, -1], [1, ygb, -1], [1, ygb, 1]],
    [[1, ygt, -1], [-1, ygt, -1], [-1, ygb, -1], [1, ygb, -1]],
    [[-1, ygt, -1], [-1, ygt, 1], [-1, ygb, 1], [-1, ygb, -1]],
    [[-1, ygt, 1], [1, ygt, 1], [1, ygb, 1], [-1, ygb, 1]],
  ];
  girdle.forEach((verts, i) => facets.push({ name: `腰棱${i + 1}`, group: 'girdle', verts }));

  // 亭部人字层:环 k 半边长 s_k,高度 y_k。
  // 凸性要求层角向底尖方向递减(外凸亭部),故 angle_k = 亭角 - k·递增量。
  const C = Math.max(1, Math.round(p.chevronTiers));
  const s: number[] = [];
  const y: number[] = [ygb];
  for (let k = 0; k <= C; k++) s.push(k === C ? rc : 1 - ((1 - rc) * k) / C);
  for (let k = 1; k <= C; k++) {
    const ang = ((p.pavilionAngleDeg - (k - 1) * p.chevronStepDeg) * Math.PI) / 180;
    y.push(y[k - 1] - (s[k - 1] - s[k]) * Math.tan(ang));
  }
  // 每层 4 个侧面刻面(最后一层到底尖点时为三角)
  for (let k = 0; k < C; k++) {
    const s0 = s[k], s1 = s[k + 1], y0 = y[k], y1 = y[k + 1];
    const ring = (ss: number, yy: number): Vec3[] => [
      [ss, yy, ss], [ss, yy, -ss], [-ss, yy, -ss], [-ss, yy, ss],
    ];
    const r0 = ring(s0, y0);
    if (s1 === 0) {
      for (let i = 0; i < 4; i++) {
        facets.push({
          name: `亭部${k + 1}层${i + 1}`, group: 'pavilion',
          verts: [r0[i], r0[(i + 1) % 4], [0, y1, 0]],
        });
      }
    } else {
      const r1 = ring(s1, y1);
      for (let i = 0; i < 4; i++) {
        facets.push({
          name: `亭部${k + 1}层${i + 1}`, group: 'pavilion',
          verts: [r0[i], r0[(i + 1) % 4], r1[(i + 1) % 4], r1[i]],
        });
      }
    }
  }
  // 底尖方
  if (rc > 0) {
    const yc = y[C];
    facets.push({
      name: '底尖', group: 'culet',
      verts: [[rc, yc, rc], [rc, yc, -rc], [-rc, yc, -rc], [-rc, yc, rc]],
    });
  }
  return facets;
}
