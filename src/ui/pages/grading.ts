/** 页面 4:切工评级 —— 亮度/火彩/闪烁打分,两套方案并排对比,差异高亮 */
import { el, button } from '../dom';
import { state, modelOf } from '../store';
import { fullScore, ScoreBreakdown, GRADE_BANDS } from '../../optics/scoring';
import { computeAset, drawAset, AsetMap, defaultAsetSettings } from '../../optics/aset';
import { openReport } from './report';

export function renderGrading(root: HTMLElement): void {
  root.innerHTML = '';
  const wrap = el('div', { class: 'page' });
  wrap.append(el('h2', {}, ['切工评级 —— 两套比例同一光照并排对比']));

  const runBtn = button('开始评估(A/B 并行计算)', () => run(), 'primary');
  const out = el('div');
  wrap.append(
    el('p', { class: 'hint' }, [
      `光源:${lightName()};采样网格 ${state.score.grid};转台 ${state.score.rotationSteps} 步。分档口径:` +
      GRADE_BANDS.map(b => `${b.label} ≥ ${b.min}`).join(','),
    ]),
    runBtn, out,
  );

  function run(): void {
    out.innerHTML = '<p>计算中…</p>';
    setTimeout(() => {
      const mA = modelOf(state.schemeA);
      const mB = modelOf(state.schemeB);
      const sA = fullScore(mA, state.score);
      const sB = fullScore(mB, state.score);
      const asetA = computeAset(mA, { ...defaultAsetSettings(), ...state.aset });
      const asetB = computeAset(mB, { ...defaultAsetSettings(), ...state.aset });
      out.innerHTML = '';
      out.append(compareView(sA, sB, asetA, asetB));
    }, 30);
  }

  function compareView(sA: ScoreBreakdown, sB: ScoreBreakdown, asetA: AsetMap, asetB: AsetMap): HTMLElement {
    const box = el('div');
    // 得分表
    const t = el('table', { class: 'grid scores' });
    t.append(el('tr', {}, ['指标', '方案 A', '方案 B', 'A−B'].map(h => el('th', {}, [h]))));
    const mkRow = (label: string, va: number, vb: number, ga: string, gb: string) => {
      const d = va - vb;
      const tr = el('tr', {}, [
        el('td', {}, [label]),
        el('td', {}, [`${(va * 100).toFixed(1)} (${ga})`]),
        el('td', {}, [`${(vb * 100).toFixed(1)} (${gb})`]),
        el('td', { class: Math.abs(d) > 0.03 ? (d > 0 ? 'better' : 'worse') : '' },
          [(d >= 0 ? '+' : '') + (d * 100).toFixed(1)]),
      ]);
      t.append(tr);
    };
    mkRow('亮度', sA.brightness, sB.brightness, sA.brightnessGrade, sB.brightnessGrade);
    mkRow('火彩', sA.fire, sB.fire, sA.fireGrade, sB.fireGrade);
    mkRow('闪烁', sA.scintillation, sB.scintillation, sA.scintillationGrade, sB.scintillationGrade);
    t.append(el('tr', { class: 'overall' }, [
      el('td', {}, ['综合']),
      el('td', {}, [`${sA.overallScore} (${sA.overall})`]),
      el('td', {}, [`${sB.overallScore} (${sB.overall})`]),
      el('td', {}, [`${sA.overallScore - sB.overallScore >= 0 ? '+' : ''}${sA.overallScore - sB.overallScore}`]),
    ]));
    box.append(t);

    // ASET 并排 + 差异高亮
    const cA = el('canvas', { class: 'scope' });
    const cB = el('canvas', { class: 'scope' });
    const cD = el('canvas', { class: 'scope' });
    drawAset(asetA, cA);
    drawAset(asetB, cB);
    drawDiff(asetA, asetB, cD);
    box.append(el('div', { class: 'scopes' }, [
      el('figure', {}, [cA, el('figcaption', {}, ['ASET · 方案 A'])]),
      el('figure', {}, [cB, el('figcaption', {}, ['ASET · 方案 B'])]),
      el('figure', {}, [cD, el('figcaption', {}, ['差异高亮(黄=仅A,品红=仅B)'])]),
    ]));

    box.append(button('生成客户确认报告', () => openReport(sA, sB, asetA, asetB), 'primary'));
    return box;
  }

  root.append(wrap);
}

function lightName(): string {
  return { daylight: '散射日光', spot: '柜台射灯', point: '单点光源' }[state.light.kind];
}

/** A/B ASET 差异高亮:红=A 漏 B 不漏,品红=B 漏 A 不漏,黄=其他分区差异 */
function drawDiff(a: AsetMap, b: AsetMap, canvas: HTMLCanvasElement): void {
  const n = Math.min(a.size, b.size);
  canvas.width = n; canvas.height = n;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const za = a.zones[i], zb = b.zones[i];
    let r = 26, g = 28, bl = 34; // 一致:深灰
    if (za === 'none' && zb === 'none') { r = 138; g = 143; bl = 152; }
    else if (za !== zb) {
      if (za === 'leak') { r = 230; g = 40; bl = 40; }
      else if (zb === 'leak') { r = 200; g = 40; bl = 200; }
      else { r = 240; g = 210; bl = 40; }
    }
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = bl; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
