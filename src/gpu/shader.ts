/**
 * WGSL 光谱光线追踪着色器 —— 与 src/optics/raytrace.ts 的 CPU 参考实现一一对应。
 * 凸多面体求交 + 斯涅尔折射 + 全内反射 + 菲涅尔 + 柯西色散（逐波长独立路径）。
 */
export const RAYTRACE_WGSL = /* wgsl */ `
struct Uniforms {
  camPos: vec4f,    // xyz = 相机位置
  camRight: vec4f,  // xyz = 右向量, w = tan(fov/2)*aspect
  camUp: vec4f,     // xyz = 上向量, w = tan(fov/2)
  camFwd: vec4f,    // xyz = 前向量
  stoneRot: vec4f,  // x = cos(转台角), y = sin(转台角), z = 环境光强度, w = 曝光
  params: vec4f,    // x = 刻面数, y = 环境模式, z = 波长数, w = 最大反弹
  params2: vec4f,   // x = 柯西A, y = 柯西B, z = 背景亮度, w = 未用
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> facets: array<vec4f>;

fn ior(lambdaNm: f32) -> f32 {
  let um = lambdaNm * 0.001;
  return u.params2.x + u.params2.y / (um * um);
}

// 波长(nm) → 线性 RGB（Bruton 分段近似，与 CPU 侧一致）
fn waveRGB(l: f32) -> vec3f {
  var r = 0.0; var g = 0.0; var b = 0.0;
  if (l < 440.0) { r = -(l - 440.0) / 60.0; b = 1.0; }
  else if (l < 490.0) { g = (l - 440.0) / 50.0; b = 1.0; }
  else if (l < 510.0) { g = 1.0; b = -(l - 510.0) / 20.0; }
  else if (l < 580.0) { r = (l - 510.0) / 70.0; g = 1.0; }
  else if (l < 645.0) { r = 1.0; g = -(l - 645.0) / 65.0; }
  else { r = 1.0; }
  return vec3f(r, g, b);
}

fn fresnelRT(cosI: f32, cosT: f32, n1: f32, n2: f32) -> f32 {
  let rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
  let rp = (n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI);
  return 0.5 * (rs * rs + rp * rp);
}

// 非偏振菲涅尔反射率（含 TIR 判断）
fn fresnel(cosI: f32, n1: f32, n2: f32) -> f32 {
  let s2 = (n1 / n2) * (n1 / n2) * (1.0 - cosI * cosI);
  if (s2 >= 1.0) { return 1.0; }
  return fresnelRT(cosI, sqrt(1.0 - s2), n1, n2);
}

fn reflectV(i: vec3f, n: vec3f) -> vec3f { return i - 2.0 * dot(n, i) * n; }

// 环境光采样：0=珠宝柜台灯 1=自然光 2=点光源 3=分析模式(上半球白)
fn envSample(dIn: vec3f) -> vec3f {
  let d = normalize(dIn);
  let mode = i32(u.params.y + 0.5);
  let k = u.stoneRot.z;
  if (mode == 3) {
    // 分析模式：上半球均匀白，下半球黑（漏光检测）
    if (d.y > 0.0) { return vec3f(1.0); }
    return vec3f(0.0);
  }
  if (mode == 0) {
    // 珠宝柜台：深色底 + 顶部柔光箱 + 一圈高亮 LED 射灯（强闪烁对比）
    var c = vec3f(0.012, 0.012, 0.016);
    c += vec3f(0.10, 0.10, 0.11) * max(d.y, 0.0);
    // 顶部柔光
    c += vec3f(0.55, 0.55, 0.52) * smoothstep(0.55, 0.95, d.y);
    // 射灯环（6 盏）+ 主灯
    for (var i = 0; i < 6; i++) {
      let a = f32(i) * 1.0472 + 0.5;
      let L = normalize(vec3f(cos(a) * 0.55, 0.85, sin(a) * 0.55));
      let spot = smoothstep(0.985, 0.998, dot(d, L));
      c += vec3f(9.0, 8.6, 7.8) * spot;
    }
    let Lm = normalize(vec3f(0.15, 1.0, 0.1));
    c += vec3f(14.0, 13.5, 12.5) * smoothstep(0.995, 0.9995, dot(d, Lm));
    return c * k;
  }
  if (mode == 1) {
    // 自然光：天空渐变 + 太阳 + 地面
    if (d.y < 0.0) { return vec3f(0.09, 0.08, 0.07) * k; }
    var c = mix(vec3f(0.45, 0.5, 0.55), vec3f(0.85, 0.9, 1.0), d.y);
    let sun = normalize(vec3f(0.5, 0.65, 0.4));
    c += vec3f(6.0, 5.5, 4.6) * smoothstep(0.9990, 0.9998, dot(d, sun));
    c += vec3f(0.35, 0.32, 0.28) * smoothstep(0.9, 1.0, dot(d, sun));
    return c * k;
  }
  // 点光源：近乎全黑中的单个小光源
  var c = vec3f(0.004, 0.004, 0.005);
  let Lp = normalize(vec3f(0.4, 0.8, 0.45));
  c += vec3f(30.0, 28.0, 25.0) * smoothstep(0.9995, 0.99995, dot(d, Lp));
  c += vec3f(0.05) * max(d.y, 0.0);
  return c * k;
}

// 单波长完整路径追踪（CPU 侧 traceRay 的镜像）
fn traceLambda(ro: vec3f, rd: vec3f, lambda: f32) -> vec3f {
  let facetCount = i32(u.params.x + 0.5);
  let maxB = i32(u.params.w + 0.5);
  let nStone = ior(lambda);

  // 凸多面体求交（slab 法）
  var tN = -1e30;
  var tF = 1e30;
  var fN = -1;
  for (var i = 0; i < facetCount; i++) {
    let p = facets[i];
    let denom = dot(p.xyz, rd);
    let dist = p.w - dot(p.xyz, ro);
    if (abs(denom) < 1e-9) {
      if (dist < 0.0) { return envSample(rd) * u.params2.z; }
      continue;
    }
    let t = dist / denom;
    if (denom < 0.0) { tN = max(tN, t); fN = i; }
    else { tF = min(tF, t); }
  }
  if (tN > tF || tF < 0.0 || fN < 0) { return envSample(rd) * u.params2.z; }

  // 入射表面：菲涅尔反射（表面光泽）+ 折射进入
  let n0 = facets[fN].xyz;
  let cosI = -dot(n0, rd);
  let R = fresnel(cosI, 1.0, nStone);
  var col = R * envSample(reflectV(rd, n0));
  let eta0 = 1.0 / nStone;
  let cosT0 = sqrt(1.0 - eta0 * eta0 * (1.0 - cosI * cosI));
  var d = normalize(eta0 * rd + (eta0 * cosI - cosT0) * n0);
  var tp = 1.0 - R;
  var o = ro + max(tN, 0.0) * rd + d * 1e-4;

  for (var b = 0; b < maxB; b++) {
    if (tp < 1e-3) { break; }
    // 找最近出射刻面
    var tBest = 1e30;
    var fBest = -1;
    for (var i = 0; i < facetCount; i++) {
      let p = facets[i];
      let denom = dot(p.xyz, d);
      if (denom <= 1e-9) { continue; }
      let t = (p.w - dot(p.xyz, o)) / denom;
      if (t > 1e-5 && t < tBest) { tBest = t; fBest = i; }
    }
    if (fBest < 0) { break; }
    let hp = o + d * tBest;
    let fNorm = facets[fBest].xyz;
    let negN = -fNorm;
    let cosI2 = dot(d, fNorm);
    let sinT2 = nStone * nStone * (1.0 - cosI2 * cosI2);
    if (sinT2 > 1.0) {
      // 全内反射
      d = reflectV(d, negN);
      o = hp + d * 1e-4;
      continue;
    }
    let cosT = sqrt(1.0 - sinT2);
    let R2 = fresnelRT(cosI2, cosT, nStone, 1.0);
    let eta = nStone;
    let outDir = normalize(eta * d - (eta * cosI2 - cosT) * negN);
    col += tp * (1.0 - R2) * envSample(outDir);
    tp *= R2;
    d = reflectV(d, negN);
    o = hp + d * 1e-4;
  }
  return col;
}

@vertex
fn vsMain(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  // 全屏三角形
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn fsMain(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let res = vec2f(u.camFwd.w, u.stoneRot.w);
  let ndc = vec2f((fc.x / res.x) * 2.0 - 1.0, 1.0 - (fc.y / res.y) * 2.0);
  let rd = normalize(
    u.camFwd.xyz + ndc.x * u.camRight.w * u.camRight.xyz + ndc.y * u.camUp.w * u.camUp.xyz
  );
  // 世界 → 宝石坐标（绕 Y 轴反转台角）
  let cs = u.stoneRot.x;
  let sn = u.stoneRot.y;
  let roW = u.camPos.xyz;
  let ro = vec3f(cs * roW.x - sn * roW.z, roW.y, sn * roW.x + cs * roW.z);
  let rdS = normalize(vec3f(cs * rd.x - sn * rd.z, rd.y, sn * rd.x + cs * rd.z));

  // 光谱循环：每个波长独立完整路径（TIR 判断随波长不同）
  let nL = i32(u.params.z + 0.5);
  var lambdas = array<f32, 5>(450.0, 500.0, 550.0, 600.0, 650.0);
  if (nL == 1) { lambdas[0] = 550.0; }
  if (nL == 3) {
    lambdas[0] = 470.0; lambdas[1] = 550.0; lambdas[2] = 650.0;
  }
  var col = vec3f(0.0);
  var wSum = vec3f(0.0);
  for (var i = 0; i < nL; i++) {
    let l = lambdas[i];
    let w = waveRGB(l);
    col += w * traceLambda(ro, rdS, l);
    wSum += w;
  }
  col = col / max(wSum, vec3f(1e-5));
  // 色调映射 + gamma
  col = vec3f(1.0) - exp(-col * u.camPos.w);
  col = pow(col, vec3f(1.0 / 2.2));
  return vec4f(col, 1.0);
}
`;
