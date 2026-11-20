/** 几何生成器验证:刻面数、凸性、法线朝外、参数影响 */
import { describe, it, expect } from 'vitest';
import { generateGem } from '../src/geometry/generate';
import { DEFAULT_PARAMS } from '../src/geometry/types';
import { dot, sub } from '../src/math/vec3';

describe('圆形明亮式', () => {
  it('标准参数生成 73 刻面(57 主刻面 + 16 腰棱)且为凸体', () => {
    const gem = generateGem(DEFAULT_PARAMS.round);
    // 57 为标准计数(不含腰棱):台面1+星8+风筝8+上腰16+下腰16+亭主8
    expect(gem.facets.length).toBe(73);
    expect(gem.facets.filter((f) => f.group !== 'girdle').length).toBe(57);
    // 所有平面法线朝外:中心在每个平面内侧
    for (const p of gem.planes) {
      expect(dot(p.n, gem.center)).toBeLessThan(p.d);
    }
  });

  it('台面比影响台面宽度', () => {
    const small = generateGem({ ...DEFAULT_PARAMS.round, tablePct: 50 });
    const large = generateGem({ ...DEFAULT_PARAMS.round, tablePct: 65 });
    const tableRadius = (g: typeof small) =>
      Math.hypot(g.facets[0].verts[0][0], g.facets[0].verts[0][2]);
    expect(tableRadius(large)).toBeGreaterThan(tableRadius(small));
  });

  it('亭角影响全深', () => {
    const shallow = generateGem({ ...DEFAULT_PARAMS.round, pavilionAngleDeg: 38 });
    const deep = generateGem({ ...DEFAULT_PARAMS.round, pavilionAngleDeg: 42 });
    expect(deep.depth).toBeGreaterThan(shallow.depth);
  });

  it('非凸参数组合被校验器拒绝', () => {
    // 公主方亭部层角递增(负递减量)→ 亭部内凹 → 非凸
    expect(() => generateGem({ ...DEFAULT_PARAMS.princess, chevronStepDeg: -8 }))
      .toThrow(/非凸/);
  });
});

describe('公主方', () => {
  it('生成凸体,刻面数 = 1+4+4+4·层数', () => {
    const gem = generateGem(DEFAULT_PARAMS.princess);
    const tiers = DEFAULT_PARAMS.princess.chevronTiers;
    expect(gem.facets.length).toBe(1 + 4 + 4 + 4 * tiers);
  });
});

describe('椭圆', () => {
  it('长宽比生效且保持凸性', () => {
    const gem = generateGem({ ...DEFAULT_PARAMS.oval, ovalRatio: 1.5 });
    const xs = gem.meshPositions.filter((_, i) => i % 3 === 0);
    const zs = gem.meshPositions.filter((_, i) => i % 3 === 2);
    const rangeX = Math.max(...xs) - Math.min(...xs);
    const rangeZ = Math.max(...zs) - Math.min(...zs);
    expect(rangeX / rangeZ).toBeCloseTo(1.5, 2);
  });
});

describe('法线一致性', () => {
  it('每个刻面 Newell 法线均朝外(背离质心)', () => {
    for (const shape of ['round', 'princess', 'oval'] as const) {
      const gem = generateGem(DEFAULT_PARAMS[shape]);
      for (let i = 0; i < gem.facets.length; i++) {
        const c = gem.facets[i].verts
          .reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0])
          .map((x) => x / gem.facets[i].verts.length) as [number, number, number];
        expect(dot(gem.planes[i].n, sub(c, gem.center))).toBeGreaterThan(0);
      }
    }
  });
});
