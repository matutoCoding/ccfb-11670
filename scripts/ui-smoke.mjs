import { chromium } from 'playwright-core';
const exe = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1255/chrome-win64/chrome.exe';
const url = process.argv[2] ?? 'http://127.0.0.1:54529';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const results = {};
await page.goto(`${url}/#/library`, { waitUntil: 'networkidle' });
results.library = {
  cards: await page.locator('.card').count(),
  names: await page.locator('.card .name').allTextContents(),
};
// 新建款式
await page.selectOption('.toolbar select', 'princess');
await page.click('text=＋ 新建款式');
await page.waitForTimeout(500);
results.editorAfterCreate = {
  hash: page.url().split('#')[1],
  sliders: await page.locator('.slider-row').count(),
  errorBox: await page.locator('.error-box').count(),
};
// 复制/删除
await page.goto(`${url}/#/library`, { waitUntil: 'networkidle' });
const before = await page.locator('.card').count();
await page.locator('.card').first().locator('text=复制').click();
await page.waitForTimeout(300);
results.duplicate = { before, after: await page.locator('.card').count() };
page.on('dialog', (d) => d.accept());
await page.locator('.card').first().locator('text=删除').click();
await page.waitForTimeout(300);
results.delete = { after: await page.locator('.card').count() };
// 设置页
await page.goto(`${url}/#/settings`, { waitUntil: 'networkidle' });
results.settings = {
  verifyDisabled: await page.locator('text=运行核对').isDisabled(),
  panels: await page.locator('.panel').count(),
};
// 无 GPU 页面的优雅降级
for (const p of ['editor', 'preview', 'analysis']) {
  await page.goto(`${url}/#/${p}`, { waitUntil: 'networkidle' });
  results[`${p}Fallback`] = await page.locator('.error-box').count();
}
results.pageErrors = errors;
console.log(JSON.stringify(results, null, 1));
await browser.close();
