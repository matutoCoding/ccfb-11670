/** 应用入口:WebGPU 初始化 + hash 路由 */
import { getGPUDevice, gpuTraceSingleRay } from './render/renderer';
import { loadSettings, AppSettings } from './state/store';
import { libraryPage } from './ui/libraryPage';
import { editorPage } from './ui/editorPage';
import { previewPage } from './ui/previewPage';
import { analysisPage } from './ui/analysisPage';
import { settingsPage } from './ui/settingsPage';

// 调试钩子:e2e 验证脚本用
import { generateGem } from './geometry/generate';
import { DEFAULT_PARAMS } from './geometry/types';
import { traceRay } from './physics/raytrace';
import { diamondIOR } from './physics/optics';
import { RENDER_WGSL, RENDER_MAIN_WGSL, VERIFY_WGSL, MESH_WGSL } from './render/shaders';
(window as unknown as Record<string, unknown>).__dbg = {
  gpuTraceSingleRay, generateGem, DEFAULT_PARAMS, traceRay, diamondIOR,
  WGSL: { render: RENDER_WGSL + RENDER_MAIN_WGSL, verify: VERIFY_WGSL, mesh: MESH_WGSL },
};

type Cleanup = () => void;

async function main() {
  const app = document.getElementById('app')!;
  const statusEl = document.getElementById('gpu-status')!;
  const settings: AppSettings = loadSettings();

  const device = await getGPUDevice();
  if (!device) {
    statusEl.textContent = 'WebGPU 不可用(渲染/分析功能受限)';
    statusEl.className = 'gpu-status err';
  } else {
    statusEl.textContent = 'WebGPU 已启用';
    statusEl.className = 'gpu-status ok';
  }

  let cleanup: Cleanup | null = null;

  function navigate(hash: string) {
    location.hash = hash;
  }

  function route() {
    cleanup?.();
    cleanup = null;
    app.innerHTML = '';
    const hash = location.hash || '#/library';
    const [path, qs] = hash.slice(2).split('?');
    const query = new URLSearchParams(qs ?? '');

    document.querySelectorAll('#nav a').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('data-route') === path);
    });

    switch (path) {
      case 'editor':
        cleanup = editorPage(app, query, device, settings, navigate);
        break;
      case 'preview':
        cleanup = previewPage(app, query, device, settings);
        break;
      case 'analysis':
        cleanup = analysisPage(app, query, device, settings);
        break;
      case 'settings':
        cleanup = settingsPage(app, device, settings);
        break;
      case 'library':
      default:
        cleanup = libraryPage(app, navigate);
        break;
    }
  }

  window.addEventListener('hashchange', route);
  route();
}

main();
