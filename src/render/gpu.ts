/**
 * WebGPU 转台视图:刻面网格渲染。
 * 每个刻面的亮度由 CPU 按当前光源模型计算(镜面反射方向查光源分布),
 * 转动时闪烁点严格跟随刻面。WebGPU 不可用时退回 2D 线框投影。
 */
import { GemModel } from '../geometry/gem';
import { Vec3, norm, cross, sub, add, scale } from '../core/vec3';
import { radiance, LightSettings } from '../optics/lighting';

const WGSL = /* wgsl */`
struct Uniforms { mvp: mat4x4f, };
@group(0) @binding(0) var<uniform> u: Uniforms;
struct VIn { @location(0) pos: vec3f, @location(1) color: vec3f, };
struct VOut { @builtin(position) pos: vec4f, @location(0) color: vec3f, };
@vertex fn vs(v: VIn) -> VOut {
  var o: VOut;
  o.pos = u.mvp * vec4f(v.pos, 1.0);
  o.color = v.color;
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  return vec4f(v.color, 1.0);
}`;

export class GemRenderer {
  private device: GPUDevice | null = null;
  private ctx: GPUCanvasContext | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuf: GPUBuffer | null = null;
  private vbuf: GPUBuffer | null = null;
  private vcount = 0;
  private format: GPUTextureFormat = 'bgra8unorm';
  private depthTex: GPUTexture | null = null;
  private canvas2d: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private angle = 0;
  private playing = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private model: GemModel,
    private light: LightSettings,
    private tiltDeg = 25,
  ) {}

  async init(): Promise<boolean> {
    const nav = navigator as Navigator & { gpu?: GPU };
    if (!nav.gpu) return this.init2d();
    try {
      const adapter = await nav.gpu.requestAdapter();
      if (!adapter) return this.init2d();
      this.device = await adapter.requestDevice();
      this.ctx = this.canvas.getContext('webgpu') as GPUCanvasContext;
      this.format = nav.gpu.getPreferredCanvasFormat();
      this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
      const mod = this.device.createShaderModule({ code: WGSL });
      this.pipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: mod, entryPoint: 'vs',
          buffers: [{
            arrayStride: 24,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
            ],
          }],
        },
        fragment: { module: mod, entryPoint: 'fs', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      });
      this.uniformBuf = this.device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const bind = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuf } }],
      });
      (this as unknown as { bind: GPUBindGroup }).bind = bind;
      this.rebuild();
      return true;
    } catch {
      return this.init2d();
    }
  }

  private init2d(): boolean {
    this.canvas2d = this.canvas.getContext('2d');
    return false;
  }

  setModel(model: GemModel): void { this.model = model; this.rebuild(); }
  setLight(light: LightSettings): void { this.light = light; }

  /** 每帧按光源重算刻面颜色并上传 */
  private rebuild(): void {
    const data = this.vertexData(this.angle);
    this.vcount = data.length / 6;
    if (this.device) {
      this.vbuf?.destroy();
      this.vbuf = this.device.createBuffer({
        size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(this.vbuf, 0, data);
    }
  }

  /** 刻面颜色:视线镜面反射方向上的光源亮度 + 底光 */
  private vertexData(angle: number): Float32Array {
    const out: number[] = [];
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const rot = (v: Vec3): Vec3 => ({ x: v.x * ca - v.y * sa, y: v.x * sa + v.y * ca, z: v.z });
    const view: Vec3 = { x: 0, y: 0, z: 1 };
    for (const f of this.model.facets) {
      const n0 = norm(cross(sub(f.verts[1], f.verts[0]), sub(f.verts[2], f.verts[1])));
      const n = rot(n0);
      // 反射方向 r = 2(n·v)n - v
      const d = 2 * (n.x * view.x + n.y * view.y + n.z * view.z);
      const r: Vec3 = { x: d * n.x - view.x, y: d * n.y - view.y, z: d * n.z - view.z };
      const spec = radiance(norm(r), this.light);
      const diff = 0.10 + 0.10 * Math.max(0, n.z);
      const b = Math.min(1, diff + spec);
      // 冷白钻色,亭部略暗
      const tint: [number, number, number] = n0.z < -0.01 ? [0.75, 0.8, 0.95] : [0.92, 0.95, 1.0];
      for (let i = 1; i < f.verts.length - 1; i++) {
        for (const vtx of [f.verts[0], f.verts[i], f.verts[i + 1]]) {
          const p = rot(vtx);
          out.push(p.x, p.y, p.z, b * tint[0], b * tint[1], b * tint[2]);
        }
      }
    }
    return new Float32Array(out);
  }

  private mvp(angle: number): Float32Array {
    const w = this.canvas.width || 600, h = this.canvas.height || 600;
    const aspect = w / h;
    const fov = 30 * Math.PI / 180, near = 0.1, far = 20;
    const f = 1 / Math.tan(fov / 2);
    const persp = [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, far / (near - far), -1,
      0, 0, near * far / (near - far), 0,
    ];
    // 视线:从 (0, -dist*sin(tilt)?, ...) 简化:先绕 x 轴 tilt,再平移 z
    const tilt = this.tiltDeg * Math.PI / 180;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const dist = 4.2;
    const view = [
      1, 0, 0, 0,
      0, ct, st, 0,
      0, -st, ct, 0,
      0, 0, -dist, 1,
    ];
    return new Float32Array(mul4(persp, view));
  }

  render = (): void => {
    if (this.playing) {
      this.angle += 0.02;
      this.rebuild();
    }
    if (this.device && this.ctx && this.pipeline && this.vbuf && this.uniformBuf) {
      const w = this.canvas.clientWidth * devicePixelRatio | 0;
      const h = this.canvas.clientHeight * devicePixelRatio | 0;
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w; this.canvas.height = h;
        this.depthTex?.destroy();
        this.depthTex = this.device.createTexture({
          size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
      }
      if (!this.depthTex) {
        this.depthTex = this.device.createTexture({
          size: [this.canvas.width, this.canvas.height],
          format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
      }
      this.device.queue.writeBuffer(this.uniformBuf, 0, this.mvp(this.angle));
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: this.ctx.getCurrentTexture().createView(),
          clearValue: { r: 0.07, g: 0.08, b: 0.1, a: 1 }, loadOp: 'clear', storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: this.depthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
        },
      });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, (this as unknown as { bind: GPUBindGroup }).bind);
      pass.setVertexBuffer(0, this.vbuf);
      pass.draw(this.vcount);
      pass.end();
      this.device.queue.submit([enc.finish()]);
    } else if (this.canvas2d) {
      this.render2d();
    }
    this.raf = requestAnimationFrame(this.render);
  };

  /** 2D 兜底:线框投影 */
  private render2d(): void {
    const ctx = this.canvas2d!;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.fillStyle = '#12141a'; ctx.fillRect(0, 0, w, h);
    const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
    const tilt = this.tiltDeg * Math.PI / 180;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const s = Math.min(w, h) * 0.32;
    ctx.strokeStyle = '#7fb2ff'; ctx.lineWidth = 1;
    for (const f of this.model.facets) {
      ctx.beginPath();
      f.verts.forEach((v, i) => {
        const x = v.x * ca - v.y * sa, y0 = v.x * sa + v.y * ca;
        const y = y0 * ct - v.z * st, z = y0 * st + v.z * ct;
        const px = w / 2 + x * s, py = h / 2 - z * s * 0.9 - y * 0.1;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath(); ctx.stroke();
    }
  }

  play(): void { this.playing = true; }
  pause(): void { this.playing = false; }
  get isPlaying(): boolean { return this.playing; }
  start(): void { if (!this.raf) this.render(); }
  dispose(): void { cancelAnimationFrame(this.raf); this.raf = 0; this.vbuf?.destroy(); this.depthTex?.destroy(); }
}

function mul4(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++)
        o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
