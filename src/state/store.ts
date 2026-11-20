/** 款式库:localStorage 持久化 + 导入导出 + 订阅 */
import { CutParams, CutShape, DEFAULT_PARAMS } from '../geometry/types';

export interface Design {
  id: string;
  name: string;
  params: CutParams;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  /** 渲染分辨率比例 0.5~1 */
  renderScale: number;
  /** 自适应分辨率(帧率不足时自动降) */
  adaptiveScale: boolean;
  /** 最大内反射次数 */
  maxBounces: number;
  /** 光谱采样数 1=无火彩(快) 3=RGB三波长 */
  spectralSamples: 1 | 3;
  /** 自动转台速度(度/秒,0=关) */
  autoRotateDegPerSec: number;
  envType: 0 | 1 | 2;
}

const DESIGN_KEY = 'diamond-cut-studio/designs/v1';
const SETTINGS_KEY = 'diamond-cut-studio/settings/v1';

export const DEFAULT_SETTINGS: AppSettings = {
  renderScale: 0.75,
  adaptiveScale: true,
  maxBounces: 10,
  spectralSamples: 3,
  autoRotateDegPerSec: 0,
  envType: 0,
};

function uid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const SHAPE_NAME: Record<CutShape, string> = { round: '圆形明亮式', princess: '公主方', oval: '椭圆' };
export function shapeName(s: CutShape): string {
  return SHAPE_NAME[s];
}

export class DesignStore {
  private designs: Design[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(DESIGN_KEY);
      this.designs = raw ? (JSON.parse(raw) as Design[]) : [];
    } catch {
      this.designs = [];
    }
    if (this.designs.length === 0) {
      // 首次使用:内置三个示例
      const now = Date.now();
      this.designs = (['round', 'princess', 'oval'] as CutShape[]).map((s, i) => ({
        id: uid(),
        name: `${SHAPE_NAME[s]}示例`,
        params: { ...DEFAULT_PARAMS[s] },
        createdAt: now - i,
        updatedAt: now - i,
      }));
      this.save();
    }
  }

  private save() {
    localStorage.setItem(DESIGN_KEY, JSON.stringify(this.designs));
    this.listeners.forEach((f) => f());
  }

  subscribe(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  list(): Design[] {
    return [...this.designs].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Design | undefined {
    return this.designs.find((d) => d.id === id);
  }

  create(shape: CutShape, name?: string): Design {
    const d: Design = {
      id: uid(),
      name: name ?? `${SHAPE_NAME[shape]} ${this.designs.length + 1}`,
      params: { ...DEFAULT_PARAMS[shape] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.designs.push(d);
    this.save();
    return d;
  }

  duplicate(id: string): Design | undefined {
    const src = this.get(id);
    if (!src) return undefined;
    const d: Design = {
      ...src,
      id: uid(),
      name: `${src.name} 副本`,
      params: { ...src.params },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.designs.push(d);
    this.save();
    return d;
  }

  update(id: string, patch: Partial<Pick<Design, 'name' | 'params'>>) {
    const d = this.get(id);
    if (!d) return;
    if (patch.name !== undefined) d.name = patch.name;
    if (patch.params !== undefined) d.params = { ...patch.params };
    d.updatedAt = Date.now();
    this.save();
  }

  remove(id: string) {
    this.designs = this.designs.filter((d) => d.id !== id);
    this.save();
  }

  exportJSON(ids?: string[]): string {
    const set = ids ? new Set(ids) : null;
    return JSON.stringify(
      { app: 'diamond-cut-studio', version: 1, designs: this.designs.filter((d) => !set || set.has(d.id)) },
      null,
      2,
    );
  }

  /** 导入 JSON,返回导入数量;格式错误抛异常 */
  importJSON(text: string): number {
    const data = JSON.parse(text);
    const arr: Design[] = Array.isArray(data) ? data : data.designs;
    if (!Array.isArray(arr)) throw new Error('无法识别的文件格式');
    let n = 0;
    for (const d of arr) {
      if (!d || !d.params || !DEFAULT_PARAMS[d.params.shape as CutShape]) continue;
      this.designs.push({
        id: uid(),
        name: String(d.name ?? '导入款式'),
        params: { ...DEFAULT_PARAMS[d.params.shape as CutShape], ...d.params },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      n++;
    }
    if (n > 0) this.save();
    return n;
  }
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* 忽略损坏数据 */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export const store = new DesignStore();
