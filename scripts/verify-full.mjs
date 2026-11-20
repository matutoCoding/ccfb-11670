/** 全功能端到端验证:编辑/预览/对比/截图/分析/报告/核对 */
import { chromium } from 'playwright-core';
import { readdirSync, existsSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:54529';
const pwDir = `${process.env.LOCALAPPDATA}/ms-playwright`;
const chromiumDir = readdirSync(pwDir).filter((d) => d.startsWith('chromium-')).sort().pop();
const exe = `${pwDir}/${chromiumDir}/chrome-win64/chrome.exe`;

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const check = (name, ok) => console.log(`${ok ? '✓' : '✗'} ${name}`);

// 1. 款式库
await page.goto(`${url}/#/library`, { waitUntil: 'networkidle' });
check('款式库加载', (await page.locator('.card').count()) >= 3);

// 2. 切工编辑:滑杆交互 + 实时预览
await page.locator('.card').first().click();
await page.waitForSelector('.slider-row input[type=range]');
const sliderCount = await page.locator('.slider-row').count();
check('编辑器滑杆(圆钻7个)', sliderCount === 7);
const statsBefore = await page.textContent('.panel .mono');
await page.locator('.slider-row input[type=range]').first().fill('65');
await page.waitForTimeout(400);
const statsAfter = await page.textContent('.panel .mono');
check('调参数后几何统计更新', statsBefore !== statsAfter);
await page.waitForTimeout(800);
await page.screenshot({ path: 'e2e-editor.png' });
const hud = await page.textContent('.canvas-hud');
check('编辑器预览在渲染', /\d+ fps/.test(hud));

// 3. 渲染预览:环境切换 + 对比模式 + 截图下载
await page.goto(`${url}/#/preview`, { waitUntil: 'networkidle' });
await page.waitForSelector('.canvas-wrap canvas');
await page.click('text=自然光');
await page.waitForTimeout(500);
await page.click('text=⇄ 对比模式');
await page.waitForTimeout(800);
check('对比模式双画布', (await page.locator('.canvas-wrap').count()) === 2);
await page.screenshot({ path: 'e2e-compare.png' });
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.click('text=📷 截图 (1080p)'),
]);
const shotPath = await download.path();
check('截图下载(PNG)', !!shotPath && download.suggestedFilename().endsWith('.png'));

// 4. 光学分析 + 报告下载
await page.goto(`${url}/#/analysis`, { waitUntil: 'networkidle' });
await page.click('text=开始分析');
await page.waitForSelector('.score-bar', { timeout: 120000 });
check('分析评分出现', (await page.locator('.score-bar').count()) === 4);
await page.waitForTimeout(1000);
await page.screenshot({ path: 'e2e-analysis-full.png', fullPage: true });
const [report] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.click('text=导出参数报告'),
]);
check('报告下载(Markdown)', report.suggestedFilename().endsWith('.md'));

// 5. 设置:GPU 核对
await page.goto(`${url}/#/settings`, { waitUntil: 'networkidle' });
await page.click('text=运行核对');
await page.waitForSelector('.info-box, .error-box', { timeout: 60000 });
const verifyText = await page.textContent('.info-box, .error-box');
check(`GPU核对: ${verifyText.trim().slice(0, 60)}`, verifyText.includes('✓'));

// 6. 导入导出(导出按钮触发下载)
await page.goto(`${url}/#/library`, { waitUntil: 'networkidle' });
const [exp] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.click('text=导出全部'),
]);
check('款式库导出(JSON)', exp.suggestedFilename().endsWith('.json'));

const fatal = errors.filter((e) => !e.includes('favicon'));
check(`无页面错误 ${fatal.length ? JSON.stringify(fatal.slice(0, 3)) : ''}`, fatal.length === 0);
await browser.close();
console.log(existsSync('e2e-compare.png') ? '\n截图已保存: e2e-editor.png / e2e-compare.png / e2e-analysis-full.png' : '');
