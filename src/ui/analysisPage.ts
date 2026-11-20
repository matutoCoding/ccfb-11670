/** 光学分析页面:亮度/火彩/闪烁评分 + 漏光刻面图 + 光返回图 + 报告导出 */
import { h, designSelect, attachOrbit, defaultCamera, webgpuMissing } from './common';
import { store, AppSettings } from '../state/store';
import { generateGem } from '../geometry/generate';
import { analyzeGem, AnalysisResult, facetLeakColors } from '../analysis/analyze';
import { ENV_NAMES, EnvType } from '../render/env';
import { MeshRenderer } from '../render/meshRenderer';
import { perspective, lookAt, multiply } from '../math/mat4';
import { buildReport, downloadText } from '../report';

export function analysisPage(
  root: HTMLElement,
  query: URLSearchParams,
  device: GPUDevice | null,
  settings: AppSettings,
): () => void {
  const page = h('div', { class: 'page' });
  root.append(page);
  if (!device) {
    page.append(webgpuMissing());
    return () => {};
  }
  const dev = device;
  const designs = store.list();
  let currentId = query.get('id') ?? designs[0]?.id;
  let envType: EnvType = settings.envType;
  let result: AnalysisResult | null = null;
  let running = false;

  const sel = designSelect(designs, currentId ?? null, (id) => { currentId = id; reset(); });
  const envSel = h('select') as HTMLSelectElement;
  ENV_NAMES.forEach((n, i) => envSel.append(h('option', { value: String(i) }, n)));
  envSel.value = String(envType);
  envSel.onchange = () => { envType = parseInt(envSel.value) as EnvType; };

  const runBtn = h('button', { class: 'primary' }, '开始分析') as HTMLButtonElement;
  const reportBtn = h('button', {}, '导出参数报告') as HTMLButtonElement;
  reportBtn.disabled = true;
  const progress = h('div', { class: 'progress-track', style: 'display:none' });
  const progressFill = h('div', { class: 'progress-fill' });
  progress.append(progressFill);
  const stageLabel = h('span', { class: 'muted' }, '');

  const scoresBox = h('div', { class: 'panel' }, h('div', { class: 'muted' }, '选择款式后点击「开始分析」。'));
  const lrCanvas = h('canvas', { style: 'width:100%;image-rendering:pixelated;border-radius:8px;background:#000' });
  const leakCanvas = h('canvas');
  const leakWrap = h('div', { class: 'canvas-wrap', style: 'min-height:320px' }, leakCanvas,
    h('div', { class: 'canvas-hud' }, '漏光图:红=漏光刻面,绿=回光刻面,灰=无贡献 · 可拖拽旋转'));

  function reset() {
    result = null;
    reportBtn.disabled = true;
    scoresBox.innerHTML = '';
    scoresBox.append(h('div', { class: 'muted' }, '参数已变更,请重新分析。'));
  }

  function scoreBar(label: string, value: number, suffix = '/ 100'): HTMLElement {
    return h('div', { class: 'score-bar' },
      h('div', { class: 'label' }, h('span', {}, label), h('span', {}, `${value.toFixed(1)} ${suffix}`)),
      h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${Math.min(100, value)}%` })));
  }

  runBtn.onclick = async () => {
    const d = store.get(currentId ?? '');
    if (!d || running) return;
    running = true;
    runBtn.disabled = true;
    progress.style.display = '';
    try {
      const gem = generateGem(d.params);
      result = await analyzeGem(gem, envType, 128, (frac, stage) => {
        progressFill.style.width = `${frac * 100}%`;
        stageLabel.textContent = stage;
      });
      showResult(d.params, gem);
    } catch (e) {
      scoresBox.innerHTML = '';
      scoresBox.append(h('div', { class: 'error-box' }, `分析失败:${(e as Error).message}`));
    } finally {
      running = false;
      runBtn.disabled = false;
      progress.style.display = 'none';
      stageLabel.textContent = '';
    }
  };

  let meshRenderer: MeshRenderer | null = null;
  let meshRaf = 0;
  const leakCam = defaultCamera();

  function showResult(_params: unknown, gem: ReturnType<typeof generateGem>) {
    if (!result) return;
    scoresBox.innerHTML = '';
    scoresBox.append(
      scoreBar('亮度(光返回)', result.brightness),
      scoreBar('火彩(色散分离)', result.fire),
      scoreBar('闪烁(转动变化)', result.scintillation),
      scoreBar('漏光率', result.leakagePct, '%'),
      h('div', { class: 'muted', style: 'font-size:12px' },
        '评分口径:亮度=返回上半球能量占比(理想切工≈65 记 100);火彩=红/蓝出射角分离加权平均(3° 记 100);闪烁=±2° 转动下强度显著变化像素占比。'),
    );

    // 光返回图
    const { width, height, data } = result.lightReturn;
    lrCanvas.width = width;
    lrCanvas.height = height;
    const ctx = lrCanvas.getContext('2d')!;
    const img = ctx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      for (let c = 0; c < 3; c++) {
        const v = data[i * 3 + c];
        img.data[i * 4 + c] = Math.round(255 * Math.pow(v / (1 + v), 1 / 2.2));
      }
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    // 漏光刻面图
    if (!meshRenderer) {
      meshRenderer = new MeshRenderer(dev, leakCanvas);
      attachOrbit(leakCanvas, leakCam, () => {});
      const loop = () => {
        const w = leakCanvas.clientWidth || 600;
        const hgt = leakCanvas.clientHeight || 320;
        const proj = perspective(30, w / hgt, 0.1, 100);
        const yaw = (leakCam.yawDeg * Math.PI) / 180;
        const pitch = (leakCam.pitchDeg * Math.PI) / 180;
        const view = lookAt(
          [leakCam.dist * Math.cos(pitch) * Math.sin(yaw), leakCam.dist * Math.sin(pitch), leakCam.dist * Math.cos(pitch) * Math.cos(yaw)],
          [0, -0.25, 0],
          [0, 1, 0],
        );
        meshRenderer!.render(multiply(proj, view), [0.5, 1, 0.3]);
        meshRaf = requestAnimationFrame(loop);
      };
      loop();
    }
    meshRenderer.setMesh(gem, facetLeakColors(result));
    reportBtn.disabled = false;
  }

  reportBtn.onclick = () => {
    const d = store.get(currentId ?? '');
    if (!d || !result) return;
    downloadText(`切工报告-${d.name}.md`, buildReport(d, result, envType));
  };

  page.append(
    h('div', { class: 'toolbar' },
      h('h2', {}, '光学分析'), sel, envSel, runBtn, reportBtn, stageLabel),
    progress,
    h('div', { class: 'split', style: 'align-items:flex-start' },
      h('div', { style: 'width:320px;flex:none' }, scoresBox),
      h('div', { class: 'grow' },
        h('h3', {}, '光返回图(观察方向看到的亮度分布)'), lrCanvas,
        h('h3', {}, '漏光刻面图'), leakWrap)),
  );

  return () => cancelAnimationFrame(meshRaf);
}
