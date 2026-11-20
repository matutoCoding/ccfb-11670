/**
 * 八心八箭观测与对称度分析。
 * 箭:台面朝上,头部遮挡(75°–90°)返回的暗区图案。
 * 心:亭部朝上(底朝上俯视),同样取头部遮挡区图案。
 * 对称度:把图案按 8 个 45° 扇区折叠比较,找出偏差最大的扇区,
 * 并把偏差归因到该扇区内法线偏离对称理想值最大的刻面。
 */
import { GemModel, Facet, KIND_NAMES } from '../geometry/gem';
import { traceRay } from './tracer';
import { diamondIOR } from '../core/optics';
import { v3, Vec3, norm, dot, cross, sub } from '../core/vec3';

export interface HAMap {
  size: number;
  dark: Float32Array; // 0..1 暗度(头部遮挡区返回强度)
}

/** 从 +z(或 -z)正交观测,统计返回方向落在头部遮挡锥内的强度 */
function observeCone(model: GemModel, size: number, fromTop: boolean, ior: number): HAMap {
  const dark = new Float32Array(size * size);
  const extent = 1.15 * (model.params.shape === 'oval' ? model.params.ratio : 1);
  const z0 = fromTop ? 5 : -5;
  const dir = v3(0, 0, fromTop ? -1 : 1);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size * 2 * extent - extent;
      const y = extent - (py + 0.5) / size * 2 * extent;
      const r = traceRay(model, { o: v3(x, y, z0), d: dir }, ior, 589.3);
      if (r.events.length === 0 || !r.exitDir) continue;
      // 出射方向与观测轴夹角:落在头部遮挡锥(>75° 仰角,即 |z|>cos15°)内为"暗"
      const up = Math.abs(r.exitDir.z);
      if (r.escaped === (fromTop ? 'up' : 'down') && up > 0.9659) {
        dark[py * size + px] = Math.min(1, r.throughput);
      }
    }
  }
  return { size, dark };
}

export interface FacetBlame {
  facetId: number;
  name: string;
  deviationDeg: number; // 法线与 8 重对称理想值的偏差
}

export interface HAResult {
  arrows: HAMap;
  hearts: HAMap;
  /** 每个扇区(0..7)的对称度得分 0..100 */
  sectorScores: number[];
  symmetryScore: number;  // 综合 0..100
  worstSector: number;
  blamedFacets: FacetBlame[];
}

/** 刻面法线相对其旋转对称组理想法线的偏差(度) */
function facetDeviations(model: GemModel): Map<number, number> {
  const groups = new Map<string, Facet[]>();
  for (const f of model.facets) {
    if (f.kind === 'table' || f.kind === 'culet' || f.kind === 'girdle') continue;
    // 16 刻面组(上/下腰面)相邻刻面互为镜像,按奇偶分组对齐
    const gkey = `${f.kind}:${f.ring % 2}`;
    if (!groups.has(gkey)) groups.set(gkey, []);
    groups.get(gkey)!.push(f);
  }
  const dev = new Map<number, number>();
  const normal = (f: Facet): Vec3 =>
    norm(cross(sub(f.verts[1], f.verts[0]), sub(f.verts[2], f.verts[1])));
  /** 刻面在其对称组内的扇区序号(整数,避免浮点方位取整抖动) */
  const sectorIndex = (f: Facet): number => {
    switch (f.kind) {
      case 'star': case 'bezel': case 'pavilionMain': return f.ring % 8;
      case 'upperGirdle': case 'lowerGirdle': return Math.floor(f.ring / 2) % 8;
      case 'crownSide': case 'pavilionSide': return f.ring % 4;
      default: return 0;
    }
  };
  for (const [, fs] of groups) {
    // 按扇区序号把每个刻面绕 z 轴旋转整数个 45° 对齐后取平均法线
    const aligned: { f: Facet; n: Vec3 }[] = fs.map(f => {
      const n = normal(f);
      const az = -sectorIndex(f) * Math.PI / 4;
      const co = Math.cos(az), si = Math.sin(az);
      return { f, n: v3(n.x * co - n.y * si, n.x * si + n.y * co, n.z) };
    });
    const avg = norm(aligned.reduce((a, e) => ({
      x: a.x + e.n.x, y: a.y + e.n.y, z: a.z + e.n.z,
    }), v3()));
    for (const e of aligned) {
      const d = Math.acos(Math.min(1, Math.max(-1, dot(norm(e.n), avg)))) * 180 / Math.PI;
      dev.set(e.f.id, d);
    }
  }
  return dev;
}

export function analyzeHeartsArrows(model: GemModel, size = 200): HAResult {
  const ior = diamondIOR(589.3);
  const arrows = observeCone(model, size, true, ior);
  const hearts = observeCone(model, size, false, ior);

  // 8 扇区对称度:极坐标采样,同一 (r,φ) 在 8 个扇区逐点追迹比较。
  // 不做像素旋转插值,理想石上严格为 0 差异。
  const sectorScores: number[] = new Array(8).fill(0);
  const RADIAL = 10, PER_SECTOR = 4;
  const extent = 1.05 * (model.params.shape === 'oval' ? model.params.ratio : 1);
  const darkAt = (x: number, y: number): number => {
    const r = traceRay(model, { o: v3(x, y, -5), d: v3(0, 0, 1) }, ior, 589.3);
    if (r.events.length === 0 || !r.exitDir) return 0;
    return r.escaped === 'down' && Math.abs(r.exitDir.z) > 0.9659 ? Math.min(1, r.throughput) : 0;
  };
  const sectorDiff = new Array(8).fill(0);
  let samples = 0;
  for (let ri = 0; ri < RADIAL; ri++) {
    const rr = extent * (ri + 0.5) / RADIAL;
    for (let pj = 0; pj < PER_SECTOR; pj++) {
      const phi = (pj + 0.5) * (Math.PI / 4) / PER_SECTOR;
      const vals: number[] = [];
      for (let k = 0; k < 8; k++) {
        const a = phi + k * Math.PI / 4;
        vals.push(darkAt(rr * Math.cos(a), rr * Math.sin(a)));
      }
      for (let k = 0; k < 8; k++) sectorDiff[k] += Math.abs(vals[k] - vals[(k + 1) % 8]);
      samples++;
    }
  }
  let worst = 0, worstVal = -1;
  for (let s = 0; s < 8; s++) {
    const d = samples ? sectorDiff[s] / samples : 0;
    sectorScores[s] = Math.max(0, 100 - d * 400);
    if (d > worstVal) { worstVal = d; worst = s; }
  }
  const symmetryScore = sectorScores.reduce((a, b) => a + b, 0) / 8;

  // 归因:偏差刻面按方位归到扇区
  const devs = facetDeviations(model);
  const blamed: FacetBlame[] = [];
  for (const f of model.facets) {
    const d = devs.get(f.id);
    if (d === undefined || d < 0.05) continue;
    const cen = f.verts.reduce((a, v) => ({ x: a.x + v.x / f.verts.length, y: a.y + v.y / f.verts.length, z: a.z + v.z / f.verts.length }), v3());
    let az = Math.atan2(cen.y, cen.x) * 180 / Math.PI;
    if (az < 0) az += 360;
    blamed.push({ facetId: f.id, name: f.name, deviationDeg: d });
  }
  blamed.sort((a, b) => b.deviationDeg - a.deviationDeg);
  return {
    arrows, hearts, sectorScores, symmetryScore,
    worstSector: worst, blamedFacets: blamed.slice(0, 8),
  };
}

/** 把 H&A 图案画到 canvas:暗区黑,亮区白 */
export function drawHA(map: HAMap, canvas: HTMLCanvasElement): void {
  canvas.width = map.size; canvas.height = map.size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(map.size, map.size);
  for (let i = 0; i < map.dark.length; i++) {
    const v = map.dark[i];
    const g = Math.round(235 * (1 - v));
    img.data[i * 4] = g; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export { KIND_NAMES };
