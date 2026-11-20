/**
 * WGSL 着色器源码。
 * TRACE_WGSL 与 src/physics/raytrace.ts 的 CPU 参考实现一一对应(同样的
 * 板条求交、斯涅尔折射、菲涅尔、全内反射逻辑),是 GPU 物理正确性的关键。
 * 设置页提供"GPU vs CPU 单光线核对",直接验证两边误差 < 0.01°。
 */

/** 共享:光学与凸体追踪函数 */
export const TRACE_WGSL = /* wgsl */ `
struct Plane { n: vec3f, d: f32 }

fn snellRefract(I: vec3f, N: vec3f, n1: f32, n2: f32) -> vec4f {
  // 返回 xyz=折射方向, w=1 成功;全内反射时 w=0
  let eta = n1 / n2;
  let cosI = -dot(I, N);
  let sin2T = eta * eta * (1.0 - cosI * cosI);
  if (sin2T > 1.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let cosT = sqrt(1.0 - sin2T);
  let k = eta * cosI - cosT;
  return vec4f(eta * I + k * N, 1.0);
}

fn fresnelUnpolarized(cosI: f32, n1: f32, n2: f32) -> f32 {
  let eta = n1 / n2;
  let sin2T = eta * eta * (1.0 - cosI * cosI);
  if (sin2T >= 1.0) { return 1.0; }
  let cosT = sqrt(1.0 - sin2T);
  let rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
  let rp = (n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI);
  return (rs * rs + rp * rp) * 0.5;
}

fn planeAt(idx: u32) -> Plane {
  let v = planesBuf[idx];
  return Plane(v.xyz, v.w);
}

struct TraceOut {
  dir: vec3f,
  w: f32,
  hit: bool,
}

fn traceGem(ro: vec3f, rd: vec3f, ior: f32, facetCount: u32, maxBounces: u32) -> TraceOut {
  var out: TraceOut;
  out.dir = vec3f(0.0); out.w = 0.0; out.hit = false;

  // 板条法求进入点
  var tEnter = -1e30;
  var tExit = 1e30;
  var enterIdx = 0u;
  var found = false;
  for (var i = 0u; i < facetCount; i++) {
    let pl = planeAt(i);
    let denom = dot(pl.n, rd);
    let dist = pl.d - dot(pl.n, ro);
    if (abs(denom) < 1e-9) {
      if (dist < 0.0) { return out; }
      continue;
    }
    let t = dist / denom;
    if (denom < 0.0) {
      if (t > tEnter) { tEnter = t; enterIdx = i; found = true; }
    } else {
      tExit = min(tExit, t);
    }
  }
  if (!found || tEnter > tExit || tExit < 0.0) { return out; }
  out.hit = true;

  // 进入:空气 → 宝石(朝外法线即迎着光线)
  let nIn = planeAt(enterIdx).n;
  let cosEntry = -dot(rd, nIn);
  var throughput = 1.0 - fresnelUnpolarized(cosEntry, 1.0, ior);
  let r0 = snellRefract(rd, nIn, 1.0, ior);
  var dir = r0.xyz;
  var p = ro + rd * tEnter;

  for (var b = 0u; b < maxBounces; b++) {
    p = p + dir * 1e-5;
    // 找最近出射平面
    var tBest = 1e30;
    var bestIdx = 0u;
    var hasExit = false;
    for (var i = 0u; i < facetCount; i++) {
      let pl = planeAt(i);
      let denom = dot(pl.n, dir);
      if (denom <= 1e-9) { continue; }
      let t = (pl.d - dot(pl.n, p)) / denom;
      if (t > 1e-9 && t < tBest) { tBest = t; bestIdx = i; hasExit = true; }
    }
    if (!hasExit) { out.w = 0.0; return out; }
    p = p + dir * tBest;
    let pl = planeAt(bestIdx);
    let n = -pl.n; // 迎着光线的法线
    let cosI = -dot(dir, n);
    let refr = snellRefract(dir, n, ior, 1.0);
    if (refr.w < 0.5) {
      // 全内反射
      dir = dir - 2.0 * dot(dir, pl.n) * pl.n;
      continue;
    }
    throughput *= 1.0 - fresnelUnpolarized(cosI, ior, 1.0);
    out.dir = refr.xyz;
    out.w = throughput;
    return out;
  }
  out.w = 0.0; // 困在内部
  return out;
}
`;

/** 环境光(与 src/render/env.ts 的 CPU 版一一对应) */
export const ENV_WGSL = /* wgsl */ `
fn lobe(dir: vec3f, aim: vec3f, sharpness: f32) -> f32 {
  return pow(max(0.0, dot(dir, aim)), sharpness);
}

fn envColor(dirIn: vec3f, envType: u32) -> vec3f {
  let d = normalize(dirIn);
  if (envType == 0u) {
    var c = vec3f(0.03);
    let s0 = normalize(vec3f(0.5, 1.0, 0.3));
    let s1 = normalize(vec3f(-0.6, 1.0, -0.2));
    let s2 = normalize(vec3f(0.05, 1.0, -0.75));
    let warm = vec3f(1.0, 0.88, 0.72);
    c += warm * (lobe(d, s0, 350.0) * 5.0 + lobe(d, s0, 12.0) * 0.12);
    c += warm * (lobe(d, s1, 300.0) * 4.0 + lobe(d, s1, 12.0) * 0.12);
    c += warm * (lobe(d, s2, 400.0) * 3.5 + lobe(d, s2, 12.0) * 0.12);
    // 顶部大面积柔光(灯箱)
    let soft = lobe(d, vec3f(0.0, 1.0, 0.0), 5.0) * 0.55;
    c += vec3f(1.0, 0.95, 0.88) * soft;
    if (d.y < 0.0) { c = vec3f(0.012); }
    return c;
  }
  if (envType == 1u) {
    if (d.y < 0.0) { return vec3f(0.12, 0.13, 0.11); }
    let t = clamp(d.y, 0.0, 1.0);
    var c = mix(vec3f(0.85, 0.9, 0.98), vec3f(0.35, 0.55, 0.85), t);
    let sun = lobe(d, normalize(vec3f(0.4, 0.75, 0.5)), 1500.0) * 6.0;
    c += vec3f(1.0, 0.96, 0.88) * sun;
    return c;
  }
  let v = lobe(d, normalize(vec3f(0.3, 1.0, 0.25)), 1200.0) * 8.0 + 0.008;
  return vec3f(v, v * 0.98, v * 0.95);
}
`;

/** 渲染:全屏光线追踪(misc.zw = 渲染分辨率) */
export const RENDER_WGSL = /* wgsl */ `
struct Sim {
  camPos: vec4f,   // xyz=相机位置
  camRight: vec4f, // xyz=右, w=tan(fov/2)
  camUp: vec4f,    // xyz=上, w=aspect
  camFwd: vec4f,   // xyz=前, w=envType
  iors: vec4f,     // rgb 三波长折射率, w=maxBounces
  misc: vec4f,     // x=facetCount, y=spectralSamples, zw=分辨率
}

@group(0) @binding(0) var<uniform> sim: Sim;
@group(0) @binding(1) var<storage, read> planesBuf: array<vec4f>;

${TRACE_WGSL}
${ENV_WGSL}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let xy = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(xy[vi], 0.0, 1.0);
}
`;

export const RENDER_MAIN_WGSL = /* wgsl */ `
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let res = sim.misc.zw;
  let uv = (pos.xy / res) * 2.0 - 1.0;
  let tanHalf = sim.camRight.w;
  let aspect = sim.camUp.w;
  let rd = normalize(
    sim.camFwd.xyz +
    uv.x * tanHalf * aspect * sim.camRight.xyz -
    uv.y * tanHalf * sim.camUp.xyz
  );
  let ro = sim.camPos.xyz;
  let envType = u32(sim.camFwd.w);
  let facetCount = u32(sim.misc.x);
  let maxBounces = u32(sim.iors.w);
  let spectral = u32(sim.misc.y);

  var col = vec3f(0.0);
  if (spectral >= 3u) {
    // 三波长色散追踪:红/绿/蓝各自独立折射率
    let tR = traceGem(ro, rd, sim.iors.x, facetCount, maxBounces);
    let tG = traceGem(ro, rd, sim.iors.y, facetCount, maxBounces);
    let tB = traceGem(ro, rd, sim.iors.z, facetCount, maxBounces);
    if (tR.hit) { col.r = tR.w * envColor(tR.dir, envType).r; }
    if (tG.hit) { col.g = tG.w * envColor(tG.dir, envType).g; }
    if (tB.hit) { col.b = tB.w * envColor(tB.dir, envType).b; }
    if (!tR.hit && !tG.hit && !tB.hit) { col = envColor(rd, envType); }
  } else {
    let t = traceGem(ro, rd, sim.iors.y, facetCount, maxBounces);
    if (t.hit) { col = vec3f(t.w) * envColor(t.dir, envType); }
    else { col = envColor(rd, envType); }
  }

  // 简单色调映射 + gamma
  col = col / (1.0 + col);
  col = pow(col, vec3f(1.0 / 2.2));
  return vec4f(col, 1.0);
}
`;

/** GPU 单光线核对:与 CPU traceRay 对比同一光线的出射方向 */
export const VERIFY_WGSL = /* wgsl */ `
struct VerifyIn {
  ro: vec4f,   // xyz=原点
  rd: vec4f,   // xyz=方向
  params: vec4f, // x=ior, y=maxBounces, z=facetCount
}
@group(0) @binding(0) var<uniform> vin: VerifyIn;
@group(0) @binding(1) var<storage, read> planesBuf: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> result: array<vec4f>;

${TRACE_WGSL}

@compute @workgroup_size(1)
fn main() {
  let r = traceGem(vin.ro.xyz, vin.rd.xyz, vin.params.x, u32(vin.params.z), u32(vin.params.y));
  result[0] = vec4f(r.dir, r.w);
  result[1] = vec4f(select(0.0, 1.0, r.hit), 0.0, 0.0, 0.0);
}
`;

/** 刻面网格着色(漏光分析视图) */
export const MESH_WGSL = /* wgsl */ `
struct MeshU {
  mvp: mat4x4f,
  lightDir: vec4f,
}
@group(0) @binding(0) var<uniform> u: MeshU;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec3f,
  @location(1) normal: vec3f,
}

@vertex fn vs(
  @location(0) pos: vec3f,
  @location(1) color: vec3f,
  @location(2) normal: vec3f,
) -> VOut {
  var o: VOut;
  o.pos = u.mvp * vec4f(pos, 1.0);
  o.color = color;
  o.normal = normal;
  return o;
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let l = abs(dot(normalize(v.normal), normalize(u.lightDir.xyz)));
  let c = v.color * (0.35 + 0.65 * l);
  return vec4f(c, 1.0);
}
`;
