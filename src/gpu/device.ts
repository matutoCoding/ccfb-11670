/** WebGPU 设备单例（多画布共享） */
let devicePromise: Promise<GPUDevice> | null = null;

export function getGpuDevice(): Promise<GPUDevice> {
  if (!devicePromise) {
    devicePromise = (async () => {
      if (!navigator.gpu) throw new Error('此浏览器不支持 WebGPU（请使用 Chrome/Edge 113+）');
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('未找到可用的 WebGPU 适配器（显卡/驱动不支持）');
      return adapter.requestDevice();
    })();
    devicePromise.catch(() => { devicePromise = null; });
  }
  return devicePromise;
}
