import { getGpuDevice } from './device';
import { RAYTRACE_WGSL } from './shader';
import { Plane } from '../optics/raytrace';

export type EnvMode = 0 | 1 | 2 | 3; // 0 珠宝柜台 1 自然光 2 点光源 3 分析(上半球白)

export interface RenderParams {
  /** 相机球坐标 */
  azimuth: number;   // 弧度
  elevation: number; // 弧度
  distance: number;
  fovDeg: number;
  /** 转台角（宝石绕 Y 自转），弧度 */
  turntable: number;
  envMode: EnvMode;
  numWavelengths: 1 | 3 | 5;
  maxBounces: number;
  cauchyA: number;
  cauchyB: number;
  envIntensity: number;
  exposure: number;
  /** 背景环境亮度系数（看向背景时） */
  bgBrightness: number;
}

export const DEFAULT_RENDER_PARAMS: Omit<RenderParams, 'azimuth' | 'elevation'> = {
  distance: 4.2,
  fovDeg: 30,
  turntable: 0,
  envMode: 0,
  numWavelengths: 3,
  maxBounces: 8,
  cauchyA: 2.3798,
  cauchyB: 0.01315,
  envIntensity: 1.0,
  exposure: 1.4,
  bgBrightness: 1.0,
};

interface RenderTarget {
  view: GPUTextureView;
  width: number;
  height: number;
}

/**
 * 单画布 WebGPU 光线追踪渲染器。
 * 分辨率自适应：内部按 resolutionScale 渲染，CSS 拉伸显示。
 */
export class DiamondRenderer {
  private ctx: GPUCanvasContext;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private facetBuffer: GPUBuffer | null = null;
  private facetCount = 0;
  private bindGroup: GPUBindGroup | null = null;
  private format: GPUTextureFormat = 'bgra8unorm';
  resolutionScale = 1.0;
  private failed = false;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('无法创建 WebGPU canvas 上下文');
    this.ctx = ctx;
  }

  async init(): Promise<void> {
    const device = await getGpuDevice();
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });

    const module = device.createShaderModule({ code: RAYTRACE_WGSL });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vsMain' },
      fragment: { module, entryPoint: 'fsMain', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.uniformBuffer = device.createBuffer({
      size: 8 * 16, // 8 个 vec4
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /** 更新刻面平面数据（n.xyz, w） */
  async setGeometry(planes: Plane[]): Promise<void> {
    const dev = await getGpuDevice();
    const data = new Float32Array(planes.length * 4);
    planes.forEach((p, i) => {
      data[i * 4] = p.n[0]; data[i * 4 + 1] = p.n[1]; data[i * 4 + 2] = p.n[2]; data[i * 4 + 3] = p.w;
    });
    this.facetBuffer?.destroy();
    this.facetBuffer = dev.createBuffer({
      size: Math.max(16, data.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(this.facetBuffer, 0, data);
    this.facetCount = planes.length;
    this.bindGroup = null; // 重建
  }

  private computeUniforms(p: RenderParams, w: number, h: number): Float32Array<ArrayBuffer> {
    const ce = Math.cos(p.elevation), se = Math.sin(p.elevation);
    const ca = Math.cos(p.azimuth), sa = Math.sin(p.azimuth);
    const pos = [p.distance * ce * sa, p.distance * se, p.distance * ce * ca];
    const fwd = norm3([-pos[0], -pos[1], -pos[2]]);
    const right = norm3(cross3(fwd, [0, 1, 0]));
    const up = cross3(right, fwd);
    const tanHalf = Math.tan((p.fovDeg * Math.PI) / 360);
    const aspect = w / h;
    const cs = Math.cos(p.turntable), sn = Math.sin(p.turntable);

    const u = new Float32Array(32);
    u.set([
      pos[0], pos[1], pos[2], p.exposure,
      right[0], right[1], right[2], tanHalf * aspect,
      up[0], up[1], up[2], tanHalf,
      fwd[0], fwd[1], fwd[2], w,
      cs, sn, p.envIntensity, h,
      this.facetCount, p.envMode, p.numWavelengths, p.maxBounces,
      p.cauchyA, p.cauchyB, p.bgBrightness, 0,
    ]);
    return u;
  }

  private encodePass(device: GPUDevice, target: RenderTarget): void {
    if (!this.bindGroup) {
      this.bindGroup = device.createBindGroup({
        layout: this.pipeline!.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer! } },
          { binding: 1, resource: { buffer: this.facetBuffer! } },
        ],
      });
    }
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: target.view,
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  /** 渲染到画布 */
  async render(p: RenderParams): Promise<void> {
    if (this.failed) return;
    try {
      const device = await getGpuDevice();
      if (!this.pipeline || !this.uniformBuffer || !this.facetBuffer) return;

      const w = Math.max(8, Math.floor(this.canvas.clientWidth * this.resolutionScale));
      const h = Math.max(8, Math.floor(this.canvas.clientHeight * this.resolutionScale));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w; this.canvas.height = h;
      }
      device.queue.writeBuffer(this.uniformBuffer, 0, this.computeUniforms(p, w, h));
      this.encodePass(device, { view: this.ctx.getCurrentTexture().createView(), width: w, height: h });
    } catch (e) {
      this.failed = true;
      console.error('渲染失败:', e);
    }
  }

  /**
   * 高分辨率截图：离屏渲染到纹理并读回（不受画布呈现缓冲清除影响）。
   * @param scale 相对显示尺寸的倍数（如 2 = 2 倍超采样）
   */
  async capture(p: RenderParams, scale = 2): Promise<Blob | null> {
    try {
      const device = await getGpuDevice();
      if (!this.pipeline || !this.facetBuffer) return null;
      const w = Math.max(8, Math.floor(this.canvas.clientWidth * scale));
      const h = Math.max(8, Math.floor(this.canvas.clientHeight * scale));
      const tex = device.createTexture({
        size: [w, h],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      // 截图管线可能格式不同，单独建
      const module = device.createShaderModule({ code: RAYTRACE_WGSL });
      const pipe = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vsMain' },
        fragment: { module, entryPoint: 'fsMain', targets: [{ format: 'rgba8unorm' }] },
      });
      const uniBuf = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniBuf, 0, this.computeUniforms(p, w, h));

      const bind = device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniBuf } },
          { binding: 1, resource: { buffer: this.facetBuffer } },
        ],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: tex.createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }],
      });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
      // bytesPerRow 必须是 256 的倍数，不足时补对齐
      const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
      const readBuf = device.createBuffer({
        size: bytesPerRow * h,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      encoder.copyTextureToBuffer({ texture: tex }, { buffer: readBuf, bytesPerRow }, [w, h]);
      device.queue.submit([encoder.finish()]);

      await readBuf.mapAsync(GPUMapMode.READ);
      const raw = new Uint8Array(readBuf.getMappedRange().slice(0));
      readBuf.unmap();
      tex.destroy();
      readBuf.destroy();
      uniBuf.destroy();

      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const ctx2 = off.getContext('2d')!;
      const img = ctx2.createImageData(w, h);
      for (let row = 0; row < h; row++) {
        img.data.set(raw.subarray(row * bytesPerRow, row * bytesPerRow + w * 4), row * w * 4);
      }
      ctx2.putImageData(img, 0, 0);
      return new Promise((resolve) => off.toBlob(resolve, 'image/png'));
    } catch (e) {
      console.error('截图失败:', e);
      return null;
    }
  }
}

function norm3(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross3(a: number[], b: number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
