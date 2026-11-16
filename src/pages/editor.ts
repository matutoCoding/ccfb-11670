import { el, button, slider, selectRow } from '../ui/dom';
import { store, CUT_LABEL } from '../state';
import { buildCut, CutType, FACET_KIND_LABEL, GemGeometry } from '../geometry/cuts';
import { Viewport } from '../ui/viewport';
import { toast } from './library';

/** 切工编辑页面：参数化调节 + 实时预览 + 比例测量 */
export function renderEditor(root: HTMLElement, designId: string): (() => void) | void {
  const design = store.get(designId);
  if (!design) {
    root.append(el('div', { className: 'page' }, el('div', { className: 'card' }, '款式不存在。')));
    return;
  }

  let geo: GemGeometry = buildCut(design.cut, design.params);

  // —— 布局 ——
  const canvasWrap = el('div', { className: 'editor-canvas-wrap' });
  const controlsPanel = el('div', { className: 'panel' });
  const statsCard = el('div', { className: 'card' });
  const split = el('div', { className: 'split' });
  const page = el('div', { className: 'page-fill', style: 'flex-direction:column' });
  const viewport = new Viewport(canvasWrap);

  page.append(
    el('div', { style: 'padding:16px 16px 0; display:flex; gap:12px; align-items:center;' },
      el('h2', { style: 'margin:0' }, `切工编辑 · ${design.name}`),
      el('span', { className: 'muted' }, '参数修改自动保存'),
    ),
    el('div', { style: 'flex:1; padding:16px; min-height:0' }, split),
  );
  split.append(controlsPanel, el('div', { className: 'panel', style: 'display:flex;flex-direction:column;gap:12px' },
    canvasWrap, statsCard));
  canvasWrap.style.flex = '1';
  root.append(page);

  // —— 控件 ——
  const rebuild = () => {
    controlsPanel.replaceChildren();

    const cutCard = el('div', { className: 'card', style: 'margin-bottom:12px' });
    cutCard.append(
      el('h3', {}, '切工类型'),
      selectRow('切工', [
        ['round', CUT_LABEL.round], ['princess', CUT_LABEL.princess], ['oval', CUT_LABEL.oval],
      ], design.cut, (v) => {
        store.updateCut(design.id, v as CutType);
        refresh();
      }),
    );
    controlsPanel.append(cutCard);

    const p = design.params;
    const paramCard = el('div', { className: 'card', style: 'margin-bottom:12px' });
    paramCard.append(el('h3', {}, '切工参数'));
    const S = (label: string, key: keyof typeof p, min: number, max: number, step: number, unit: string) =>
      paramCard.append(slider(label, min, max, step, p[key], unit, (v) => {
        store.updateParams(design.id, { [key]: v });
        refresh();
      }));
    S('台面比', 'tablePct', 45, 75, 0.5, '%');
    S('冠角', 'crownAngle', 20, 42, 0.1, '°');
    S('亭角', 'pavilionAngle', 34, 46, 0.1, '°');
    S('腰棱厚度', 'girdlePct', 0.5, 5, 0.1, '%');
    if (design.cut !== 'princess') {
      S('星刻面长度', 'starLengthPct', 20, 80, 1, '%');
      S('下腰刻面长度', 'lowerGirdlePct', 50, 95, 1, '%');
    }
    if (design.cut === 'oval') {
      S('长宽比', 'ratio', 1.1, 1.8, 0.01, '');
    }
    controlsPanel.append(paramCard);

    const envCard = el('div', { className: 'card' });
    envCard.append(el('h3', {}, '预览环境'));
    envCard.append(selectRow('环境光', [
      ['0', '珠宝柜台灯'], ['1', '自然光'], ['2', '点光源'],
    ], String(viewport.params.envMode), (v) => {
      viewport.params.envMode = Number(v) as 0 | 1 | 2;
      viewport.invalidate();
    }));
    envCard.append(button(viewport.autoRotate ? '停止转台' : '自动转台', () => {
      viewport.autoRotate = !viewport.autoRotate;
      viewport.invalidate();
      rebuild();
    }, viewport.autoRotate ? 'btn active' : 'btn'));
    controlsPanel.append(envCard);
  };

  const refresh = () => {
    geo = buildCut(design.cut, design.params);
    void viewport.setGeometry(geo);
    updateStats();
    rebuild();
  };

  const updateStats = () => {
    const p = design.params;
    const hC = (1 - p.tablePct / 100) * Math.tan(p.crownAngle * Math.PI / 180);
    const hP = Math.tan(p.pavilionAngle * Math.PI / 180);
    const g = p.girdlePct / 100 * 2;
    const depthPct = ((hC + hP + g) / 2 * 100).toFixed(1);
    const crownPct = (hC / 2 * 100).toFixed(1);
    const pavPct = (hP / 2 * 100).toFixed(1);
    const kindCount = new Map<string, number>();
    for (const f of geo.facets) kindCount.set(f.kind, (kindCount.get(f.kind) ?? 0) + 1);
    statsCard.replaceChildren(
      el('h3', {}, '比例与结构'),
      el('div', { className: 'muted', style: 'display:grid;grid-template-columns:1fr 1fr;gap:4px 16px' },
        el('span', {}, `全深比：${depthPct}%`),
        el('span', {}, `冠高比：${crownPct}%`),
        el('span', {}, `亭深比：${pavPct}%`),
        el('span', {}, `腰棱：${p.girdlePct}%`),
        el('span', {}, `刻面总数：${geo.facets.length}`),
        el('span', {}, `切工：${CUT_LABEL[design.cut]}`),
      ),
      el('div', { className: 'muted', style: 'margin-top:8px' },
        [...kindCount.entries()].map(([k, n]) => `${FACET_KIND_LABEL[k as keyof typeof FACET_KIND_LABEL]}×${n}`).join(' · ')),
    );
  };

  // 初始化
  rebuild();
  updateStats();
  viewport.params.envIntensity = store.settings.envIntensity;
  viewport.params.exposure = store.settings.exposure;
  viewport.params.numWavelengths = store.settings.numWavelengths;
  viewport.params.maxBounces = store.settings.maxBounces;
  viewport.params.cauchyA = store.settings.cauchyA;
  viewport.params.cauchyB = store.settings.cauchyB;
  viewport.turntableSpeedDeg = store.settings.turntableSpeed;
  viewport.renderer.resolutionScale = store.settings.resolutionScale;
  viewport.init(geo).then(() => viewport.start()).catch((e) => {
    toast(String(e.message ?? e));
  });

  return () => viewport.dispose();
}
