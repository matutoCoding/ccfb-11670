/** UI 公共工具 */
import { CameraState } from '../render/renderer';

/** 快捷 DOM 构建 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}

export function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  unit: string,
  onInput: (v: number) => void,
): HTMLElement {
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
  input.value = String(value);
  const out = h('output', {}, `${value.toFixed(step < 1 ? 1 : 0)}${unit}`);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    out.textContent = `${v.toFixed(step < 1 ? 1 : 0)}${unit}`;
    onInput(v);
  });
  return h('div', { class: 'slider-row' }, h('label', {}, label), input, out);
}

/** 轨道相机控制:拖拽旋转 + 滚轮缩放,返回清理函数 */
export function attachOrbit(canvas: HTMLCanvasElement, cam: CameraState, onChange: () => void): () => void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const down = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    cam.yawDeg += (e.clientX - lastX) * 0.4;
    cam.pitchDeg = Math.max(-80, Math.min(80, cam.pitchDeg + (e.clientY - lastY) * 0.3));
    lastX = e.clientX;
    lastY = e.clientY;
    onChange();
  };
  const up = () => { dragging = false; };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    cam.dist = Math.max(1.5, Math.min(12, cam.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    onChange();
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('wheel', wheel);
  };
}

export function designSelect(
  designs: { id: string; name: string }[],
  selectedId: string | null,
  onChange: (id: string) => void,
): HTMLSelectElement {
  const sel = h('select') as HTMLSelectElement;
  for (const d of designs) {
    const opt = h('option', { value: d.id }, d.name) as HTMLOptionElement;
    sel.append(opt);
  }
  if (selectedId) sel.value = selectedId;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

export function defaultCamera(): CameraState {
  return { yawDeg: 25, pitchDeg: 35, dist: 4.2, fovDeg: 30, target: [0, -0.25, 0] };
}

/** WebGPU 不可用时的提示块 */
export function webgpuMissing(): HTMLElement {
  const box = h('div', { class: 'error-box' });
  box.innerHTML = '<b>当前浏览器/环境不支持 WebGPU,此页面不可用。</b><br/>请使用 Chrome / Edge 113+ 并确认已启用硬件加速(可访问 chrome://gpu 检查)。';
  return box;
}
