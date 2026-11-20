/**
 * ASET / IdealScope 模拟。
 * 方法:观察者正交俯视台面,从每个像素向下反向追迹,
 * 光线最终逸出方向的仰角决定它"看到"天空哪个分区:
 *   75°–90° → 蓝(头部遮挡区)   45°–75° → 红(直射光区)
 *    0°–45° → 绿(环境漫射区)   从亭部漏出 → 黑
 * 全程确定性采样,无随机数——亭角微调时漏光面积连续变化。
 */
import { GemModel } from '../geometry/gem';
import { traceRay } from './tracer';
import { diamondIOR } from '../core/optics';
import { v3 } from '../core/vec3';

export type AsetZone = 'red' | 'green' | 'blue' | 'leak' | 'none';

export interface AsetSettings {
  size: number;          // 图像边长 px
  redMinDeg: number;     // 红区下限(默认 45)
  blueMinDeg: number;    // 蓝区下限(默认 75)
  wavelengthNm: number;  // ASET 为几何白光,默认 589.3
}

export const defaultAsetSettings = (): AsetSettings => ({
  size: 220, redMinDeg: 45, blueMinDeg: 75, wavelengthNm: 589.3,
});

export interface AsetMap {
  size: number;
  zones: AsetZone[];      // size*size
  /** 各类占比(仅石面内像素) */
  stats: Record<Exclude<AsetZone, 'none'>, number>;
}

export function computeAset(model: GemModel, s: AsetSettings): AsetMap {
  const n = s.size;
  const zones: AsetZone[] = new Array(n * n);
  const ior = diamondIOR(s.wavelengthNm);
  const extent = 1.15 * (model.params.shape === 'oval' ? model.params.ratio : 1);
  const counts = { red: 0, green: 0, blue: 0, leak: 0, none: 0 };

  for (let py = 0; py < n; py++) {
    for (let px = 0; px < n; px++) {
      const x = (px + 0.5) / n * 2 * extent - extent;
      const y = extent - (py + 0.5) / n * 2 * extent;
      const r = traceRay(model, { o: v3(x, y, 5), d: v3(0, 0, -1) }, ior, s.wavelengthNm);
      let zone: AsetZone;
      if (r.events.length === 0) {
        zone = 'none';
      } else if (r.escaped !== 'up' || !r.exitDir) {
        zone = 'leak';
      } else {
        const elev = Math.asin(Math.min(1, Math.max(-1, r.exitDir.z))) * 180 / Math.PI;
        zone = elev >= s.blueMinDeg ? 'blue' : elev >= s.redMinDeg ? 'red' : 'green';
      }
      zones[py * n + px] = zone;
      counts[zone]++;
    }
  }
  const inStone = counts.red + counts.green + counts.blue + counts.leak;
  const stats = {
    red: counts.red / inStone, green: counts.green / inStone,
    blue: counts.blue / inStone, leak: counts.leak / inStone,
  };
  return { size: n, zones, stats };
}

export type IdealZone = 'return' | 'contrast' | 'leak' | 'none';

/** IdealScope:红=返回的直射光,白/粉=头顶遮挡区返回,黑=漏光 */
export function computeIdealScope(model: GemModel, s: AsetSettings): {
  size: number; zones: IdealZone[]; stats: Record<Exclude<IdealZone, 'none'>, number>;
} {
  const n = s.size;
  const zones: IdealZone[] = new Array(n * n);
  const ior = diamondIOR(s.wavelengthNm);
  const extent = 1.15 * (model.params.shape === 'oval' ? model.params.ratio : 1);
  const counts = { return: 0, contrast: 0, leak: 0, none: 0 };
  for (let py = 0; py < n; py++) {
    for (let px = 0; px < n; px++) {
      const x = (px + 0.5) / n * 2 * extent - extent;
      const y = extent - (py + 0.5) / n * 2 * extent;
      const r = traceRay(model, { o: v3(x, y, 5), d: v3(0, 0, -1) }, ior, s.wavelengthNm);
      let zone: IdealZone;
      if (r.events.length === 0) zone = 'none';
      else if (r.escaped !== 'up' || !r.exitDir) zone = 'leak';
      else {
        const elev = Math.asin(Math.min(1, Math.max(-1, r.exitDir.z))) * 180 / Math.PI;
        zone = elev >= s.blueMinDeg ? 'contrast' : 'return';
      }
      zones[py * n + px] = zone;
      counts[zone]++;
    }
  }
  const inStone = counts.return + counts.contrast + counts.leak;
  return {
    size: n, zones,
    stats: { return: counts.return / inStone, contrast: counts.contrast / inStone, leak: counts.leak / inStone },
  };
}

/** 渲染 ASET 图到 canvas */
export function drawAset(map: AsetMap, canvas: HTMLCanvasElement): void {
  const colors: Record<AsetZone, string> = {
    red: '#e8322a', green: '#2fae4f', blue: '#2b5fd9', leak: '#111', none: '#8a8f98',
  };
  paint(map.size, map.zones, colors, canvas);
}

export function drawIdeal(
  map: { size: number; zones: IdealZone[] }, canvas: HTMLCanvasElement,
): void {
  const colors: Record<IdealZone, string> = {
    return: '#d81f26', contrast: '#f4f4f4', leak: '#0a0a0a', none: '#8a8f98',
  };
  paint(map.size, map.zones, colors, canvas);
}

function paint<T extends string>(
  size: number, zones: T[], colors: Record<T, string>, canvas: HTMLCanvasElement,
): void {
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const cache: Record<string, number[]> = {};
  for (let i = 0; i < zones.length; i++) {
    const c = colors[zones[i]];
    let rgb = cache[c];
    if (!rgb) {
      rgb = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
      cache[c] = rgb;
    }
    img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1];
    img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
