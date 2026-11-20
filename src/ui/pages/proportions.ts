/** 页面 1:比例方案 */
import { el, numField, selectField, button } from '../dom';
import { state, modelOf, invalidate, saveSchemes, PRESETS } from '../store';
import { ProportionParams } from '../../geometry/gem';

export function renderProportions(root: HTMLElement): void {
  root.innerHTML = '';
  const wrap = el('div', { class: 'page' });
  wrap.append(el('h2', {}, ['比例方案 —— 下盘前把比例定准']));

  // 方案选择与预设
  const which = { current: 'A' as 'A' | 'B' };
  const getScheme = () => (which.current === 'A' ? state.schemeA : state.schemeB);

  const presetSel = el('select');
  presetSel.append(el('option', { value: '' }, ['载入预设模板…']));
  PRESETS.forEach((p, i) => presetSel.append(el('option', { value: String(i) }, [p.name])));
  presetSel.onchange = () => {
    const i = parseInt(presetSel.value);
    if (Number.isFinite(i) && PRESETS[i]) {
      Object.assign(getScheme().params, PRESETS[i].patch);
      invalidate(getScheme()); saveSchemes(); rerender();
    }
  };

  wrap.append(el('div', { class: 'toolbar' }, [
    selectField('当前方案', [
      { value: 'A', text: '方案 A' }, { value: 'B', text: '方案 B(对比用)' },
    ], which.current, v => { which.current = v as 'A' | 'B'; rerender(); }),
    presetSel,
    button('保存到浏览器', () => { saveSchemes(); alert('已保存'); }),
  ]));

  const form = el('div', { class: 'form' });
  const info = el('div', { class: 'derived' });

  function rerender(): void {
    renderProportions(root);
  }

  const p = getScheme().params;
  form.append(selectField('琢型', [
    { value: 'round', text: '圆形明亮式' },
    { value: 'princess', text: '公主方' },
    { value: 'oval', text: '椭圆' },
  ], p.shape, v => { p.shape = v as ProportionParams['shape']; invalidate(getScheme()); rerender(); }));

  const upd = (key: keyof ProportionParams) => (v: number) => {
    (p[key] as number) = v;
    invalidate(getScheme()); saveSchemes(); updateDerived();
  };
  form.append(
    numField({ label: '台面比', value: p.tablePct, min: 48, max: 70, step: 0.5, unit: '%', onChange: upd('tablePct') }),
    numField({ label: '冠角', value: p.crownAngle, min: 25, max: 40, step: 0.1, unit: '°', onChange: upd('crownAngle') }),
    // 亭角细调步长 0.05°,对应"40.6 一点点调到 41.2"的用法
    numField({ label: '亭角', value: p.pavilionAngle, min: 38, max: 43.5, step: 0.05, unit: '°', onChange: upd('pavilionAngle') }),
    numField({ label: '腰厚', value: p.girdlePct, min: 0.5, max: 5, step: 0.1, unit: '%', onChange: upd('girdlePct') }),
    numField({ label: '底尖', value: p.culetPct, min: 0, max: 4, step: 0.1, unit: '%', onChange: upd('culetPct') }),
  );
  if (p.shape === 'oval')
    form.append(numField({ label: '长宽比', value: p.ratio, min: 1.1, max: 1.8, step: 0.01, onChange: upd('ratio') }));
  if (p.shape === 'round' || p.shape === 'oval')
    form.append(
      numField({ label: '星刻面长度', value: p.starLengthPct, min: 40, max: 65, step: 1, unit: '%', onChange: upd('starLengthPct') }),
      numField({ label: '下腰面长度', value: p.lowerGirdlePct, min: 65, max: 90, step: 1, unit: '%', onChange: upd('lowerGirdlePct') }),
    );
  if (p.shape === 'princess')
    form.append(numField({ label: '亭部人字层数', value: p.chevrons, min: 2, max: 4, step: 1, onChange: upd('chevrons') }));

  function updateDerived(): void {
    const m = modelOf(getScheme());
    info.innerHTML = '';
    const d = m.derived;
    info.append(
      el('div', { class: 'stat' }, [el('b', {}, ['冠高']), `${d.crownHeightPct.toFixed(1)}%`]),
      el('div', { class: 'stat' }, [el('b', {}, ['亭深']), `${d.pavilionDepthPct.toFixed(1)}%`]),
      el('div', { class: 'stat' }, [el('b', {}, ['全深']), `${d.totalDepthPct.toFixed(1)}%`]),
      el('div', { class: 'stat' }, [el('b', {}, ['刻面数']), String(m.facets.length)]),
    );
  }
  updateDerived();

  const hint = el('p', { class: 'hint' }, [
    '改完比例到「光学观测」看 ASET 变化,到「切工评级」看两套方案并排对比。亭角步长 0.05°,漏光面积随角度连续变化。',
  ]);

  wrap.append(form, info, hint);
  root.append(wrap);
}
