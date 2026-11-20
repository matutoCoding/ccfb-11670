/**
 * 端到端验证:真实浏览器里跑 WebGPU。
 * 1) 设置页 GPU vs CPU 单光线核对(出射角误差 < 0.01°)
 * 2) 预览页渲染截图 + FPS
 * 用法:node scripts/verify-e2e.mjs <url>
 */
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:54529';
const pwDir = `${process.env.LOCALAPPDATA}/ms-playwright`;
const chromiumDir = readdirSync(pwDir).filter((d) => d.startsWith('chromium-')).sort().pop();
const EXES = [
  `${pwDir}/${chromiumDir}/chrome-win64/chrome.exe`,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const FLAG_SETS = [
  { headless: true, args: [] },
  { headless: true, args: ['--enable-unsafe-webgpu'] },
  { headless: false, args: [] },
];

let browser = null;
let gpuOk = false;
outer:
for (const exe of EXES) {
  for (const { headless, args } of FLAG_SETS) {
    try {
      browser = await chromium.launch({ executablePath: exe, headless, args });
    } catch (e) {
      console.log(`launch failed for ${exe}: ${e.message.split('\n')[0]}`);
      continue;
    }
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' }); // 安全上下文下才有 WebGPU
    gpuOk = await page.evaluate(async () => {
      if (!navigator.gpu) return false;
      const a = await navigator.gpu.requestAdapter();
      return !!a;
    });
    console.log(`${exe.split('/').pop()} headless=${headless} [${args.join(' ')}] → adapter: ${gpuOk}`);
    if (gpuOk) break outer;
    await browser.close();
    browser = null;
  }
}
if (!browser) {
  console.error('FAIL: 无法获得 WebGPU adapter');
  process.exit(1);
}

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

// 1) GPU vs CPU 核对
await page.goto(`${url}/#/settings`, { waitUntil: 'networkidle' });
await page.waitForSelector('text=运行核对');
await page.click('text=运行核对');
await page.waitForSelector('.info-box, .error-box', { timeout: 60000 });
const verifyText = await page.textContent('.info-box, .error-box');
console.log('GPU 核对结果:', verifyText.trim());
const verifyPass = verifyText.includes('✓');

// 2) 预览页渲染 + FPS
await page.goto(`${url}/#/preview`, { waitUntil: 'networkidle' });
await page.waitForSelector('.canvas-wrap canvas');
await page.waitForTimeout(4000);
const hud = await page.textContent('.canvas-hud');
console.log('预览 HUD:', hud);
await page.screenshot({ path: 'e2e-preview.png' });

// 3) 分析页跑一遍
await page.goto(`${url}/#/analysis`, { waitUntil: 'networkidle' });
await page.click('text=开始分析');
await page.waitForSelector('.score-bar', { timeout: 120000 });
const scores = await page.$$eval('.score-bar .label', (els) => els.map((e) => e.textContent));
console.log('分析评分:', JSON.stringify(scores));
await page.screenshot({ path: 'e2e-analysis.png' });

await browser.close();
const fps = parseFloat(hud);
console.log(`\n汇总: GPU核对=${verifyPass ? '通过' : '失败'}, FPS≈${fps}`);
process.exit(verifyPass ? 0 : 1);
