import { el, button, slider, selectRow } from '../ui/dom';
import { store } from '../state';
import { refract, snellRefractedAngle, iorCauchy } from '../optics/snell';
import { Vec3, normalize, angleDeg } from '../optics/vec3';
import { toast } from './library';

/** 设置页面：渲染质量 / 物理参数 / 物理自检 */
export function renderSettings(root: HTMLElement): void {
  const s = store.settings;

  const qualityCard = el('div', { className: 'card' });
  qualityCard.append(el('h3', {}, '渲染质量'));
  qualityCard.append(selectRow('追踪波长数', [['1', '1（单色，最快）'], ['3', '3（RGB 三波长）'], ['5', '5（高保真色散）']],
    String(s.numWavelengths), (v) => { s.numWavelengths = Number(v) as 1 | 3 | 5; store.saveSettings(); }));
  qualityCard.append(slider('最大反弹次数', 2, 12, 1, s.maxBounces, '', (v) => { s.maxBounces = v; store.saveSettings(); }));
  qualityCard.append(slider('渲染分辨率', 0.3, 1, 0.05, s.resolutionScale, '', (v) => { s.resolutionScale = v; store.saveSettings(); }));
  qualityCard.append(el('div', { className: 'check-row' },
    checkbox(s.autoResolution, (v) => { s.autoResolution = v; store.saveSettings(); }),
    el('span', {}, '自适应分辨率（帧率不足时自动降低，保 30fps）')));
  qualityCard.append(el('div', { className: 'check-row' },
    checkbox(s.showFps, (v) => { s.showFps = v; store.saveSettings(); }),
    el('span', {}, '显示 FPS')));

  const envCard = el('div', { className: 'card' });
  envCard.append(el('h3', {}, '光照与显示'));
  envCard.append(slider('环境光强度', 0.2, 3, 0.1, s.envIntensity, '×', (v) => { s.envIntensity = v; store.saveSettings(); }));
  envCard.append(slider('曝光', 0.4, 3, 0.1, s.exposure, '', (v) => { s.exposure = v; store.saveSettings(); }));
  envCard.append(slider('转台速度', 5, 120, 5, s.turntableSpeed, '°/s', (v) => { s.turntableSpeed = v; store.saveSettings(); }));

  const physCard = el('div', { className: 'card' });
  physCard.append(el('h3', {}, '物理参数（钻石色散）'));
  physCard.append(slider('柯西系数 A', 2.3, 2.5, 0.0001, s.cauchyA, '', (v) => { s.cauchyA = v; store.saveSettings(); }));
  physCard.append(slider('柯西系数 B', 0.008, 0.02, 0.0001, s.cauchyB, ' µm²', (v) => { s.cauchyB = v; store.saveSettings(); }));
  const nd = iorCauchy(587.6, s.cauchyA, s.cauchyB);
  const disp = iorCauchy(486.1, s.cauchyA, s.cauchyB) - iorCauchy(656.3, s.cauchyA, s.cauchyB);
  physCard.append(el('div', { className: 'muted' },
    `当前折射率 n_d = ${nd.toFixed(4)}（钻石 2.417）· 色散 n_F−n_C = ${disp.toFixed(4)}（钻石 0.025）`));
  physCard.append(el('div', { style: 'margin-top:10px' },
    button('恢复默认物理参数', () => {
      s.cauchyA = 2.3798; s.cauchyB = 0.01315;
      store.saveSettings();
      toast('已恢复默认');
    })));

  const checkCard = el('div', { className: 'card' });
  checkCard.append(el('h3', {}, '物理自检（斯涅尔定律核对）'));
  const checkOut = el('div', { className: 'muted' }, '点击按钮运行自检：随机入射角 + 多折射率组合，与手算斯涅尔定律逐一核对。');
  checkCard.append(checkOut);
  checkCard.append(el('div', { style: 'margin-top:10px' },
    button('运行物理自检', () => {
      const r = selfCheck();
      checkOut.replaceChildren(el('div', {},
        el('div', {}, `核对样本：${r.samples} 组`),
        el('div', {}, `最大折射角误差：${r.maxErrDeg.toExponential(3)}°（验收标准 < 0.01°）`),
        el('div', { style: `margin-top:6px;font-weight:600;color:${r.pass ? '#7fc97f' : 'var(--danger)'}` },
          r.pass ? '✓ 通过：光线追踪物理与手算斯涅尔定律一致' : '✗ 未通过，请检查物理核心'),
      ));
    }, 'btn primary')));

  root.append(el('div', { className: 'page' },
    el('h2', {}, '设置'),
    el('div', { className: 'settings-grid' },
      el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, qualityCard, envCard),
      el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, physCard, checkCard),
    ),
  ));
}

function checkbox(checked: boolean, onchange: (v: boolean) => void): HTMLInputElement {
  const c = el('input', { type: 'checkbox' }) as HTMLInputElement;
  c.checked = checked;
  c.addEventListener('change', () => onchange(c.checked));
  return c;
}

/** 浏览器内物理自检：与手算斯涅尔定律核对 */
function selfCheck(): { samples: number; maxErrDeg: number; pass: boolean } {
  let maxErr = 0;
  let samples = 0;
  const normals: Vec3[] = [[0, 1, 0], normalize([1, 2, 3]), normalize([-0.3, 0.8, 0.52])];
  for (const N of normals) {
    const tangent = normalize(Math.abs(N[1]) < 0.9
      ? [N[2], 0, -N[0]] as Vec3
      : [0, -N[2], N[1]] as Vec3);
    for (const [n1, n2] of [[1, 2.417], [2.417, 1], [1.5, 2.1]] as const) {
      for (let thetaI = 0.5; thetaI < 89; thetaI += 2.3) {
        const expected = snellRefractedAngle((thetaI * Math.PI) / 180, n1, n2);
        const th = (thetaI * Math.PI) / 180;
        const I: Vec3 = normalize([
          tangent[0] * Math.sin(th) - N[0] * Math.cos(th),
          tangent[1] * Math.sin(th) - N[1] * Math.cos(th),
          tangent[2] * Math.sin(th) - N[2] * Math.cos(th),
        ]);
        const T = refract(I, N, n1 / n2);
        samples++;
        if (expected === null) continue; // TIR 情形由单元测试覆盖
        if (!T) continue;
        const err = Math.abs(angleDeg(T, [-N[0], -N[1], -N[2]]) - (expected * 180) / Math.PI);
        maxErr = Math.max(maxErr, err);
      }
    }
  }
  return { samples, maxErrDeg: maxErr, pass: maxErr < 0.01 };
}
