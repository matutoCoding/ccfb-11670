/**
 * 光线追迹器:空气→钻石→空气,逐刻面记录入射/折射角。
 * 全双精度,单波长;色散通过对多波长分别追迹实现。
 */
import { Vec3, Ray, Tri, dot, scale, add, norm, intersectMesh } from '../core/vec3';
import { refract, reflect, fresnel, incidenceAngleDeg, refractionAngleDeg } from '../core/optics';
import { GemModel } from '../geometry/gem';

export interface TraceEvent {
  seq: number;
  kind: 'enter' | 'tir' | 'exit';
  facetId: number;
  facetName: string;
  point: Vec3;
  dirIn: Vec3;
  dirOut: Vec3;
  angleInDeg: number;        // 入射角(与法线夹角)
  angleOutDeg: number;       // 折射角(全内反射时等于入射角)
  fresnelLoss: number;       // 本次界面能量损失比例
}

export type EscapeDir = 'up' | 'down' | 'side' | 'absorbed';

export interface TraceResult {
  events: TraceEvent[];
  escaped: EscapeDir;
  exitDir: Vec3 | null;      // 最终出射方向(单位)
  exitPoint: Vec3 | null;
  throughput: number;        // 剩余能量比例(菲涅尔累计)
  wavelengthNm: number;
  ior: number;
}

const OFFSET = 1e-7;

/**
 * 追迹一条光线。
 * @param iorFn 波长→折射率(单波长追迹时传常量)
 */
export function traceRay(
  model: GemModel,
  ray: Ray,
  ior: number,
  wavelengthNm: number,
  maxBounces = 16,
): TraceResult {
  const events: TraceEvent[] = [];
  let throughput = 1;
  let inside = false;
  let cur: Ray = { o: ray.o, d: norm(ray.d) };
  const facetName = (id: number) => model.facets[id]?.name ?? `#${id}`;

  for (let bounce = 0; bounce < maxBounces; bounce++) {
    const hit = intersectMesh(cur, model.tris);
    if (!hit) {
      // 不再相交:在外部→飞离;在内部→数值异常,按吸收处理
      return {
        events, escaped: inside ? 'absorbed' : classify(cur.d),
        exitDir: inside ? null : cur.d, exitPoint: cur.o, throughput, wavelengthNm, ior,
      };
    }
    const p = add(cur.o, scale(cur.d, hit.t));
    let n = hit.tri.n;
    const cosI = dot(cur.d, n);
    const entering = cosI < 0;      // 从外侧打向刻面
    if (!entering) n = scale(n, -1); // 让法线朝向入射介质一侧

    const angIn = incidenceAngleDeg(cur.d, n);
    const n1 = inside ? ior : 1;
    const n2 = inside ? 1 : ior;
    const t = refract(cur.d, n, n1, n2);

    if (t === null) {
      // 全内反射
      const r = reflect(cur.d, n);
      events.push({
        seq: events.length, kind: 'tir', facetId: hit.tri.facetId,
        facetName: facetName(hit.tri.facetId), point: p, dirIn: cur.d, dirOut: r,
        angleInDeg: angIn, angleOutDeg: angIn, fresnelLoss: 0,
      });
      cur = { o: add(p, scale(r, OFFSET)), d: r };
      continue;
    }

    const R = fresnel(n1, n2, Math.abs(cosI));
    const angOut = refractionAngleDeg(cur.d, n, n1, n2) ?? angIn;
    if (!inside) {
      // 进入钻石:折射部分继续,反射部分损失
      throughput *= 1 - R;
      events.push({
        seq: events.length, kind: 'enter', facetId: hit.tri.facetId,
        facetName: facetName(hit.tri.facetId), point: p, dirIn: cur.d, dirOut: t,
        angleInDeg: angIn, angleOutDeg: angOut, fresnelLoss: R,
      });
      inside = true;
      cur = { o: add(p, scale(t, OFFSET)), d: t };
    } else {
      // 出射
      throughput *= 1 - R;
      events.push({
        seq: events.length, kind: 'exit', facetId: hit.tri.facetId,
        facetName: facetName(hit.tri.facetId), point: p, dirIn: cur.d, dirOut: t,
        angleInDeg: angIn, angleOutDeg: angOut, fresnelLoss: R,
      });
      return { events, escaped: classify(t), exitDir: t, exitPoint: p, throughput, wavelengthNm, ior };
    }
  }
  return { events, escaped: 'absorbed', exitDir: null, exitPoint: null, throughput, wavelengthNm, ior };
}

function classify(d: Vec3): EscapeDir {
  if (d.z > 0.05) return 'up';
  if (d.z < -0.05) return 'down';
  return 'side';
}
