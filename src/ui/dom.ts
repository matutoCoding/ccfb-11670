/** 轻量 DOM 构造工具 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

export interface NumFieldOpts {
  label: string;
  value: number;
  min: number; max: number; step: number;
  unit?: string;
  onChange: (v: number) => void;
}

/** 数字输入 + 滑杆联动 */
export function numField(o: NumFieldOpts): HTMLElement {
  const input = el('input', { type: 'number', min: String(o.min), max: String(o.max), step: String(o.step) }) ;
  input.value = String(o.value);
  const range = el('input', { type: 'range', min: String(o.min), max: String(o.max), step: String(o.step) });
  range.value = String(o.value);
  const unit = o.unit ? el('span', { class: 'unit' }, [o.unit]) : '';
  const sync = (v: number, fire: boolean) => {
    if (Number.isFinite(v)) {
      input.value = String(Math.round(v * 1000) / 1000);
      range.value = String(v);
      if (fire) o.onChange(v);
    }
  };
  input.onchange = () => sync(parseFloat(input.value), true);
  range.oninput = () => sync(parseFloat(range.value), true);
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label' }, [o.label]),
    el('div', { class: 'field-ctrl' }, [range, input, unit].filter(Boolean) as HTMLElement[]),
  ]);
}

export function selectField<T extends string>(
  label: string, options: { value: T; text: string }[], value: T, onChange: (v: T) => void,
): HTMLElement {
  const sel = el('select');
  for (const o of options) {
    const opt = el('option', { value: o.value }, [o.text]);
    if (o.value === value) opt.selected = true;
    sel.append(opt);
  }
  sel.onchange = () => onChange(sel.value as T);
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label' }, [label]), sel,
  ]);
}

export function button(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { class: cls }, [text]);
  b.onclick = onClick;
  return b;
}
