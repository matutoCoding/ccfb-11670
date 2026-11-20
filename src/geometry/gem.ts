/**
 * 由刻面多边形构建凸多面体:平面方程(Newell 法)、凸性校验、三角化网格。
 */
import { Vec3, add, sub, dot, normalize, scale } from '../math/vec3';
import { Plane } from '../physics/raytrace';
import { FacetPoly, FacetGroup } from './types';

export interface Gem {
  facets: FacetPoly[];
  /** 与 facets 一一对应的平面方程 */
  planes: Plane[];
  /** 三角化后的渲染网格(位置 + 每顶点刻面索引) */
  meshPositions: Float32Array;
  meshFacetIndex: Uint16Array;
  /** 宝石中心(质量中心近似) */
  center: Vec3;
  /** 总深度(台面到尖端) */
  depth: number;
}

/** Newell 法求多边形法线 */
export function newellNormal(verts: Vec3[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return normalize([nx, ny, nz]);
}

export function polygonCentroid(verts: Vec3[]): Vec3 {
  let c: Vec3 = [0, 0, 0];
  for (const v of verts) c = add(c, v);
  return scale(c, 1 / verts.length);
}

/**
 * 构建宝石。自动把每个多边形绕序调整为法线朝外,并校验凸性
 * (所有顶点必须位于每个平面的内侧,容差 1e-6)。
 * @throws 几何非凸时抛错(说明参数组合不合法)
 */
export function buildGem(facets: FacetPoly[]): Gem {
  // 中心:全部顶点均值(凸体内部)
  let center: Vec3 = [0, 0, 0];
  let nv = 0;
  for (const f of facets) for (const v of f.verts) { center = add(center, v); nv++; }
  center = scale(center, 1 / nv);

  const planes: Plane[] = [];
  const outFacets: FacetPoly[] = [];
  for (let i = 0; i < facets.length; i++) {
    const f = facets[i];
    let n = newellNormal(f.verts);
    let verts = f.verts;
    const c = polygonCentroid(verts);
    // 法线必须背离中心
    if (dot(n, sub(c, center)) < 0) {
      n = [-n[0], -n[1], -n[2]];
      verts = [...verts].reverse();
    }
    planes.push({ n, d: dot(n, c), facetIndex: i });
    outFacets.push({ ...f, verts });
  }

  // 凸性校验
  const TOL = 1e-6;
  for (const p of planes) {
    for (const f of outFacets) {
      for (const v of f.verts) {
        if (dot(p.n, v) - p.d > TOL) {
          throw new Error(`几何非凸:刻面顶点越出平面(偏差 ${(dot(p.n, v) - p.d).toExponential(2)}),请调整切工参数`);
        }
      }
    }
  }

  // 三角化(扇形)
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < outFacets.length; i++) {
    const vs = outFacets[i].verts;
    for (let k = 1; k + 1 < vs.length; k++) {
      for (const v of [vs[0], vs[k], vs[k + 1]]) {
        pos.push(v[0], v[1], v[2]);
        idx.push(i);
      }
    }
  }

  const ys = outFacets.flatMap((f) => f.verts.map((v) => v[1]));
  const depth = Math.max(...ys) - Math.min(...ys);

  return {
    facets: outFacets,
    planes,
    meshPositions: new Float32Array(pos),
    meshFacetIndex: new Uint16Array(idx),
    center,
    depth,
  };
}

export function groupOf(facetIndex: number, gem: Gem): FacetGroup {
  return gem.facets[facetIndex].group;
}
