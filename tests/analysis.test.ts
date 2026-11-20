/** 光学分析物理合理性:已知切工缺陷必须产生可观测的评分差异 */
import { describe, it, expect } from 'vitest';
import { generateGem } from '../src/geometry/generate';
import { analyzeGem } from '../src/analysis/analyze';
import { DEFAULT_PARAMS } from '../src/geometry/types';

describe('光学分析', () => {
  it('标准圆钻:高亮度、低漏光', async () => {
    const gem = generateGem(DEFAULT_PARAMS.round);
    const r = await analyzeGem(gem, 0, 48, () => {});
    expect(r.brightness).toBeGreaterThan(70);
    expect(r.leakagePct).toBeLessThan(10);
    expect(r.fire).toBeGreaterThan(0);
    expect(r.scintillation).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('亭角过浅(36°)漏光显著高于标准切工', async () => {
    const ideal = await analyzeGem(generateGem(DEFAULT_PARAMS.round), 0, 48, () => {});
    const shallow = await analyzeGem(
      generateGem({ ...DEFAULT_PARAMS.round, pavilionAngleDeg: 36 }),
      0, 48, () => {},
    );
    expect(shallow.leakagePct).toBeGreaterThan(ideal.leakagePct * 1.5);
    expect(shallow.brightness).toBeLessThan(ideal.brightness);
  }, 120000);
});
