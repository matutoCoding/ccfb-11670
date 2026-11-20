import { chromium } from 'playwright-core';
const exe = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1255/chrome-win64/chrome.exe';
const url = process.argv[2] ?? 'http://127.0.0.1:54529';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
const out = await page.evaluate(async () => {
  const dbg = window.__dbg;
  const device = await (await navigator.gpu.requestAdapter()).requestDevice();
  const results = {};
  for (const [name, code] of Object.entries(dbg.WGSL)) {
    device.pushErrorScope('validation');
    const mod = device.createShaderModule({ code });
    const info = await mod.getCompilationInfo();
    const err = await device.popErrorScope();
    results[name] = {
      messages: info.messages.map((m) => `${m.type} L${m.lineNum}:${m.linePos} ${m.message}`),
      validationError: err ? err.message : null,
    };
  }
  return results;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
