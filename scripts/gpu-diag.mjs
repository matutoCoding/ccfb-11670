import { chromium } from 'playwright-core';
const exe = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1255/chrome-win64/chrome.exe';
const SETS = [
  ['--enable-unsafe-webgpu', '--in-process-gpu'],
  ['--enable-unsafe-webgpu', '--no-sandbox', '--disable-gpu-sandbox'],
  ['--enable-unsafe-webgpu', '--use-angle=d3d11'],
  ['--enable-unsafe-webgpu', '--disable-features=WebGPUService'],
];
for (const args of SETS) {
  let browser;
  try {
    browser = await chromium.launch({ executablePath: exe, headless: false, args });
    const page = await browser.newPage();
    const ok = await page.evaluate(async () => {
      if (!navigator.gpu) return 'no navigator.gpu';
      try {
        const a = await navigator.gpu.requestAdapter();
        if (!a) return 'null adapter';
        const info = a.info;
        return `OK: ${info?.vendor} ${info?.architecture} ${info?.description ?? ''}`;
      } catch (e) { return 'err ' + e.message; }
    });
    console.log(`[${args.join(' ')}]\n  → ${ok}`);
    await browser.close();
  } catch (e) {
    console.log(`[${args.join(' ')}] launch fail: ${e.message.split('\n')[0]}`);
  }
}
