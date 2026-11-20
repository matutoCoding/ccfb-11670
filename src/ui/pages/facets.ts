/** 页面 2:刻面编辑 —— 刻面不对称、腰部波浪等磨偏缺陷 */
import { el, numField, selectField, button } from '../dom';
import { state, modelOf, invalidate, saveSchemes } from '../store';
import { FacetKind, KIND_NAMES, FacetTilt } from '../../geometry/gem';

const EDITABLE: FacetKind[] = ['star', 'bezel', 'upperGirdle', 'pavilionMain', 'lowerGirdle', 'crownSide', 'pavilionSide'];

export function renderFacets(root: HTMLElement): void {
  root.innerHTML = '';
  const wrap = el('div', { class: 'page' });
  wrap.append(el('h2', {}, ['刻面编辑 —— 把磨偏单独加上去']));

  const which = { current: 'A' as 'A' | 'B' };
  const getScheme = () => (which.current === 'A' ? state.schemeA : state.schemeB);

  const kindState = { kind: 'bezel' as FacetKind, ring: 0 };
  const listBox = el('div', { class: 'facet-list' });
  const ctrlBox = el('div', { class: 'form' });

  function ringCount(): number {
    const m = modelOf(getScheme());
    return m.facets.filter(f => f.kind === kindState.kind).length;
  }

  function currentTilt(): FacetTilt {
    const d = getScheme().defects;
    let t = d.tilts.find(t => t.kind === kindState.kind && t.ring === kindState.ring);
    if (!t) {
      t = { kind: kindState.kind, ring: kindState.ring, dTiltDeg: 0, dAzimDeg: 0 };
      d.tilts.push(t);
    }
    return t;
  }

  function refreshList(): void {
    listBox.innerHTML = '';
    const m = modelOf(getScheme());
    const groups = new Map<FacetKind, number>();
    for (const f of m.facets) groups.set(f.kind, (groups.get(f.kind) ?? 0) + 1);
    for (const k of EDITABLE) {
      const n = groups.get(k);
      if (!n) continue;
      const tilted = getScheme().defects.tilts.filter(t => t.kind === k && (t.dTiltDeg !== 0 || t.dAzimDeg !== 0)).length;
      const b = button(
        `${KIND_NAMES[k]} ×${n}${tilted ? `(${tilted} 处磨偏)` : ''}`,
        () => { kindState.kind = k; kindState.ring = 0; refresh(); },
        k === kindState.kind ? 'chip active' : 'chip',
      );
      listBox.append(b);
    }
  }

  function refreshCtrl(): void {
    ctrlBox.innerHTML = '';
    const n = ringCount();
    if (n === 0) { ctrlBox.append(el('p', {}, ['该琢型无此刻面组'])); return; }
    kindState.ring = Math.min(kindState.ring, n - 1);
    ctrlBox.append(el('h3', {}, [`${KIND_NAMES[kindState.kind]} #${kindState.ring + 1} / 共 ${n} 个`]));
    ctrlBox.append(numField({
      label: '选择刻面序号', value: kindState.ring + 1, min: 1, max: n, step: 1,
      onChange: v => { kindState.ring = Math.round(v) - 1; refreshCtrl(); },
    }));
    const t = currentTilt();
    ctrlBox.append(
      numField({
        label: '倾角偏移', value: t.dTiltDeg, min: -2, max: 2, step: 0.05, unit: '°',
        onChange: v => { t.dTiltDeg = v; invalidate(getScheme()); saveSchemes(); refreshList(); },
      }),
      numField({
        label: '方位偏移', value: t.dAzimDeg, min: -3, max: 3, step: 0.05, unit: '°',
        onChange: v => { t.dAzimDeg = v; invalidate(getScheme()); saveSchemes(); refreshList(); },
      }),
      button('清除此刻面磨偏', () => {
        const d = getScheme().defects;
        d.tilts = d.tilts.filter(x => !(x.kind === kindState.kind && x.ring === kindState.ring));
        invalidate(getScheme()); saveSchemes(); refresh();
      }),
    );
  }

  function refresh(): void { refreshList(); refreshCtrl(); }

  // 腰部波浪
  const waveBox = el('div', { class: 'form' });
  waveBox.append(el('h3', {}, ['腰部波浪']));
  const d0 = getScheme().defects;
  waveBox.append(
    numField({
      label: '波浪振幅', value: d0.girdleWaveAmpPct, min: 0, max: 3, step: 0.05, unit: '%半径',
      onChange: v => { getScheme().defects.girdleWaveAmpPct = v; invalidate(getScheme()); saveSchemes(); },
    }),
    numField({
      label: '波浪瓣数', value: d0.girdleWaveLobes, min: 2, max: 8, step: 1,
      onChange: v => { getScheme().defects.girdleWaveLobes = Math.round(v); invalidate(getScheme()); saveSchemes(); },
    }),
    numField({
      label: '波浪相位', value: d0.girdleWavePhaseDeg, min: 0, max: 360, step: 5, unit: '°',
      onChange: v => { getScheme().defects.girdleWavePhaseDeg = v; invalidate(getScheme()); saveSchemes(); },
    }),
    button('清除全部磨偏', () => {
      getScheme().defects.tilts = [];
      getScheme().defects.girdleWaveAmpPct = 0;
      invalidate(getScheme()); saveSchemes(); renderFacets(root);
    }, 'danger'),
  );

  wrap.append(
    el('div', { class: 'toolbar' }, [
      selectField('当前方案', [
        { value: 'A', text: '方案 A' }, { value: 'B', text: '方案 B' },
      ], which.current, v => { which.current = v as 'A' | 'B'; refresh(); }),
    ]),
    el('div', { class: 'cols' }, [
      el('div', {}, [el('h3', {}, ['刻面组']), listBox, waveBox]),
      el('div', {}, [ctrlBox]),
    ]),
    el('p', { class: 'hint' }, [
      '磨偏效果到「光学观测 → 八心八箭」看哪个刻面让心形歪掉,或在 ASET 里看漏光区偏移。',
    ]),
  );
  refresh();
  root.append(wrap);
}
