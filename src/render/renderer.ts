/** WebGPU 设备单例 */
let devicePromise: Promise<GPUDevice | null> | null = null;

export function getGPUDevice(): Promise<GPUDevice | null> {
  if (!devicePromise) {
    devicePromise = (async () => {
      if (!navigator.gpu) return null;
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      return adapter.requestDevice();
    })();
  }
  return devicePromise;
}

export interface CameraState {
  yawDeg: number;
  pitchDeg: number;
  dist: number;
  fovDeg: number;
  target: [number, number, number];
}

export function cameraVectors(cam: CameraState, aspect: number) {
  const yaw = (cam.yawDeg * Math.PI) / 180;
  const pitch = (cam.pitchDeg * Math.PI) / 180;
  const cp = Math.cos(pitch);
  const pos: [number, number, number] = [
    cam.target[0] + cam.dist * cp * Math.sin(yaw),
    cam.target[1] + cam.dist * Math.sin(pitch),
    cam.target[2] + cam.dist * cp * Math.cos(yaw),
  ];
  const fwd = norm3([
    cam.target[0] - pos[0],
    cam.target[1] - pos[1],
    cam.target[2] - pos[2],
  ]);
  const right = norm3(cross3(fwd, [0, 1, 0]));
  const up = cross3(right, fwd);
  const tanHalf = Math.tan((cam.fovDeg * Math.PI) / 360);
  return { pos, fwd, right, up, tanHalf, aspect };
}

function norm3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross3(a: number[], b: number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

import { RENDER_WGSL, RENDER_MAIN_WGSL, VERIFY_WGSL } from './shaders';

export interface RenderParams {
  cam: CameraState;
  envType: number;
  spectralSamples: number;
  maxBounces: number;
  iors: [number, number, number];
}

export class GemRenderer {
  private ctx: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private uniformBuf: GPUBuffer;
  private planesBuf: GPUBuffer | null = null;
  private facetCount = 0;
  private bindGroupLayout: GPUBindGroupLayout;
  private format: GPUTextureFormat;

  constructor(
    private device: GPUDevice,
    private canvas: HTMLCanvasElement,
  ) {
    this.ctx = canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });

    const module = device.createShaderModule({ code: RENDER_WGSL + RENDER_MAIN_WGSL });
    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.uniformBuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  setGem(planes: Float32Array, facetCount: number) {
    this.planesBuf?.destroy();
    this.planesBuf = this.device.createBuffer({
      size: Math.max(16, planes.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.planesBuf, 0, planes as Float32Array<ArrayBuffer>);
    this.facetCount = facetCount;
  }

  private fillUniforms(p: RenderParams, w: number, h: number) {
    const { pos, fwd, right, up, tanHalf, aspect } = cameraVectors(p.cam, w / h);
    const u = new Float32Array(24);
    u.set(pos, 0);
    u.set([...right, tanHalf], 4);
    u.set([...up, aspect], 8);
    u.set([...fwd, p.envType], 12);
    u.set([...p.iors, p.maxBounces], 16);
    u.set([this.facetCount, p.spectralSamples, w, h], 20);
    this.device.queue.writeBuffer(this.uniformBuf, 0, u);
  }

  private encodePass(p: RenderParams, view: GPUTextureView, w: number, h: number, encoder: GPUCommandEncoder) {
    if (!this.planesBuf || this.facetCount === 0) return;
    this.fillUniforms(p, w, h);
    const bind = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: { buffer: this.planesBuf } },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store' }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
  }

  /** 渲染一帧到 canvas。scale 为内部分辨率比例。 */
  render(p: RenderParams, scale: number) {
    const w = Math.max(8, Math.floor(this.canvas.clientWidth * devicePixelRatio * scale));
    const h = Math.max(8, Math.floor(this.canvas.clientHeight * devicePixelRatio * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const encoder = this.device.createCommandEncoder();
    this.encodePass(p, this.ctx.getCurrentTexture().createView(), w, h, encoder);
    this.device.queue.submit([encoder.finish()]);
  }

  /** 全分辨率离屏渲染并读出 PNG Blob */
  async screenshot(p: RenderParams, width = 1920, height = 1080): Promise<Blob> {
    const tex = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    // 离屏管线格式固定 rgba8unorm,需要时用独立 pipeline
    const module = this.device.createShaderModule({ code: RENDER_WGSL + RENDER_MAIN_WGSL });
    const pipe = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    const savedPipeline = this.pipeline;
    this.pipeline = pipe;
    const encoder = this.device.createCommandEncoder();
    this.encodePass(p, tex.createView(), width, height, encoder);
    this.pipeline = savedPipeline;

    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buf = this.device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, [width, height]);
    this.device.queue.submit([encoder.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(buf.getMappedRange());
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      pixels.set(data.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
    }
    buf.unmap();
    buf.destroy();
    tex.destroy();
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    off.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
    return new Promise((resolve, reject) =>
      off.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))), 'image/png'),
    );
  }
}

/** GPU 单光线核对结果 */
export interface GpuVerifyResult {
  exitDir: [number, number, number];
  throughput: number;
  hit: boolean;
}

/** 用计算着色器追踪一条光线,返回出射方向(与 CPU traceRay 对照) */
export async function gpuTraceSingleRay(
  device: GPUDevice,
  planes: Float32Array,
  facetCount: number,
  ro: [number, number, number],
  rd: [number, number, number],
  ior: number,
  maxBounces: number,
): Promise<GpuVerifyResult> {
  const module = device.createShaderModule({ code: VERIFY_WGSL });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const uniformBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const u = new Float32Array(12);
  u.set(ro, 0);
  u.set(rd, 4);
  u.set([ior, maxBounces, facetCount, 0], 8);
  device.queue.writeBuffer(uniformBuf, 0, u);

  const planesBuf = device.createBuffer({
    size: Math.max(16, planes.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(planesBuf, 0, planes as Float32Array<ArrayBuffer>);

  const resultBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: planesBuf } },
      { binding: 2, resource: { buffer: resultBuf } },
    ],
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind);
  pass.dispatchWorkgroups(1);
  pass.end();
  encoder.copyBufferToBuffer(resultBuf, 0, readBuf, 0, 32);
  device.queue.submit([encoder.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readBuf.getMappedRange()).slice();
  readBuf.unmap();
  uniformBuf.destroy(); planesBuf.destroy(); resultBuf.destroy(); readBuf.destroy();
  return {
    exitDir: [out[0], out[1], out[2]],
    throughput: out[3],
    hit: out[4] > 0.5,
  };
}
