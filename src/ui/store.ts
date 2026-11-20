/**
 * 全局状态:两套比例方案(A/B 对比)、缺陷、光源与评分设置。
 */
import { ProportionParams, DefectParams, defaultParams, defaultDefects, buildGem, GemModel } from '../geometry/gem';
import { AsetSettings, defaultAsetSettings } from '../optics/aset';
import { LightSettings, defaultLight } from '../optics/lighting';
import { ScoreSettings } from '../optics/scoring';

export interface Scheme {
  name: string;
  params: ProportionParams;
  defects: DefectParams;
}

export interface AppState {
  schemeA: Scheme;
  schemeB: Scheme;
  aset: AsetSettings;
  light: LightSettings;
  score: ScoreSettings;
}

export const state: AppState = {
  schemeA: { name: '方案 A', params: defaultParams(), defects: defaultDefects() },
  schemeB: { name: '方案 B', params: { ...defaultParams(), pavilionAngle: 41.2, tablePct: 60 }, defects: defaultDefects() },
  aset: defaultAsetSettings(),
  light: defaultLight(),
  score: { grid: 48, rotationSteps: 12, light: defaultLight() },
};
state.score.light = state.light;

const modelCache = new WeakMap<Scheme, GemModel>();
export function modelOf(s: Scheme): GemModel {
  let m = modelCache.get(s);
  if (!m) { m = buildGem(s.params, s.defects); modelCache.set(s, m); }
  return m;
}
export function invalidate(s: Scheme): void { modelCache.delete(s); }

/** 预设模板 */
export const PRESETS: { name: string; patch: Partial<ProportionParams> }[] = [
  { name: 'Tolkowsky 理想切工', patch: { tablePct: 53, crownAngle: 34.5, pavilionAngle: 40.75, girdlePct: 2, culetPct: 0 } },
  { name: 'AGS 0 级参考', patch: { tablePct: 56, crownAngle: 34.7, pavilionAngle: 40.8, girdlePct: 2.2, culetPct: 0 } },
  { name: '深亭(漏光示例)', patch: { tablePct: 60, crownAngle: 33, pavilionAngle: 41.8, girdlePct: 2.5, culetPct: 0 } },
  { name: '浅亭(鱼眼示例)', patch: { tablePct: 62, crownAngle: 30, pavilionAngle: 39.4, girdlePct: 2, culetPct: 0 } },
];

const LS_KEY = 'diamond-optics-schemes';
export function saveSchemes(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ A: state.schemeA, B: state.schemeB }));
  } catch { /* 隐私模式下忽略 */ }
}
export function loadSchemes(): void {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.A) state.schemeA = d.A;
    if (d.B) state.schemeB = d.B;
  } catch { /* 忽略损坏数据 */ }
}
