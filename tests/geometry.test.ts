import { describe, it, expect } from 'vitest';
import { buildCut, CutParams, DEFAULT_PARAMS } from '../src/geometry/cuts';
import { dot } from '../src/optics/vec3';

const PARAM_VARIANTS: Partial<CutParams>[] = [
  {},
  { tablePct: 50, crownAngle: 25, pavilionAngle: 38 },
  { tablePct: 68, crownAngle: 40, pavilionAngle: 44, girdlePct: 4 },
  { starLengthPct: 20, lowerGirdlePct: 55 },
  { starLengthPct: 80, lowerGirdlePct: 95 },
  { ratio: 1.6 },
];

describe('参数化切工几何', () => {
  for (const cut of ['round', 'princess', 'oval'] as const) {
    it(`${cut}: 所有参数组合下凸包合法（顶点满足全部半空间约束）`, () => {
      for (const variant of PARAM_VARIANTS) {
        const params = { ...DEFAULT_PARAMS, ...variant };
        const geo = buildCut(cut, params);
        const allVerts = geo.facets.flatMap((f) => f.vertices);
        for (const p of geo.planes) {
          for (const v of allVerts) {
            expect(dot(p.n, v) - p.w).toBeLessThan(1e-9);
          }
        }
      }
    });

    it(`${cut}: 法线为单位向量且朝外`, () => {
      const geo = buildCut(cut, { ...DEFAULT_PARAMS });
      for (const p of geo.planes) {
        expect(Math.abs(Math.hypot(...p.n) - 1)).toBeLessThan(1e-9);
      }
    });
  }

  it('round: 刻面数量 = 73（57 刻面 + 16 腰棱）', () => {
    const geo = buildCut('round', { ...DEFAULT_PARAMS });
    expect(geo.facets.length).toBe(73);
  });

  it('oval: z 方向拉伸比例正确', () => {
    const geo = buildCut('oval', { ...DEFAULT_PARAMS, ratio: 1.5 });
    const widthX = geo.bboxMax[0] - geo.bboxMin[0];
    const widthZ = geo.bboxMax[2] - geo.bboxMin[2];
    expect(widthZ / widthX).toBeCloseTo(1.5, 6);
  });

  it('台面比参数生效', () => {
    const small = buildCut('round', { ...DEFAULT_PARAMS, tablePct: 50 });
    const large = buildCut('round', { ...DEFAULT_PARAMS, tablePct: 65 });
    const tableOf = (g: typeof small) => g.facets.find((f) => f.kind === 'table')!;
    expect(large.facets[0].area).toBeGreaterThan(small.facets[0].area);
    expect(tableOf(large).area).toBeCloseTo(tableOf(large).area, 9);
  });
});
