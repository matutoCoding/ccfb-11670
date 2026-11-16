import { Design, CUT_LABEL } from './state';
import { AnalysisResult } from './analysis/metrics';
import { Facet, FACET_KIND_LABEL } from './geometry/cuts';

/** 生成自包含的 HTML 参数报告 */
export function buildReport(
  d: Design,
  result: AnalysisResult,
  images: { returnImg: string; leakImg: string; fireImg: string },
  facets: Facet[],
): string {
  const p = d.params;
  const sc = result.scores;
  const paramRows: [string, string][] = [
    ['切工类型', CUT_LABEL[d.cut]],
    ['台面比', `${p.tablePct}%`],
    ['冠角', `${p.crownAngle}°`],
    ['亭角', `${p.pavilionAngle}°`],
    ['腰棱厚度', `${p.girdlePct}%`],
    ['星刻面长度比', `${p.starLengthPct}%`],
    ['下腰刻面长度比', `${p.lowerGirdlePct}%`],
    ...(d.cut === 'oval' ? [['长宽比', String(p.ratio)] as [string, string]] : []),
  ];
  const scoreRow = (label: string, v: number, unit = '') =>
    `<tr><td>${label}</td><td><b>${v.toFixed(1)}</b>${unit}</td></tr>`;

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${d.name} · 光学分析报告</title>
<style>
body{font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;max-width:860px;margin:32px auto;padding:0 20px;color:#222}
h1{font-size:22px;border-bottom:2px solid #d4b06a;padding-bottom:8px}
h2{font-size:16px;margin-top:28px;color:#8a6d2f}
table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:6px 12px;text-align:left}
th{background:#f7f3ea}
.maps{display:flex;gap:12px}
.maps figure{margin:0;flex:1;text-align:center}
.maps img{width:100%;image-rendering:pixelated;border:1px solid #ddd}
figcaption{font-size:12px;color:#666;margin-top:4px}
.meta{color:#888;font-size:12px}
</style></head><body>
<h1>钻石切工光学分析报告</h1>
<p class="meta">款式：${d.name} · 生成时间：${new Date().toLocaleString('zh-CN')} · 物理模型：光谱光线追踪（全内反射 + 柯西色散，470/550/650nm）</p>
<h2>切工参数</h2>
<table>${paramRows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
<h2>光学评分</h2>
<table>
${scoreRow('亮度', sc.brightness, ' / 100')}
${scoreRow('火彩', sc.fire, ' / 100')}
${scoreRow('闪烁', sc.scintillation, ' / 100')}
${scoreRow('出光率', sc.lightReturn, '%')}
${scoreRow('漏光率', sc.leakage, '%')}
</table>
<h2>出光分析图</h2>
<div class="maps">
<figure><img src="${images.returnImg}"><figcaption>出光图（亮=返回观察者）</figcaption></figure>
<figure><img src="${images.leakImg}"><figcaption>漏光图（亮=向下漏光）</figcaption></figure>
<figure><img src="${images.fireImg}"><figcaption>火彩图（亮=色散强）</figcaption></figure>
</div>
<h2>刻面漏光明细（前 10）</h2>
<table><tr><th>刻面</th><th>类型</th><th>光线数</th><th>漏光通量</th></tr>
${result.facetStats
  .map((fs, i) => ({ fs, facet: facets[i] }))
  .filter((x) => x.fs.rays > 0 && x.facet)
  .sort((a, b) => b.fs.leaked - a.fs.leaked)
  .slice(0, 10)
  .map(({ fs, facet }) =>
    `<tr><td>${facet.name}</td><td>${FACET_KIND_LABEL[facet.kind]}</td><td>${fs.rays}</td><td>${fs.leaked.toFixed(3)}</td></tr>`)
  .join('')}
</table>
<p class="meta">由钻石切工设计与火彩预览系统生成</p>
</body></html>`;
}
