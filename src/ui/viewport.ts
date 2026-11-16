import { DiamondRenderer, RenderParams, DEFAULT_RENDER_PARAMS } from '../gpu/renderer';
import { GemGeometry } from '../geometry/cuts';

/**
 * 视口控制器：管理一个渲染画布 + 相机交互（拖拽旋转、滚轮缩放）+ 渲染循环。
 */
export class Viewport {
  renderer: DiamondRenderer;
  canvas: HTMLCanvasElement;
  params: RenderParams;
  autoRotate = false;
  turntableSpeedDeg = 30; // 度/秒
  onFrame: ((fps: number) => void) | null = null;
  /** 自适应分辨率回调：返回应使用的分辨率比例 */
  getResolutionScale: (() => number) | null = null;

  private raf = 0;
  private last = 0;
  private frameTimes: number[] = [];
  private fps = 0;
  private disposed = false;
  private needsRender = true;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    container.append(this.canvas);
    this.renderer = new DiamondRenderer(this.canvas);
    this.params = {
      azimuth: 0.6,
      elevation: 0.45,
      ...DEFAULT_RENDER_PARAMS,
    };
    this.bindPointer();
    // 尺寸变化时重绘
    new ResizeObserver(() => { this.needsRender = true; }).observe(container);
  }

  async init(geo: GemGeometry): Promise<void> {
    await this.renderer.init();
    await this.renderer.setGeometry(geo.planes);
  }

  async setGeometry(geo: GemGeometry): Promise<void> {
    await this.renderer.setGeometry(geo.planes);
    this.needsRender = true;
  }

  private bindPointer(): void {
    let dragging = false;
    let lastX = 0, lastY = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX; lastY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      this.params.azimuth += dx * 0.008;
      this.params.elevation = Math.max(-1.4, Math.min(1.5, this.params.elevation + dy * 0.008));
      this.needsRender = true;
    });
    this.canvas.addEventListener('pointerup', () => { dragging = false; });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.params.distance = Math.max(2.2, Math.min(9, this.params.distance * (1 + Math.sign(e.deltaY) * 0.08)));
      this.needsRender = true;
    }, { passive: false });
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;

      if (this.autoRotate) {
        this.params.turntable += (this.turntableSpeedDeg * Math.PI / 180) * dt;
        this.needsRender = true;
      }
      // 自适应分辨率
      if (this.getResolutionScale) {
        this.renderer.resolutionScale = this.getResolutionScale();
      }
      if (this.needsRender) {
        void this.renderer.render(this.params);
        // FPS：统计最近 1 秒内的实际渲染帧数
        this.frameTimes.push(now);
        const cutoff = now - 1000;
        while (this.frameTimes.length && this.frameTimes[0] < cutoff) this.frameTimes.shift();
        this.fps = this.frameTimes.length;
        this.onFrame?.(this.fps);
        // 持续旋转时下一帧继续；静止时也保持低频重绘以响应尺寸变化
        this.needsRender = this.autoRotate;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** 强制重绘一帧 */
  invalidate(): void {
    this.needsRender = true;
  }

  getFps(): number {
    return this.fps;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas.remove();
  }
}
