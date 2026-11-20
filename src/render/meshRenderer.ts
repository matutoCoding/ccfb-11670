/** 刻面网格渲染器:用于漏光分析视图(按刻面着色) */
import { MESH_WGSL } from './shaders';
import { Gem } from '../geometry/gem';
import { newellNormal } from '../geometry/gem';
import { Mat4 } from '../math/mat4';

export class MeshRenderer {
  private ctx: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private uniformBuf: GPUBuffer;
  private vertexBuf: GPUBuffer | null = null;
  private depthTex: GPUTexture | null = null;
  private vertexCount = 0;

  constructor(
    private device: GPUDevice,
    private canvas: HTMLCanvasElement,
  ) {
    this.ctx = canvas.getContext('webgpu') as GPUCanvasContext;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format, alphaMode: 'opaque' });
    const module = device.createShaderModule({ code: MESH_WGSL });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [{
          arrayStride: 36,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },  // pos
            { shaderLocation: 1, offset: 12, format: 'float32x3' }, // color
            { shaderLocation: 2, offset: 24, format: 'float32x3' }, // normal
          ],
        }],
      },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this.uniformBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  /** 上传网格;facetColors 为每刻面 RGB(长度 = 刻面数×3) */
  setMesh(gem: Gem, facetColors: Float32Array) {
    const triVerts = gem.meshPositions.length / 3;
    const data = new Float32Array(triVerts * 9);
    const normals = gem.facets.map((f) => newellNormal(f.verts));
    for (let v = 0; v < triVerts; v++) {
      const f = gem.meshFacetIndex[v];
      data.set([gem.meshPositions[v * 3], gem.meshPositions[v * 3 + 1], gem.meshPositions[v * 3 + 2]], v * 9);
      data.set([facetColors[f * 3], facetColors[f * 3 + 1], facetColors[f * 3 + 2]], v * 9 + 3);
      data.set(normals[f], v * 9 + 6);
    }
    this.vertexBuf?.destroy();
    this.vertexBuf = this.device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuf, 0, data);
    this.vertexCount = triVerts;
  }

  render(mvp: Mat4, lightDir: [number, number, number]) {
    if (!this.vertexBuf || this.vertexCount === 0) return;
    const w = Math.max(8, Math.floor(this.canvas.clientWidth * devicePixelRatio));
    const h = Math.max(8, Math.floor(this.canvas.clientHeight * devicePixelRatio));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.depthTex?.destroy();
      this.depthTex = this.device.createTexture({
        size: [w, h],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    if (!this.depthTex) {
      this.depthTex = this.device.createTexture({
        size: [w, h],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    const u = new Float32Array(20);
    u.set(mvp, 0);
    u.set([...lightDir, 0], 16);
    this.device.queue.writeBuffer(this.uniformBuf, 0, u);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        loadOp: 'clear',
        clearValue: [0.08, 0.08, 0.1, 1],
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTex.createView(),
        depthLoadOp: 'clear',
        depthClearValue: 1,
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(this.pipeline);
    pass.setVertexBuffer(0, this.vertexBuf);
    const bind = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuf } }],
    });
    pass.setBindGroup(0, bind);
    pass.draw(this.vertexCount);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
