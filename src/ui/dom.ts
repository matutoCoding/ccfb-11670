/** 轻量 DOM 构建工具 */

type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'className') {
      node.className = String(v);
    } else if (k === 'value') {
      (node as HTMLInputElement).value = String(v);
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(c);
  }
  return node;
}

export function slider(
  label: string, min: number, max: number, step: number, value: number,
  unit: string, oninput: (v: number) => void,
): HTMLElement {
  const valueEl = el('span', { className: 'slider-value' }, `${value}${unit}`);
  const input = el('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      valueEl.textContent = `${v}${unit}`;
      oninput(v);
    },
  });
  return el('div', { className: 'slider-row' },
    el('label', {}, label), input, valueEl);
}

export function selectRow(
  label: string, options: [string, string][], value: string,
  onchange: (v: string) => void,
): HTMLElement {
  const sel = el('select', {
    onchange: (e) => onchange((e.target as HTMLSelectElement).value),
  });
  for (const [v, text] of options) {
    const opt = el('option', { value: v }, text);
    if (v === value) opt.selected = true;
    sel.append(opt);
  }
  return el('div', { className: 'select-row' }, el('label', {}, label), sel);
}

export function button(label: string, onclick: () => void, className = 'btn'): HTMLButtonElement {
  return el('button', { className, onclick }, label);
}

export function scoreBar(label: string, score: number, hint = ''): HTMLElement {
  const pct = Math.max(0, Math.min(100, score));
  return el('div', { className: 'score-row' },
    el('span', { className: 'score-label' }, label),
    el('div', { className: 'score-track' },
      el('div', { className: 'score-fill', style: `width:${pct}%` })),
    el('span', { className: 'score-num' }, `${score.toFixed(0)}${hint}`),
  );
}

/** 把 Float32Array 图画到 canvas（支持伪彩） */
export function drawMap(
  canvas: HTMLCanvasElement, data: Float32Array, mask: Uint8Array, size: number,
  colorize: (v: number) => [number, number, number],
): void {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const [r, g, b] = mask[i] ? colorize(data[i]) : [12, 12, 16];
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** 灰度（出光图） */
export const grayScale = (v: number): [number, number, number] => {
  const c = Math.round(Math.min(1, v) * 255);
  return [c, c, c];
};

/** 热图（漏光：黑→红→黄） */
export const hotScale = (v: number): [number, number, number] => {
  const t = Math.min(1, v * 2);
  return [Math.round(255 * Math.min(1, t * 2)), Math.round(255 * Math.max(0, t * 2 - 1)), 40];
};

/** 火彩：黑→蓝→品红→白 */
export const fireScale = (v: number): [number, number, number] => {
  const t = Math.min(1, v / 2.5);
  return [
    Math.round(255 * Math.min(1, t * 1.6)),
    Math.round(255 * Math.max(0, t - 0.4) * 1.4),
    Math.round(255 * Math.min(1, 0.3 + t)),
  ];
};
