import { el, button, selectRow } from '../ui/dom';
import { store, downloadFile } from '../state';
import { buildCut } from '../geometry/cuts';
import { Viewport } from '../ui/viewport';
import { toast } from './library';

const ENV_OPTIONS: [string, string][] = [
  ['0', '珠宝柜台灯'], ['1', '自然光'], ['2', '点光源'],
];

/** 渲染预览页面：单视图 / 对比模式 / 转台 / 截图 / FPS */
export function renderPreview(root: HTMLElement, designId?: string): (() => void) | void {
  const designs = store.designs;
  if (designs.length === 0) {
    root.append(el('div', { className: 'page' }, el('div', { className: 'card' }, '请先在款式库中创建款式。')));
    return;
  }
  let leftId = designId && store.get(designId) ? designId : designs[0].id;
  let rightId = designs.length > 1 ? designs[1].id : leftId;
  let compareMode = false;

  // —— 布局 ——
  const leftHud = el('div', { className: 'hud' });
  const rightHud = el('div', { className: 'hud' });
  const leftLabel = el('div', { className: 'vp-label' });
  const rightLabel = el('div', { className: 'vp-label' });
  const leftVp = el('div', { className: 'viewport' }, leftHud, leftLabel);
  const rightVp = el('div', { className: 'viewport', style: 'display:none' }, rightHud, rightLabel);
  const wrap = el('div', { className: 'preview-wrap' }, leftVp, rightVp);
  const side = el('div', { className: 'preview-side' });
  const page = el('div', { className: 'page-fill' }, wrap, side);
  root.append(page);

  const left = new Viewport(leftVp);
  const right = new Viewport(rightVp);
  rightVp.insertBefore(right.canvas, rightVp.firstChild);
  // 调试挂钩（冒烟测试用）
  (window as unknown as { __vp?: unknown }).__vp = { left, right };

  const designOptions = (): [string, string][] => store.designs.map((d) => [d.id, d.name]);

  const applySettings = (vp: Viewport) => {
    const s = store.settings;
    vp.params.numWavelengths = s.numWavelengths;
    vp.params.maxBounces = s.maxBounces;
    vp.params.cauchyA = s.cauchyA;
    vp.params.cauchyB = s.cauchyB;
    vp.params.envIntensity = s.envIntensity;
    vp.params.exposure = s.exposure;
    vp.turntableSpeedDeg = s.turntableSpeed;
  };

  // 自适应分辨率：帧率低于 28 逐步降，高于 55 且未满逐步升
  let resScale = store.settings.resolutionScale;
  const adaptResolution = (fps: number) => {
    if (!store.settings.autoResolution) return;
    if (fps < 28 && resScale > 0.35) resScale = Math.max(0.35, resScale - 0.05);
    else if (fps > 55 && resScale < 1) resScale = Math.min(1, resScale + 0.02);
  };
  left.getResolutionScale = () => (store.settings.autoResolution ? resScale : store.settings.resolutionScale);
  right.getResolutionScale = left.getResolutionScale;
  left.onFrame = (fps) => {
    adaptResolution(fps);
    updateHud();
  };
  right.onFrame = () => updateHud();

  const updateHud = () => {
    const s = store.settings;
    const fpsText = s.showFps ? `FPS ${left.getFps().toFixed(0)} · 分辨率 ${(resScale * 100).toFixed(0)}%` : '';
    leftHud.textContent = fpsText;
    rightHud.textContent = compareMode && s.showFps ? `FPS ${right.getFps().toFixed(0)}` : '';
  };

  const loadDesign = async (vp: Viewport, id: string, label: HTMLElement) => {
    const d = store.get(id);
    if (!d) return;
    label.textContent = d.name;
    await vp.setGeometry(buildCut(d.cut, d.params));
    vp.invalidate();
  };

  // —— 侧栏控件 ——
  const rebuildSide = () => {
    side.replaceChildren();
    const selCard = el('div', { className: 'card' });
    selCard.append(el('h3', {}, '款式'));
    selCard.append(selectRow(compareMode ? '左侧' : '款式', designOptions(), leftId, (v) => {
      leftId = v;
      void loadDesign(left, leftId, leftLabel);
      rebuildSide();
    }));
    if (compareMode) {
      selCard.append(selectRow('右侧', designOptions(), rightId, (v) => {
        rightId = v;
        void loadDesign(right, rightId, rightLabel);
      }));
    }
    side.append(selCard);

    const envCard = el('div', { className: 'card' });
    envCard.append(el('h3', {}, '环境光'));
    envCard.append(selectRow('环境', ENV_OPTIONS, String(left.params.envMode), (v) => {
      const mode = Number(v) as 0 | 1 | 2;
      left.params.envMode = mode;
      right.params.envMode = mode;
      left.invalidate(); right.invalidate();
    }));
    side.append(envCard);

    const viewCard = el('div', { className: 'card', style: 'display:flex;flex-direction:column;gap:8px' });
    viewCard.append(el('h3', {}, '视图'));
    const rotBtn = button('自动转台', () => {
      left.autoRotate = !left.autoRotate;
      right.autoRotate = left.autoRotate;
      rotBtn.className = left.autoRotate ? 'btn active' : 'btn';
      left.invalidate(); right.invalidate();
    }, left.autoRotate ? 'btn active' : 'btn');
    const syncBtn = button('视角同步到右侧', () => {
      right.params.azimuth = left.params.azimuth;
      right.params.elevation = left.params.elevation;
      right.params.distance = left.params.distance;
      right.invalidate();
    });
    viewCard.append(rotBtn);
    viewCard.append(button(compareMode ? '关闭对比模式' : '对比模式（两款并排）', () => {
      compareMode = !compareMode;
      rightVp.style.display = compareMode ? '' : 'none';
      if (compareMode) {
        void loadDesign(right, rightId, rightLabel).then(() => right.start());
      }
      left.invalidate();
      rebuildSide();
    }, compareMode ? 'btn active' : 'btn'));
    if (compareMode) viewCard.append(syncBtn);
    viewCard.append(button('截图 (PNG)', async () => {
      const blob = await left.renderer.capture(left.params, 2);
      if (blob) {
        const name = store.get(leftId)?.name ?? 'diamond';
        downloadFile(`${name}-预览.png`, blob, 'image/png');
        toast('截图已保存（2× 超采样）');
      } else {
        toast('截图失败');
      }
    }));
    side.append(viewCard);

    const tip = el('div', { className: 'card muted' },
      '拖拽旋转视角 · 滚轮缩放 · 转台开启后闪烁随转动实时变化');
    side.append(tip);
  };

  // —— 初始化 ——
  applySettings(left);
  applySettings(right);
  rebuildSide();
  updateHud();
  Promise.all([left.init(buildCut(store.get(leftId)!.cut, store.get(leftId)!.params))])
    .then(async () => {
      await right.init(buildCut(store.get(rightId)!.cut, store.get(rightId)!.params));
      leftLabel.textContent = store.get(leftId)?.name ?? '';
      rightLabel.textContent = store.get(rightId)?.name ?? '';
      left.start();
    })
    .catch((e) => toast(`WebGPU 初始化失败：${e.message ?? e}`));

  return () => {
    left.dispose();
    right.dispose();
  };
}
