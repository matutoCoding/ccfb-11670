/** 切工编辑页面:参数滑杆 + 实时预览 + 几何统计 */
import { h, slider, webgpuMissing } from './common';
import { store, AppSettings } from '../state/store';
import { generateGem } from '../geometry/generate';
import { CutParams } from '../geometry/types';
import { Gem } from '../geometry/gem';
import { PreviewPane } from './previewPane';

export function editorPage(
  root: HTMLElement,
  query: URLSearchParams,
  device: GPUDevice | null,
  settings: AppSettings,
  navigate: (hash: string) => void,
): () => void {
  const id = query.get('id') ?? store.list()[0]?.id;
  const design = id ? store.get(id) : undefined;
  const page = h('div', { class: 'page page-fill' });
  root.append(page);
  if (!device) {
    page.append(webgpuMissing());
    return () => {};
  }
  if (!design) {
    page.append(h('div', { class: 'error-box' }, '未找到款式,请从款式库选择。'));
    return () => {};
  }

  let gem: Gem | null = null;
  let geomError: string | null = null;
  const pane = new PreviewPane(device, settings, design.name);

  function rebuildGem() {
    try {
      gem = generateGem(design!.params);
      geomError = null;
      pane.setGem(gem);
    } catch (e) {
      geomError = (e as Error).message;
    }
  }

  // 顶部工具栏
  const nameInput = h('input', { type: 'text', value: design.name, style: 'width:200px' }) as HTMLInputElement;
  nameInput.addEventListener('change', () => store.update(design!.id, { name: nameInput.value }));
  const previewBtn = h('button', {}, '去渲染预览 →');
  previewBtn.onclick = () => navigate(`#/preview?id=${design!.id}`);
  const analyzeBtn = h('button', {}, '去光学分析 →');
  analyzeBtn.onclick = () => navigate(`#/analysis?id=${design!.id}`);

  // 参数滑杆
  const p = design.params;
  const controls = h('div', { class: 'panel', style: 'width:340px;flex:none;overflow:auto' });
  const statsBox = h('div', { class: 'mono' });
  const errBox = h('div');

  function param(patch: Partial<CutParams>) {
    Object.assign(p, patch);
    store.update(design!.id, { params: p });
    rebuildGem();
    updateStats();
  }

  controls.append(h('h3', {}, '切工参数'));
  controls.append(slider('台面比', 40, 75, 0.5, p.tablePct, '%', (v) => param({ tablePct: v })));
  controls.append(slider('冠角', 20, 45, 0.1, p.crownAngleDeg, '°', (v) => param({ crownAngleDeg: v })));
  controls.append(slider('亭角', 35, 45, 0.1, p.pavilionAngleDeg, '°', (v) => param({ pavilionAngleDeg: v })));
  controls.append(slider('腰棱厚度', 0.5, 5, 0.1, p.girdlePct, '%', (v) => param({ girdlePct: v })));
  if (p.shape !== 'princess') {
    controls.append(slider('星刻面比', 30, 70, 1, p.starPct, '%', (v) => param({ starPct: v })));
    controls.append(slider('下腰刻面比', 60, 90, 1, p.lowerGirdlePct, '%', (v) => param({ lowerGirdlePct: v })));
  }
  controls.append(slider('底尖比', 0, 3, 0.1, p.culetPct, '%', (v) => param({ culetPct: v })));
  if (p.shape === 'princess') {
    controls.append(slider('人字层数', 2, 4, 1, p.chevronTiers, '', (v) => param({ chevronTiers: v })));
    controls.append(slider('层间递减角', 0, 6, 0.5, p.chevronStepDeg, '°', (v) => param({ chevronStepDeg: v })));
  }
  if (p.shape === 'oval') {
    controls.append(slider('长宽比', 1.1, 1.8, 0.05, p.ovalRatio, '', (v) => param({ ovalRatio: v })));
  }
  controls.append(h('h3', {}, '几何统计'), statsBox, errBox);

  function updateStats() {
    errBox.innerHTML = '';
    if (geomError) {
      errBox.append(h('div', { class: 'error-box' }, `⚠ ${geomError}`));
      statsBox.textContent = '参数组合无法构成凸多面体,请回调。';
      return;
    }
    if (!gem) return;
    const depthPct = (gem.depth / 2) * 100; // 直径为 2
    statsBox.textContent = [
      `刻面数:${gem.facets.length}`,
      `全深比:${depthPct.toFixed(1)}%`,
      `台深比(冠高):${(((gem.facets[0].verts[0][1]) / 2) * 100).toFixed(1)}%`,
    ].join('\n');
  }

  const left = h('div', { class: 'grow', style: 'display:flex;flex-direction:column;min-height:400px' });
  left.append(pane.wrap);

  page.append(
    h('div', { class: 'toolbar' },
      h('h2', {}, '切工编辑'), nameInput, h('span', { class: 'grow' }), analyzeBtn, previewBtn),
    h('div', { class: 'split' }, left, controls),
  );

  rebuildGem();
  updateStats();
  pane.start();

  return () => pane.dispose();
}
