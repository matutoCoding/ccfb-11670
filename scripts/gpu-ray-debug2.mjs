import { chromium } from 'playwright-core';
const exe = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1255/chrome-win64/chrome.exe';
const url = process.argv[2] ?? 'http://127.0.0.1:54529';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
const out = await page.evaluate(async () => {
  const dbg = window.__dbg;
  const device = await (await navigator.gpu.requestAdapter()).requestDevice();
  const gem = dbg.generateGem(dbg.DEFAULT_PARAMS.round);
  const planes = new Float32Array(gem.planes.length * 4);
  gem.planes.forEach((p, i) => planes.set([...p.n, p.d], i * 4));
  const ior = dbg.diamondIOR(589.3);
  const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const angle = (a, b) => Math.acos(Math.min(1, Math.max(-1, a[0]*b[0]+a[1]*b[1]+a[2]*b[2]))) * 180 / Math.PI;
  const results = [];
  for (const [x, z] of [[0,0],[0.3,0.1],[-0.4,0.2],[0.15,-0.35],[0.6,0.6]]) {
    for (const d of [[0,-1,0],[0.25,-1,0.1],[-0.15,-1,-0.2]]) {
      const ro = [x, 3, z], rd = norm(d);
      const cpu = dbg.traceRay(gem.planes, ro, rd, ior, 12);
      const gpu = await dbg.gpuTraceSingleRay(device, planes, gem.planes.length, ro, rd, ior, 12);
      const err = (cpu.exitDir && gpu.hit) ? angle(cpu.exitDir, gpu.exitDir) : null;
      results.push({ ro: [x, z], d, cpuBounces: cpu.bounces.length, cpuExitFacet: cpu.exitFacetIndex,
        cpuExit: cpu.exitDir, gpuExit: gpu.exitDir, err, gpuHit: gpu.hit, cpuHit: cpu.hit, trapped: cpu.trapped });
    }
  }
  return results;
});
for (const r of out) console.log(JSON.stringify(r));
await browser.close();
