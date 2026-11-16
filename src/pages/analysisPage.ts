import { el, button, selectRow, scoreBar, drawMap, grayScale, hotScale, fireScale } from '../ui/dom';
import { store, downloadFile } from '../state';
import { buildCut, FACET_KIND_LABEL } from '../geometry/cuts';
import { runAnalysis, AnalysisResult } from '../analysis/metrics';
import { toast } from './library';
import { buildReport } from '../report';

/** 光学分析页面：出光图 / 漏光图 / 火彩图 + 三项评分 + 刻面漏光表 */
export function renderAnalysis(root: HTMLElement, designId?: string): void {
  const designs = store.designs;
  if (designs.length === 0) {
    root.append(el('div', { className: 'page' }, el('div', { className: 'card' }, '请先在款式库中创建款式。')));
    return;
  }
  let currentId = designId && store.get(designId) ? designId : designs[0].id;
  let result: AnalysisResult | null = null;
  let running = false;
  let cancelFlag = false;

  const retCanvas = el('canvas') as HTMLCanvasElement;
  const leakCanvas = el('canvas') as HTMLCanvasElement;
  const fireCanvas = el('canvas') as HTMLCanvasElement;
  const progressBar = el('div', {});
  const progressWrap = el('div', { className: 'progress', style: 'display:none' }, progressBar);
  const scoresCard = el('div', { className: 'card' });
  const facetCard = el('div', { className: 'card' });
  const runBtn = button('运行光学分析', () => { void run(); }, 'btn primary');
  const cancelBtn = button('取消', () => { cancelFlag = true; }, 'btn');
  cancelBtn.style.display = 'none';
  const reportBtn = button('导出参数报告', () => exportReport(), 'btn');
  reportBtn.disabled = true;

  const designSel = selectRow('分析款式', designs.map((d) => [d.id, d.name] as [string, string]), currentId,
    (v) => { currentId = v; });

  root.append(el('div', { className: 'page' },
    el('h2', {}, '光学分析'),
    el('div', { className: 'toolbar' },
      designSel, runBtn, cancelBtn, reportBtn,
      el('span', { className: 'muted' }, '从正上方正交投影光谱光线束，逐像素追踪出光与漏光'),
    ),
    progressWrap,
    el('div', { className: 'analysis-grid' },
      el('div', { className: 'map-card' }, el('h3', {}, '出光图（返回观察者的光）'), retCanvas),
      el('div', { className: 'map-card' }, el('h3', {}, '漏光图（向下逃逸的光）'), leakCanvas),
      el('div', { className: 'map-card' }, el('h3', {}, '火彩图（色散角强度）'), fireCanvas),
    ),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start' },
      scoresCard, facetCard),
  ));

  const run = async () => {
    const d = store.get(currentId);
    if (!d || running) return;
    running = true;
    cancelFlag = false;
    runBtn.disabled = true;
    cancelBtn.style.display = '';
    progressWrap.style.display = '';
    reportBtn.disabled = true;
    try {
      const geo = buildCut(d.cut, d.params);
      const s = store.settings;
      result = await runAnalysis(geo, {
        size: 160,
        cauchyA: s.cauchyA,
        cauchyB: s.cauchyB,
        maxBounces: s.maxBounces,
        scintillationSteps: 8,
        onProgress: (f) => {
          progressBar.style.width = `${(f * 100).toFixed(0)}%`;
          return !cancelFlag;
        },
      });
      showResult();
      reportBtn.disabled = false;
      toast('分析完成');
    } catch (e) {
      if ((e as Error).message !== 'cancelled') {
        toast(`分析失败：${(e as Error).message}`);
      } else {
        toast('已取消');
      }
    } finally {
      running = false;
      runBtn.disabled = false;
      cancelBtn.style.display = 'none';
      progressWrap.style.display = 'none';
      progressBar.style.width = '0%';
    }
  };

  const showResult = () => {
    if (!result) return;
    drawMap(retCanvas, result.returnMap, result.hitMask, result.size, grayScale);
    drawMap(leakCanvas, result.leakMap, result.hitMask, result.size, hotScale);
    drawMap(fireCanvas, result.fireMap, result.hitMask, result.size, fireScale);

    const sc = result.scores;
    scoresCard.replaceChildren(
      el('h3', {}, '光学评分'),
      scoreBar('亮度', sc.brightness),
      scoreBar('火彩', sc.fire),
      scoreBar('闪烁', sc.scintillation),
      el('div', { className: 'muted', style: 'margin-top:10px' },
        `出光率 ${sc.lightReturn.toFixed(1)}% · 漏光率 ${sc.leakage.toFixed(1)}%`),
      el('div', { className: 'muted', style: 'margin-top:6px;font-size:11px' },
        '评分基于光谱光线追踪（470/550/650nm 独立路径），闪烁为 8 方位出光变异系数'),
    );

    // 刻面漏光排行
    const d = store.get(currentId)!;
    const geo = buildCut(d.cut, d.params);
    const rows = result.facetStats
      .map((fs, i) => ({ facet: geo.facets[i], ...fs, leakPct: fs.rays > 0 ? fs.leaked / (fs.returned + fs.leaked || 1) : 0 }))
      .filter((r) => r.rays > 0)
      .sort((a, b) => b.leaked - a.leaked)
      .slice(0, 12);
    const table = el('table', { className: 'list' });
    table.append(el('tr', {}, el('th', {}, '刻面'), el('th', {}, '类型'), el('th', {}, '光线数'), el('th', {}, '漏光通量'), el('th', {}, '漏光占比')));
    for (const r of rows) {
      table.append(el('tr', {},
        el('td', {}, r.facet.name),
        el('td', { className: 'muted' }, FACET_KIND_LABEL[r.facet.kind]),
        el('td', {}, String(r.rays)),
        el('td', {}, r.leaked.toFixed(3)),
        el('td', { style: r.leakPct > 0.5 ? 'color:var(--danger)' : '' }, `${(r.leakPct * 100).toFixed(0)}%`),
      ));
    }
    facetCard.replaceChildren(
      el('h3', {}, '刻面漏光排行（前 12）'),
      rows.length ? table : el('div', { className: 'muted' }, '无数据'),
    );
  };

  const exportReport = () => {
    const d = store.get(currentId);
    if (!d || !result) return;
    const geo = buildCut(d.cut, d.params);
    const html = buildReport(d, result, {
      returnImg: retCanvas.toDataURL('image/png'),
      leakImg: leakCanvas.toDataURL('image/png'),
      fireImg: fireCanvas.toDataURL('image/png'),
    }, geo.facets);
    downloadFile(`${d.name}-光学分析报告.html`, html, 'text/html');
    toast('报告已导出');
  };
}
