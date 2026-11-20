/** 渲染预览页面:环境切换 / 自动转台 / 对比模式 / 截图 */
import { h, designSelect, webgpuMissing } from './common';
import { store, AppSettings } from '../state/store';
import { generateGem } from '../geometry/generate';
import { PreviewPane } from './previewPane';
import { ENV_NAMES, EnvType } from '../render/env';
import { downloadBlob } from '../report';

export function previewPage(
  root: HTMLElement,
  query: URLSearchParams,
  device: GPUDevice | null,
  settings: AppSettings,
): () => void {
  const page = h('div', { class: 'page page-fill' });
  root.append(page);
  if (!device) {
    page.append(webgpuMissing());
    return () => {};
  }
  const dev = device;
  const designs = store.list();
  const idA = query.get('id') ?? designs[0]?.id;
  const idB = query.get('compare') ?? null;

  const paneA = new PreviewPane(device, settings);
  let paneB: PreviewPane | null = null;
  let compareOn = idB !== null;

  // 环境切换
  const envBar = h('div', { class: 'row' });
  const envBtns: HTMLButtonElement[] = [];
  ENV_NAMES.forEach((name, i) => {
    const b = h('button', {}, name) as HTMLButtonElement;
    b.onclick = () => setEnv(i as EnvType);
    envBtns.push(b);
    envBar.append(b);
  });
  function setEnv(t: EnvType) {
    paneA.envType = t;
    if (paneB) paneB.envType = t;
    settings.envType = t;
    envBtns.forEach((b, i) => b.classList.toggle('active', i === t));
  }

  // 自动转台
  const rotateBtn = h('button', {}, '▶ 自动转台') as HTMLButtonElement;
  let rotating = false;
  rotateBtn.onclick = () => {
    rotating = !rotating;
    const speed = rotating ? (settings.autoRotateDegPerSec || 30) : 0;
    paneA.autoRotateDegPerSec = speed;
    if (paneB) paneB.autoRotateDegPerSec = speed;
    rotateBtn.textContent = rotating ? '⏸ 停止转台' : '▶ 自动转台';
    rotateBtn.classList.toggle('active', rotating);
  };

  // 截图
  const shotBtn = h('button', {}, '📷 截图 (1080p)');
  shotBtn.onclick = async () => {
    shotBtn.disabled = true;
    try {
      const blob = await paneA.screenshot();
      downloadBlob(`diamond-${Date.now()}.png`, blob);
    } finally {
      shotBtn.disabled = false;
    }
  };

  // 对比模式
  const compareBtn = h('button', {}, '⇄ 对比模式') as HTMLButtonElement;
  const split = h('div', { class: 'split' });
  const selWrapB = h('span');

  function currentId(sel: HTMLSelectElement): string | undefined {
    return sel.value || undefined;
  }

  const selA = designSelect(designs, idA ?? null, () => reload());
  const selB = designSelect(designs, idB ?? designs[1]?.id ?? idA ?? null, () => reload());

  function reload() {
    const a = store.get(currentId(selA) ?? '');
    if (a) {
      try {
        paneA.setGem(generateGem(a.params));
        paneA.wrap.querySelector('.canvas-label')?.remove();
        paneA.wrap.append(h('div', { class: 'canvas-label' }, a.name));
      } catch { /* 非凸参数,保持上一帧 */ }
    }
    if (paneB) {
      const b = store.get(currentId(selB) ?? '');
      if (b) {
        try {
          paneB.setGem(generateGem(b.params));
          paneB.wrap.querySelector('.canvas-label')?.remove();
          paneB.wrap.append(h('div', { class: 'canvas-label' }, b.name));
        } catch { /* 同上 */ }
      }
    }
  }

  function setCompare(on: boolean) {
    compareOn = on;
    compareBtn.classList.toggle('active', on);
    split.innerHTML = '';
    if (on && !paneB) {
      paneB = new PreviewPane(dev, settings, '', paneA.cam); // 共享相机,两边同步转动
      paneB.envType = paneA.envType;
      paneB.autoRotateDegPerSec = paneA.autoRotateDegPerSec;
      paneB.start();
    }
    split.append(paneA.wrap);
    if (on && paneB) split.append(paneB.wrap);
    selWrapB.style.display = on ? '' : 'none';
    reload();
  }
  compareBtn.onclick = () => setCompare(!compareOn);

  selWrapB.append(selB);
  page.append(
    h('div', { class: 'toolbar' },
      h('h2', {}, '渲染预览'),
      selA, selWrapB,
      h('span', { class: 'grow' }),
      ...envBar.childNodes,
      rotateBtn, compareBtn, shotBtn),
    split,
  );

  setEnv(settings.envType);
  setCompare(compareOn);
  paneA.start();

  return () => {
    paneA.dispose();
    paneB?.dispose();
  };
}
