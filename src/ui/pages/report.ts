/** 客户确认报告:比例 + 光学评估 + ASET 图 + 八心八箭图,可打印 */
import { el, button } from '../dom';
import { state, modelOf } from '../store';
import { ScoreBreakdown } from '../../optics/scoring';
import { AsetMap, drawAset, defaultAsetSettings, computeAset } from '../../optics/aset';
import { analyzeHeartsArrows, drawHA } from '../../optics/heartsArrows';
import { ProportionParams } from '../../geometry/gem';

export function openReport(sA: ScoreBreakdown, sB: ScoreBreakdown, asetA: AsetMap, asetB: AsetMap): void {
  const overlay = el('div', { class: 'report-overlay' });
  const doc = el('div', { class: 'report' });

  const today = new Date().toLocaleDateString('zh-CN');
  doc.append(el('h1', {}, ['钻石切工比例与光学评估报告']));
  doc.append(el('p', { class: 'report-meta' }, [`日期:${today} · 评估对象:方案 A / 方案 B · 光源:${lightName()}`]));

  doc.append(schemeSection('方案 A', state.schemeA.params, sA, asetA));
  doc.append(schemeSection('方案 B', state.schemeB.params, sB, asetB));

  // 结论
  const better = sA.overallScore >= sB.overallScore ? 'A' : 'B';
  doc.append(el('div', { class: 'report-conclusion' }, [
    el('h2', {}, ['评估结论']),
    el('p', {}, [
      `综合光学表现方案 ${better} 更优(A:${sA.overallScore} 分 ${sA.overall},B:${sB.overallScore} 分 ${sB.overall})。`,
      `方案 A 漏光率 ${(asetA.stats.leak * 100).toFixed(1)}%,方案 B 漏光率 ${(asetB.stats.leak * 100).toFixed(1)}%。`,
    ]),
    el('p', { class: 'hint' }, ['本报告由参数化光学模拟生成,供下盘前比例确认;实物效果以成品上镜为准。']),
  ]));

  // 客户确认栏
  doc.append(el('div', { class: 'sign' }, [
    el('div', {}, ['客户确认签字:____________']),
    el('div', {}, ['日期:____________']),
  ]));

  const bar = el('div', { class: 'report-bar' }, [
    button('打印 / 另存 PDF', () => window.print(), 'primary'),
    button('关闭', () => overlay.remove()),
  ]);
  overlay.append(doc, bar);
  document.body.append(overlay);
}

function lightName(): string {
  return { daylight: '散射日光', spot: '柜台射灯', point: '单点光源' }[state.light.kind];
}

function schemeSection(title: string, p: ProportionParams, s: ScoreBreakdown, aset: AsetMap): HTMLElement {
  const sec = el('section', { class: 'report-scheme' });
  sec.append(el('h2', {}, [title]));

  // 比例表
  const pt = el('table', { class: 'grid' });
  const rows: [string, string][] = [
    ['琢型', { round: '圆形明亮式', princess: '公主方', oval: '椭圆' }[p.shape]],
    ['台面比', p.tablePct.toFixed(1) + ' %'],
    ['冠角', p.crownAngle.toFixed(2) + ' °'],
    ['亭角', p.pavilionAngle.toFixed(2) + ' °'],
    ['腰厚', p.girdlePct.toFixed(1) + ' %'],
    ['底尖', p.culetPct.toFixed(1) + ' %'],
  ];
  if (p.shape === 'oval') rows.push(['长宽比', p.ratio.toFixed(2)]);
  for (const [k, v] of rows) pt.append(el('tr', {}, [el('th', {}, [k]), el('td', {}, [v])]));

  // 评分表
  const st = el('table', { class: 'grid' });
  st.append(el('tr', {}, ['指标', '得分', '分档'].map(h => el('th', {}, [h]))));
  const sr = (label: string, v: number, g: string) =>
    st.append(el('tr', {}, [el('td', {}, [label]), el('td', {}, [(v * 100).toFixed(1)]), el('td', {}, [g])]));
  sr('亮度', s.brightness, s.brightnessGrade);
  sr('火彩', s.fire, s.fireGrade);
  sr('闪烁', s.scintillation, s.scintillationGrade);
  st.append(el('tr', { class: 'overall' }, [el('td', {}, ['综合']), el('td', {}, [String(s.overallScore)]), el('td', {}, [s.overall])]));

  // 图:ASET + 八心八箭
  const scheme = title.endsWith('A') ? state.schemeA : state.schemeB;
  const m = modelOf(scheme);
  const asetCanvas = el('canvas', { class: 'scope' });
  drawAset(computeAset(m, { ...defaultAsetSettings(), ...state.aset }), asetCanvas);
  const ha = analyzeHeartsArrows(m, 160);
  const arrowsC = el('canvas', { class: 'scope' });
  const heartsC = el('canvas', { class: 'scope' });
  drawHA(ha.arrows, arrowsC);
  drawHA(ha.hearts, heartsC);

  sec.append(
    el('div', { class: 'report-cols' }, [
      el('div', {}, [el('h3', {}, ['比例参数']), pt]),
      el('div', {}, [el('h3', {}, ['光学评分']), st]),
    ]),
    el('div', { class: 'scopes' }, [
      el('figure', {}, [asetCanvas, el('figcaption', {}, [`ASET(漏光 ${(aset.stats.leak * 100).toFixed(1)}%)`])]),
      el('figure', {}, [arrowsC, el('figcaption', {}, ['八箭'])]),
      el('figure', {}, [heartsC, el('figcaption', {}, [`八心(对称度 ${ha.symmetryScore.toFixed(0)})`])]),
    ]),
  );
  return sec;
}
