import { CutParams, CutType, DEFAULT_PARAMS } from './geometry/cuts';

export interface Design {
  id: string;
  name: string;
  cut: CutType;
  params: CutParams;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  cauchyA: number;
  cauchyB: number;
  numWavelengths: 1 | 3 | 5;
  maxBounces: number;
  resolutionScale: number;
  autoResolution: boolean;
  envIntensity: number;
  exposure: number;
  turntableSpeed: number; // 度/秒
  showFps: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  cauchyA: 2.3798,
  cauchyB: 0.01315,
  numWavelengths: 3,
  maxBounces: 8,
  resolutionScale: 0.75,
  autoResolution: true,
  envIntensity: 1.0,
  exposure: 1.4,
  turntableSpeed: 30,
  showFps: true,
};

const LS_DESIGNS = 'diamond-studio:designs';
const LS_SETTINGS = 'diamond-studio:settings';

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const CUT_LABEL: Record<CutType, string> = {
  round: '圆形明亮式', princess: '公主方', oval: '椭圆形',
};

class Store {
  designs: Design[] = [];
  settings: Settings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<() => void>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(LS_DESIGNS);
      if (raw) this.designs = JSON.parse(raw);
    } catch { this.designs = []; }
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      if (raw) this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch { /* 用默认 */ }
    if (this.designs.length === 0) {
      // 预置三个示例款式
      const now = Date.now();
      this.designs = [
        { id: uid(), name: '经典圆钻 (Tolkowsky)', cut: 'round', params: { ...DEFAULT_PARAMS }, createdAt: now, updatedAt: now },
        { id: uid(), name: '公主方 1.0', cut: 'princess', params: { ...DEFAULT_PARAMS, tablePct: 68, crownAngle: 32, pavilionAngle: 41 }, createdAt: now, updatedAt: now },
        { id: uid(), name: '椭圆 1.35', cut: 'oval', params: { ...DEFAULT_PARAMS }, createdAt: now, updatedAt: now },
      ];
      this.saveDesigns();
    }
  }

  private saveDesigns(): void {
    localStorage.setItem(LS_DESIGNS, JSON.stringify(this.designs));
  }

  saveSettings(): void {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(this.settings));
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get(id: string): Design | undefined {
    return this.designs.find((d) => d.id === id);
  }

  create(cut: CutType, name?: string): Design {
    const now = Date.now();
    const d: Design = {
      id: uid(),
      name: name ?? `${CUT_LABEL[cut]} ${this.designs.length + 1}`,
      cut,
      params: { ...DEFAULT_PARAMS },
      createdAt: now,
      updatedAt: now,
    };
    this.designs.push(d);
    this.saveDesigns();
    this.emit();
    return d;
  }

  duplicate(id: string): Design | undefined {
    const src = this.get(id);
    if (!src) return undefined;
    const now = Date.now();
    const d: Design = {
      id: uid(),
      name: `${src.name} 副本`,
      cut: src.cut,
      params: { ...src.params },
      createdAt: now,
      updatedAt: now,
    };
    this.designs.push(d);
    this.saveDesigns();
    this.emit();
    return d;
  }

  remove(id: string): void {
    this.designs = this.designs.filter((d) => d.id !== id);
    this.saveDesigns();
    this.emit();
  }

  rename(id: string, name: string): void {
    const d = this.get(id);
    if (!d) return;
    d.name = name;
    d.updatedAt = Date.now();
    this.saveDesigns();
    this.emit();
  }

  updateParams(id: string, params: Partial<CutParams>): void {
    const d = this.get(id);
    if (!d) return;
    Object.assign(d.params, params);
    d.updatedAt = Date.now();
    this.saveDesigns();
    this.emit();
  }

  updateCut(id: string, cut: CutType): void {
    const d = this.get(id);
    if (!d) return;
    d.cut = cut;
    d.updatedAt = Date.now();
    this.saveDesigns();
    this.emit();
  }

  /** 导出全部款式为 JSON 字符串 */
  exportAll(): string {
    return JSON.stringify({ app: 'diamond-cut-studio', version: 1, designs: this.designs }, null, 2);
  }

  /** 导入 JSON（合并，id 冲突时换新 id），返回导入数量 */
  importJson(text: string): number {
    const data = JSON.parse(text);
    const list: Design[] = Array.isArray(data) ? data : data.designs;
    if (!Array.isArray(list)) throw new Error('文件格式不正确');
    let count = 0;
    for (const item of list) {
      if (!item || typeof item.name !== 'string' || !item.params) continue;
      if (!['round', 'princess', 'oval'].includes(item.cut)) continue;
      const now = Date.now();
      const d: Design = {
        id: this.get(item.id) ? uid() : (item.id ?? uid()),
        name: item.name,
        cut: item.cut,
        params: { ...DEFAULT_PARAMS, ...item.params },
        createdAt: item.createdAt ?? now,
        updatedAt: now,
      };
      this.designs.push(d);
      count++;
    }
    this.saveDesigns();
    this.emit();
    return count;
  }
}

export const store = new Store();

/** 触发浏览器下载 */
export function downloadFile(filename: string, content: string | Blob, mime = 'application/octet-stream'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
