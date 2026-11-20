import { chromium } from 'playwright-core';
const exe = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1255/chrome-win64/chrome.exe';
const url = process.argv[2] ?? 'http://127.0.0.1:54529';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
const out = await page.evaluate(async () => {
  const dbg = window.__dbg;
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const gem = dbg.generateGem(dbg.DEFAULT_PARAMS.round);
  const planes = new Float32Array(gem.planes.length * 4);
  gem.planes.forEach((p, i) => planes.set([...p.n, p.d], i * 4));
  const ior = dbg.diamondIOR(589.3);
  const ro = [-0.4, 3, 0.2], rd = [0, -1, 0];
  const gpu = await dbg.gpuTraceSingleRay(device, planes, gem.planes.length, ro, rd, ior, 12);
  const cpu = dbg.traceRay(gem.planes, ro, rd, ior, 12);
  return {
    gpuExit: gpu.exitDir, gpuW: gpu.throughput, gpuHit: gpu.hit,
    cpuExit: cpu.exitDir, cpuW: cpu.throughput,
    cpuBounces: cpu.bounces.map((b) => ({ facet: b.facetIndex, point: b.point })),
    cpuExitFacet: cpu.exitFacetIndex,
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
