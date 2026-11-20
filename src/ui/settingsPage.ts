/** 设置页面:渲染参数 + GPU/CPU 物理核对 + 数据管理 */
import { h, slider } from './common';
import { store, AppSettings, saveSettings } from '../state/store';
import { generateGem } from '../geometry/generate';
import { DEFAULT_PARAMS } from '../geometry/types';
import { traceRay } from '../physics/raytrace';
import { diamondIOR } from '../physics/optics';
import { gpuTraceSingleRay } from '../render/renderer';
import { angleDeg, normalize, Vec3 } from '../math/vec3';
import { downloadText } from '../report';

export function settingsPage(
  root: HTMLElement,
  device: GPUDevice | null,
  settings: AppSettings,
): () => void {
  const page = h('div', { class: 'page' });
  root.append(page);

  function persist() {
    saveSettings(settings);
  }

  // --- 渲染设置 ---
  const renderPanel = h('div', { class: 'panel' }, h('h3', {}, '渲染设置'));
  renderPanel.append(
    slider('渲染分辨率', 40, 100, 5, settings.renderScale * 100, '%', (v) => {
      settings.renderScale = v / 100;
      persist();
    }),
  );
  const adaptLabel = h('label', { class: 'row', style: 'margin:8px 0' });
  const adaptChk = h('input', { type: 'checkbox' }) as HTMLInputElement;
  adaptChk.checked = settings.adaptiveScale;
  adaptChk.onchange = () => { settings.adaptiveScale = adaptChk.checked; persist(); };
  adaptLabel.append(adaptChk, ' 自适应分辨率(帧率不足时自动降低,保 30fps)');
  renderPanel.append(
    adaptLabel,
    slider('最大内反射次数', 4, 16, 1, settings.maxBounces, '', (v) => { settings.maxBounces = v; persist(); }),
  );
  const spectralSel = h('select') as HTMLSelectElement;
  spectralSel.append(h('option', { value: '3' }, '3 波长(完整火彩)'));
  spectralSel.append(h('option', { value: '1' }, '1 波长(无火彩,更快)'));
  spectralSel.value = String(settings.spectralSamples);
  spectralSel.onchange = () => { settings.spectralSamples = parseInt(spectralSel.value) as 1 | 3; persist(); };
  renderPanel.append(
    h('div', { class: 'slider-row' }, h('label', {}, '光谱采样'), spectralSel, h('output')),
    slider('默认转台速度', 0, 90, 5, settings.autoRotateDegPerSec || 30, '°/s', (v) => {
      settings.autoRotateDegPerSec = v;
      persist();
    }),
  );

  // --- GPU vs CPU 物理核对 ---
  const verifyPanel = h('div', { class: 'panel' }, h('h3', {}, '光路物理核对(GPU vs CPU)'));
  const verifyOut = h('div', { class: 'mono' }, device ? '尚未运行。' : 'WebGPU 不可用,无法核对。');
  const verifyBtn = h('button', { class: 'primary' }, '运行核对') as HTMLButtonElement;
  verifyBtn.disabled = !device;
  verifyBtn.onclick = async () => {
    if (!device) return;
    verifyBtn.disabled = true;
    verifyOut.textContent = '核对中…';
    try {
      const gem = generateGem(DEFAULT_PARAMS.round);
      const planes = new Float32Array(gem.planes.length * 4);
      gem.planes.forEach((p, i) => planes.set([...p.n, p.d], i * 4));
      const ior = diamondIOR(589.3);
      // 一组代表性光线:不同入射点/角度,覆盖折射、多次全内反射、漏光路径
      const testRays: Array<{ ro: Vec3; rd: Vec3 }> = [];
      for (const [x, z] of [[0, 0], [0.3, 0.1], [-0.4, 0.2], [0.15, -0.35], [0.6, 0.6]] as const) {
        testRays.push({ ro: [x, 3, z], rd: normalize([0, -1, 0]) });
        testRays.push({ ro: [x, 3, z], rd: normalize([0.25, -1, 0.1]) });
        testRays.push({ ro: [x, 3, z], rd: normalize([-0.15, -1, -0.2]) });
      }
      let maxErr = 0;
      let compared = 0;
      const rows: string[] = [];
      for (const { ro, rd } of testRays) {
        const cpu = traceRay(gem.planes, ro, rd, ior, 12);
        const gpu = await gpuTraceSingleRay(device, planes, gem.planes.length, ro, rd, ior, 12);
        if (!cpu.hit || !cpu.exitDir || !gpu.hit) continue;
        const err = angleDeg(cpu.exitDir, gpu.exitDir);
        const wErr = Math.abs(cpu.throughput - gpu.throughput);
        maxErr = Math.max(maxErr, err);
        compared++;
        rows.push(
          `入射(${ro.map((v) => v.toFixed(2))}) → 出射角误差 ${err.toExponential(2)}° · 能量差 ${wErr.toExponential(2)}`,
        );
      }
      const pass = maxErr < 0.01;
      verifyOut.innerHTML = '';
      verifyOut.append(
        h('div', { class: pass ? 'info-box' : 'error-box' },
          `${pass ? '✓ 通过' : '✗ 超差'}:共核对 ${compared} 条光线,最大出射角误差 ${maxErr.toExponential(3)}°(要求 < 0.01°,GPU 为 fp32 计算)`),
        ...rows.slice(0, 6).map((r) => h('div', { class: 'muted' }, r)),
        compared > 6 ? h('div', { class: 'muted' }, `… 共 ${compared} 条`) : '',
      );
    } catch (e) {
      verifyOut.textContent = `核对失败:${(e as Error).message}`;
    } finally {
      verifyBtn.disabled = false;
    }
  };
  verifyPanel.append(
    h('div', { class: 'muted', style: 'margin-bottom:8px' },
      '用 GPU 计算着色器与 CPU 参考实现追踪同一批光线,比较出射方向。CPU 为 float64,GPU 为 fp32,误差应远小于 0.01°。'),
    verifyBtn, h('div', { style: 'height:8px' }), verifyOut,
  );

  // --- 数据管理 ---
  const dataPanel = h('div', { class: 'panel' }, h('h3', {}, '数据管理'));
  const countLabel = h('div', { class: 'muted' }, `当前库存:${store.list().length} 个款式(存于浏览器 localStorage)`);
  const exportAllBtn = h('button', {}, '导出全部款式');
  exportAllBtn.onclick = () => downloadText('diamond-designs.json', store.exportJSON(), 'application/json');
  const clearBtn = h('button', { class: 'danger' }, '清空全部数据');
  clearBtn.onclick = () => {
    if (confirm('确定清空所有款式和设置?此操作不可恢复。')) {
      localStorage.clear();
      location.reload();
    }
  };
  dataPanel.append(countLabel, h('div', { class: 'row', style: 'margin-top:8px' }, exportAllBtn, clearBtn));

  page.append(
    h('h2', {}, '设置'),
    h('div', { class: 'split', style: 'align-items:flex-start' },
      h('div', { class: 'grow', style: 'display:flex;flex-direction:column;gap:16px' }, renderPanel, dataPanel),
      h('div', { class: 'grow' }, verifyPanel)),
  );

  return () => {};
}
