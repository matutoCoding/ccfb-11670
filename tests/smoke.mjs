// 端到端冒烟测试：页面无报错 + 离屏渲染正确 + 分析/自检通过
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:5231';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[error] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.addInitScript(() => {
  localStorage.setItem('diamond-studio:settings', JSON.stringify({
    resolutionScale: 0.3, numWavelengths: 3, maxBounces: 8, autoResolution: false,
  }));
});

// 1. 先到款式库（非 WebGPU 页面），再做离屏渲染验证。
// 注意：本测试环境（无 GPU 的 SwiftShader）里 canvas 呈现会使 GPU 实例失效，
// 所以离屏验证必须在加载预览页之前完成。
await page.goto(`${BASE}/#/library`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// 离屏渲染验证（独立 device，绕开 SwiftShader 环境下 canvas 呈现使实例失效的问题）
const envShots = await page.evaluate(async () => {
  const { RAYTRACE_WGSL } = await import('/src/gpu/shader.ts');
  const { buildRoundBrilliant, buildPrincess, DEFAULT_PARAMS } = await import('/src/geometry/cuts.ts');
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const W = 480, H = 360;
  const results = {};

  const render = async (geo, envMode, turntable = 0) => {
    const mod = device.createShaderModule({ code: RAYTRACE_WGSL });
    const pipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vsMain' },
      fragment: { module: mod, entryPoint: 'fsMain', targets: [{ format: 'rgba8unorm' }] },
    });
    const facetData = new Float32Array(geo.planes.length * 4);
    geo.planes.forEach((p, i) => {
      facetData.set([p.n[0], p.n[1], p.n[2], p.w], i * 4);
    });
    const facetBuf = device.createBuffer({ size: facetData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(facetBuf, 0, facetData);
    const uniBuf = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const az = 0.6, el = 0.5, dist = 4.2, fov = 30;
    const ce = Math.cos(el), se = Math.sin(el), ca = Math.cos(az), sa = Math.sin(az);
    const pos = [dist * ce * sa, dist * se, dist * ce * ca];
    const len = Math.hypot(...pos);
    const fwd = pos.map((v) => -v / len);
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const tanHalf = Math.tan((fov * Math.PI) / 360);
    const u = new Float32Array(32);
    u.set([
      pos[0], pos[1], pos[2], 1.4,
      right[0], right[1], right[2], tanHalf * (W / H),
      up[0], up[1], up[2], tanHalf,
      fwd[0], fwd[1], fwd[2], W,
      Math.cos(turntable), Math.sin(turntable), 1.0, H,
      geo.planes.length, envMode, 3, 8,
      2.3798, 0.01315, 1.0, 0,
    ]);
    device.queue.writeBuffer(uniBuf, 0, u);
    const bind = device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniBuf } }, { binding: 1, resource: { buffer: facetBuf } }],
    });
    const tex = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: tex.createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }],
    });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    const bytesPerRow = Math.ceil((W * 4) / 256) * 256;
    const readBuf = device.createBuffer({ size: bytesPerRow * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyTextureToBuffer({ texture: tex }, { buffer: readBuf, bytesPerRow }, [W, H]);
    device.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();
    const px = new Uint8Array(W * H * 4);
    for (let row = 0; row < H; row++) {
      px.set(raw.subarray(row * bytesPerRow, row * bytesPerRow + W * 4), row * W * 4);
    }
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const c2 = canvas.getContext('2d');
    const img = c2.createImageData(W, H);
    img.data.set(px);
    c2.putImageData(img, 0, 0);
    let sum = 0, max = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
      sum += l; max = Math.max(max, l);
    }
    tex.destroy(); readBuf.destroy(); facetBuf.destroy(); uniBuf.destroy();
    return { png: canvas.toDataURL('image/png'), mean: sum / (px.length / 4), max };
  };

  results.counter = await render(buildRoundBrilliant(DEFAULT_PARAMS), 0);
  results.natural = await render(buildRoundBrilliant(DEFAULT_PARAMS), 1);
  results.point = await render(buildRoundBrilliant(DEFAULT_PARAMS), 2);
  results.princess = await render(buildPrincess({ ...DEFAULT_PARAMS, tablePct: 68 }), 0);
  results.rotated = await render(buildRoundBrilliant(DEFAULT_PARAMS), 0, 0.7);
  return results;
});
for (const [name, r] of Object.entries(envShots)) {
  fs.writeFileSync(`shots/env-${name}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(`离屏渲染 ${name}: mean=${r.mean.toFixed(1)} max=${r.max}`);
}

// 2. 预览页（本环境无法呈现 WebGPU 画布，仅验证无报错）
await page.goto(`${BASE}/#/preview`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// 3. 款式库
await page.goto(`${BASE}/#/library`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/library.png' });
const rows = await page.locator('table.list tr').count();
console.log('款式库行数:', rows);

// 3. 切工编辑
await page.locator('button', { hasText: '编辑' }).first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/editor.png' });

// 4. 光学分析（完整跑一遍）
await page.goto(`${BASE}/#/analysis`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.locator('button', { hasText: '运行光学分析' }).click();
await page.waitForSelector('text=分析完成', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1000);
await page.screenshot({ path: 'shots/analysis.png' });
const scores = await page.locator('.score-num').allTextContents().catch(() => []);
console.log('分析评分 [亮度,火彩,闪烁]:', JSON.stringify(scores));

// 5. 设置 + 物理自检
await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' });
await page.locator('button', { hasText: '运行物理自检' }).click();
await page.waitForTimeout(1500);
const check = await page.locator('.card', { hasText: '物理自检' }).textContent();
console.log('物理自检:', check?.replace(/\s+/g, ' ').slice(0, 250));
await page.screenshot({ path: 'shots/settings.png' });

console.log('控制台错误:', errors.length ? errors : '(无)');
await browser.close();
