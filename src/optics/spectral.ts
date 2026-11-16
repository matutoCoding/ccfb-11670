/** 光谱采样与波长→RGB 转换（用于色散计算与火彩分析） */

/** 默认追踪波长组（nm），覆盖可见光谱 */
export const WAVELENGTH_SETS: Record<number, number[]> = {
  1: [550],
  3: [470, 550, 650],
  5: [450, 500, 550, 600, 650],
  7: [430, 470, 510, 550, 590, 630, 670],
};

/**
 * 波长(nm) → 线性 RGB 近似（Bruton 分段法，含强度衰减）。
 * 与 WGSL 中的 waveRGB 保持一致。
 */
export function wavelengthToRGB(lambda: number): [number, number, number] {
  let r = 0, g = 0, b = 0;
  if (lambda >= 380 && lambda < 440) {
    r = -(lambda - 440) / 60; g = 0; b = 1;
  } else if (lambda >= 440 && lambda < 490) {
    r = 0; g = (lambda - 440) / 50; b = 1;
  } else if (lambda >= 490 && lambda < 510) {
    r = 0; g = 1; b = -(lambda - 510) / 20;
  } else if (lambda >= 510 && lambda < 580) {
    r = (lambda - 510) / 70; g = 1; b = 0;
  } else if (lambda >= 580 && lambda < 645) {
    r = 1; g = -(lambda - 645) / 65; b = 0;
  } else if (lambda >= 645 && lambda <= 780) {
    r = 1; g = 0; b = 0;
  }
  let factor = 1;
  if (lambda >= 380 && lambda < 420) factor = 0.3 + 0.7 * (lambda - 380) / 40;
  else if (lambda > 700 && lambda <= 780) factor = 0.3 + 0.7 * (780 - lambda) / 80;
  return [r * factor, g * factor, b * factor];
}

/** 把一组 (波长, 光通量) 累加成 RGB（等通量白光 → 等亮度灰） */
export function spectralToRGB(samples: { lambda: number; flux: number }[]): [number, number, number] {
  let r = 0, g = 0, b = 0, wSum = 0;
  for (const s of samples) {
    const [wr, wg, wb] = wavelengthToRGB(s.lambda);
    r += wr * s.flux; g += wg * s.flux; b += wb * s.flux;
    wSum += Math.max(wr, wg, wb);
  }
  if (wSum <= 0) return [0, 0, 0];
  return [r / wSum, g / wSum, b / wSum];
}
