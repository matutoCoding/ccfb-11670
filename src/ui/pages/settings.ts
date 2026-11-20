/** 页面 5:设置 —— 光源、ASET 分区、评分采样 */
import { el, numField, selectField, button } from '../dom';
import { state } from '../store';

export function renderSettings(root: HTMLElement): void {
  root.innerHTML = '';
  const wrap = el('div', { class: 'page' });
  wrap.append(el('h2', {}, ['设置']));

  const lightBox = el('div', { class: 'form' });
  lightBox.append(el('h3', {}, ['光源模型(评级与转台共用)']));
  lightBox.append(selectField('光源类型', [
    { value: 'daylight', text: '散射日光' },
    { value: 'spot', text: '柜台射灯' },
    { value: 'point', text: '单点光源' },
  ], state.light.kind, v => { state.light.kind = v as typeof state.light.kind; }));
  lightBox.append(
    numField({ label: '头部遮挡起始仰角', value: state.light.headShadowDeg, min: 60, max: 85, step: 0.5, unit: '°', onChange: v => { state.light.headShadowDeg = v; } }),
    numField({ label: '射灯仰角', value: state.light.spotElevDeg, min: 30, max: 70, step: 1, unit: '°', onChange: v => { state.light.spotElevDeg = v; } }),
    numField({ label: '射灯数量', value: state.light.spotCount, min: 1, max: 8, step: 1, onChange: v => { state.light.spotCount = Math.round(v); } }),
    numField({ label: '单点光源仰角', value: state.light.pointElevDeg, min: 20, max: 85, step: 1, unit: '°', onChange: v => { state.light.pointElevDeg = v; } }),
    numField({ label: '单点光源方位', value: state.light.pointAzimDeg, min: 0, max: 360, step: 5, unit: '°', onChange: v => { state.light.pointAzimDeg = v; } }),
  );

  const asetBox = el('div', { class: 'form' });
  asetBox.append(el('h3', {}, ['ASET 分区口径']));
  asetBox.append(
    numField({ label: '红区下限(直射光)', value: state.aset.redMinDeg, min: 30, max: 60, step: 1, unit: '°', onChange: v => { state.aset.redMinDeg = v; } }),
    numField({ label: '蓝区下限(头部遮挡)', value: state.aset.blueMinDeg, min: 65, max: 85, step: 1, unit: '°', onChange: v => { state.aset.blueMinDeg = v; } }),
    numField({ label: '图像分辨率', value: state.aset.size, min: 120, max: 400, step: 20, unit: 'px', onChange: v => { state.aset.size = Math.round(v); } }),
  );

  const scoreBox = el('div', { class: 'form' });
  scoreBox.append(el('h3', {}, ['评分采样']));
  scoreBox.append(
    numField({ label: '亮度/火彩采样网格', value: state.score.grid, min: 24, max: 96, step: 4, onChange: v => { state.score.grid = Math.round(v); } }),
    numField({ label: '闪烁转台步数', value: state.score.rotationSteps, min: 6, max: 36, step: 2, onChange: v => { state.score.rotationSteps = Math.round(v); } }),
  );

  wrap.append(
    el('div', { class: 'cols' }, [lightBox, el('div', {}, [asetBox, scoreBox])]),
    el('p', { class: 'hint' }, [
      '物理口径:钻石折射率按 Sellmeier 方程随波长变化(n_D≈2.417),全内反射临界角约 24.4°;' +
      '每次折射/反射均按斯涅尔定律双精度计算,菲涅尔公式计能量损失。',
    ]),
    button('恢复默认设置', () => location.reload()),
  );
  root.append(wrap);
}
