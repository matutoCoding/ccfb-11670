/**
 * 环境光模型(CPU 版,用于光学分析)。
 * 与 render/shaders.ts 中的 WGSL envColor 一一对应,改动必须两边同步。
 * 返回值是线性 RGB 亮度。
 */
import { Vec3, dot, normalize } from '../math/vec3';

export type EnvType = 0 | 1 | 2; // 0 珠宝柜台灯 1 自然光 2 点光源
export const ENV_NAMES = ['珠宝柜台灯', '自然光', '点光源'] as const;

function lobe(dir: Vec3, target: Vec3, sharpness: number): number {
  return Math.pow(Math.max(0, dot(dir, target)), sharpness);
}

export function envColor(dir: Vec3, type: EnvType): Vec3 {
  const d = normalize(dir);
  if (type === 0) {
    // 珠宝柜台:深色背景 + 顶部柔光箱 + 三盏暖色射灯
    let r = 0.03, g = 0.03, b = 0.03;
    const spots: Array<{ dir: Vec3; sharp: number; i: number }> = [
      { dir: normalize([0.5, 1, 0.3]), sharp: 350, i: 5.0 },
      { dir: normalize([-0.6, 1, -0.2]), sharp: 300, i: 4.0 },
      { dir: normalize([0.05, 1, -0.75]), sharp: 400, i: 3.5 },
    ];
    for (const s of spots) {
      const v = lobe(d, s.dir, s.sharp) * s.i + lobe(d, s.dir, 12) * 0.12;
      r += v * 1.0; g += v * 0.88; b += v * 0.72;
    }
    // 顶部大面积柔光(灯箱)
    const soft = lobe(d, [0, 1, 0], 5) * 0.55;
    r += soft; g += soft * 0.95; b += soft * 0.88;
    if (d[1] < 0) { r = 0.012; g = 0.012; b = 0.012; } // 柜台下方近乎无光
    return [r, g, b];
  }
  if (type === 1) {
    // 自然光:天空渐变 + 太阳 + 地面
    if (d[1] < 0) return [0.12, 0.13, 0.11];
    const t = Math.min(1, d[1]);
    let r = 0.85 + (0.35 - 0.85) * t;
    let g = 0.9 + (0.55 - 0.9) * t;
    let b = 0.98 + (0.85 - 0.98) * t;
    const sun = lobe(d, normalize([0.4, 0.75, 0.5]), 1500) * 6;
    r += sun; g += sun * 0.96; b += sun * 0.88;
    return [r, g, b];
  }
  // 点光源:单一强点光 + 极暗环境
  const v = lobe(d, normalize([0.3, 1, 0.25]), 1200) * 8 + 0.008;
  return [v, v * 0.98, v * 0.95];
}
