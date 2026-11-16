import './style.css';
import { renderLibrary } from './pages/library';
import { renderEditor } from './pages/editor';
import { renderPreview } from './pages/preview';
import { renderAnalysis } from './pages/analysisPage';
import { renderSettings } from './pages/settingsPage';

const TABS: [string, string][] = [
  ['#/library', '款式库'],
  ['#/editor', '切工编辑'],
  ['#/preview', '渲染预览'],
  ['#/analysis', '光学分析'],
  ['#/settings', '设置'],
];

const app = document.getElementById('app')!;
let cleanup: (() => void) | undefined;

function route(): void {
  cleanup?.();
  cleanup = undefined;

  const hash = location.hash || '#/library';
  const [, page, arg] = hash.split('/');

  // 导航
  const nav = document.createElement('div');
  nav.className = 'nav';
  nav.append(Object.assign(document.createElement('span'), { className: 'brand', textContent: '💎 钻石切工设计 · 火彩预览' }));
  for (const [href, label] of TABS) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (`#/${page}` === href || (page === '' && href === '#/library')) a.className = 'active';
    nav.append(a);
  }

  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.flex = '1';
  container.style.minHeight = '0';

  app.replaceChildren(nav, container);

  const navTo = (h: string) => { location.hash = h; };
  switch (page) {
    case 'editor':
      cleanup = renderEditor(container, arg ?? '') ?? undefined;
      break;
    case 'preview':
      cleanup = renderPreview(container, arg) ?? undefined;
      break;
    case 'analysis':
      renderAnalysis(container, arg);
      break;
    case 'settings':
      renderSettings(container);
      break;
    case 'library':
    default:
      renderLibrary(container, navTo);
      break;
  }
}

window.addEventListener('hashchange', route);
route();
