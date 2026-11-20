/** 参数报告导出(Markdown) */
import { Design } from './state/store';
import { AnalysisResult } from './analysis/analyze';
import { ENV_NAMES, EnvType } from './render/env';
import { diamondIOR, WAVELENGTHS_NM, criticalAngleDeg } from './physics/optics';

export function buildReport(d: Design, analysis: AnalysisResult | null, envType: EnvType): string {
  const p = d.params;
  const lines: string[] = [
    `# 切工参数报告:${d.name}`,
    '',
    `生成时间:${new Date().toLocaleString('zh-CN')}`,
    '',
    '## 切工参数',
    '',
    '| 参数 | 值 |',
    '| --- | --- |',
    `| 切工形状 | ${p.shape} |`,
    `| 台面比 | ${p.tablePct.toFixed(1)} % |`,
    `| 冠角 | ${p.crownAngleDeg.toFixed(1)} ° |`,
    `| 亭角 | ${p.pavilionAngleDeg.toFixed(1)} ° |`,
    `| 腰棱厚度 | ${p.girdlePct.toFixed(1)} % |`,
    `| 星刻面比 | ${p.starPct.toFixed(0)} % |`,
    `| 下腰刻面比 | ${p.lowerGirdlePct.toFixed(0)} % |`,
    `| 底尖比 | ${p.culetPct.toFixed(1)} % |`,
  ];
  if (p.shape === 'princess') {
    lines.push(`| 人字刻面层数 | ${p.chevronTiers} |`, `| 层间递减角 | ${p.chevronStepDeg.toFixed(1)} ° |`);
  }
  if (p.shape === 'oval') {
    lines.push(`| 长宽比 | ${p.ovalRatio.toFixed(2)} |`);
  }
  lines.push(
    '',
    '## 材料光学常数(钻石,柯西色散公式)',
    '',
    `| 波长 | 折射率 |`,
    `| --- | --- |`,
    ...WAVELENGTHS_NM.map((w) => `| ${w} nm | ${diamondIOR(w).toFixed(4)} |`),
    `| 临界角(钠黄光) | ${criticalAngleDeg(diamondIOR(589.3)).toFixed(2)} ° |`,
  );
  if (analysis) {
    lines.push(
      '',
      `## 光学分析(环境:${ENV_NAMES[envType]})`,
      '',
      '| 指标 | 得分 |',
      '| --- | --- |',
      `| 亮度 | ${analysis.brightness.toFixed(1)} / 100 |`,
      `| 火彩 | ${analysis.fire.toFixed(1)} / 100 |`,
      `| 闪烁 | ${analysis.scintillation.toFixed(1)} / 100 |`,
      `| 漏光率 | ${analysis.leakagePct.toFixed(1)} % |`,
    );
  }
  lines.push('', '---', '*由钻石切工设计系统生成(物理:斯涅尔折射 + 全内反射 + 柯西色散,菲涅尔精确解)*');
  return lines.join('\n');
}

export function downloadText(filename: string, text: string, mime = 'text/markdown') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  downloadBlob(filename, blob);
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
