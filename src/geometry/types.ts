import { Vec3 } from '../math/vec3';

export type CutShape = 'round' | 'princess' | 'oval';

/** 参数化切工参数(比例均相对于腰棱直径/边长) */
export interface CutParams {
  shape: CutShape;
  /** 台面比 %(台面宽/腰棱宽) */
  tablePct: number;
  /** 冠角(度,刻面与腰棱面夹角) */
  crownAngleDeg: number;
  /** 亭角(度) */
  pavilionAngleDeg: number;
  /** 腰棱厚度 %(相对直径) */
  girdlePct: number;
  /** 星刻面长度比 %(星刻面占冠部水平距离比例) 圆钻/椭圆有效 */
  starPct: number;
  /** 下腰刻面长度比 %(占亭部水平距离) 圆钻/椭圆有效 */
  lowerGirdlePct: number;
  /** 底尖比 %(0 = 尖底) */
  culetPct: number;
  /** 公主方:亭部人字刻面层数 */
  chevronTiers: number;
  /** 公主方:每层人字刻面角度递减量(度,向底尖递减以保持凸性) */
  chevronStepDeg: number;
  /** 椭圆:长宽比 */
  ovalRatio: number;
}

export const DEFAULT_PARAMS: Record<CutShape, CutParams> = {
  round: {
    shape: 'round', tablePct: 57, crownAngleDeg: 34.5, pavilionAngleDeg: 40.8,
    girdlePct: 1.8, starPct: 50, lowerGirdlePct: 77, culetPct: 0,
    chevronTiers: 3, chevronStepDeg: 2.5, ovalRatio: 1.35,
  },
  princess: {
    shape: 'princess', tablePct: 68, crownAngleDeg: 32, pavilionAngleDeg: 39.5,
    girdlePct: 2.2, starPct: 50, lowerGirdlePct: 77, culetPct: 0,
    chevronTiers: 3, chevronStepDeg: 2.5, ovalRatio: 1.35,
  },
  oval: {
    shape: 'oval', tablePct: 56, crownAngleDeg: 34, pavilionAngleDeg: 40.5,
    girdlePct: 1.8, starPct: 50, lowerGirdlePct: 77, culetPct: 0,
    chevronTiers: 3, chevronStepDeg: 2.5, ovalRatio: 1.35,
  },
};

export type FacetGroup = 'table' | 'crown' | 'girdle' | 'pavilion' | 'culet';

/** 一个刻面:有序顶点多边形(从外侧看逆时针) */
export interface FacetPoly {
  name: string;
  group: FacetGroup;
  verts: Vec3[];
}
