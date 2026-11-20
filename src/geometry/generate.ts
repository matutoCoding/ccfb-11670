/** 切工生成入口:圆形/公主方/椭圆(椭圆 = 圆钻沿 x 拉伸) */
import { CutParams, FacetPoly } from './types';
import { generateRoundBrilliant } from './roundBrilliant';
import { generatePrincess } from './princess';
import { Gem, buildGem } from './gem';

export function generateFacets(p: CutParams): FacetPoly[] {
  switch (p.shape) {
    case 'round':
      return generateRoundBrilliant(p);
    case 'princess':
      return generatePrincess(p);
    case 'oval': {
      const ratio = Math.max(1.05, p.ovalRatio);
      return generateRoundBrilliant(p).map((f) => ({
        ...f,
        verts: f.verts.map(([x, y, z]) => [x * ratio, y, z] as [number, number, number]),
      }));
    }
  }
}

export function generateGem(p: CutParams): Gem {
  return buildGem(generateFacets(p));
}
