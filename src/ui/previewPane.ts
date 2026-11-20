/** 可复用的实时预览面板:轨道相机 + 自动转台 + 自适应分辨率 + FPS 显示 */
import { GemRenderer, CameraState } from '../render/renderer';
import { Gem } from '../geometry/gem';
import { AppSettings } from '../state/store';
import { diamondIOR, WAVELENGTHS_NM } from '../physics/optics';
import { h, attachOrbit, defaultCamera } from './common';

export class PreviewPane {
  readonly wrap: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: GemRenderer;
  private hud: HTMLElement;
  cam: CameraState = defaultCamera();
  autoRotateDegPerSec = 0;
  envType = 0;
  private raf = 0;
  private lastT = 0;
  private scale: number;
  private emaFrameMs = 16;
  private fps = 0;
  private disposed = false;
  private detachOrbit: () => void;

  constructor(
    device: GPUDevice,
    private settings: AppSettings,
    label = '',
    sharedCam?: CameraState,
  ) {
    if (sharedCam) this.cam = sharedCam;
    this.canvas = h('canvas');
    this.renderer = new GemRenderer(device, this.canvas);
    this.hud = h('div', { class: 'canvas-hud' });
    this.wrap = h('div', { class: 'canvas-wrap' }, this.canvas, this.hud);
    if (label) this.wrap.append(h('div', { class: 'canvas-label' }, label));
    this.scale = settings.renderScale;
    this.envType = settings.envType;
    this.detachOrbit = attachOrbit(this.canvas, this.cam, () => {});
  }

  setGem(gem: Gem) {
    const planes = new Float32Array(gem.planes.length * 4);
    gem.planes.forEach((p, i) => planes.set([...p.n, p.d], i * 4));
    this.renderer.setGem(planes, gem.planes.length);
  }

  start() {
    const loop = (t: number) => {
      if (this.disposed) return;
      const dt = Math.min(0.1, (t - this.lastT) / 1000 || 0.016);
      this.lastT = t;
      // 自动转台
      if (this.autoRotateDegPerSec !== 0) this.cam.yawDeg += this.autoRotateDegPerSec * dt;
      // 自适应分辨率:帧时间 EMA 驱动
      this.emaFrameMs = this.emaFrameMs * 0.9 + dt * 1000 * 0.1;
      if (this.settings.adaptiveScale) {
        if (this.emaFrameMs > 33 && this.scale > 0.4) this.scale = Math.max(0.4, this.scale - 0.05);
        else if (this.emaFrameMs < 22 && this.scale < this.settings.renderScale)
          this.scale = Math.min(this.settings.renderScale, this.scale + 0.02);
      } else {
        this.scale = this.settings.renderScale;
      }
      this.fps = this.fps * 0.9 + (1 / dt) * 0.1;
      this.renderer.render(
        {
          cam: this.cam,
          envType: this.envType,
          spectralSamples: this.settings.spectralSamples,
          maxBounces: this.settings.maxBounces,
          iors: [
            diamondIOR(WAVELENGTHS_NM[0]),
            diamondIOR(WAVELENGTHS_NM[1]),
            diamondIOR(WAVELENGTHS_NM[2]),
          ],
        },
        this.scale,
      );
      this.hud.textContent = `${this.fps.toFixed(0)} fps · ${(this.scale * 100).toFixed(0)}% 分辨率 · 拖拽旋转 / 滚轮缩放`;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  async screenshot(): Promise<Blob> {
    return this.renderer.screenshot({
      cam: this.cam,
      envType: this.envType,
      spectralSamples: this.settings.spectralSamples,
      maxBounces: this.settings.maxBounces,
      iors: [
        diamondIOR(WAVELENGTHS_NM[0]),
        diamondIOR(WAVELENGTHS_NM[1]),
        diamondIOR(WAVELENGTHS_NM[2]),
      ],
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.detachOrbit();
  }
}
