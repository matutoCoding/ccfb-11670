import './style.css';
import { el } from './ui/dom';
import { loadSchemes } from './ui/store';
import { renderProportions } from './ui/pages/proportions';
import { renderFacets } from './ui/pages/facets';
import { renderOptics } from './ui/pages/optics';
import { renderGrading } from './ui/pages/grading';
import { renderSettings } from './ui/pages/settings';

const PAGES: { hash: string; label: string; render: (r: HTMLElement) => void }[] = [
  { hash: 'proportions', label: '比例方案', render: renderProportions },
  { hash: 'facets', label: '刻面编辑', render: renderFacets },
  { hash: 'optics', label: '光学观测', render: renderOptics },
  { hash: 'grading', label: '切工评级', render: renderGrading },
  { hash: 'settings', label: '设置', render: renderSettings },
];

function boot(): void {
  loadSchemes();
  const app = document.getElementById('app')!;
  const nav = el('nav', { class: 'topnav' }, [
    el('span', { class: 'logo' }, ['💎 钻石切工光学评估']),
  ]);
  const content = el('main');
  for (const p of PAGES) {
    const a = el('a', { href: `#${p.hash}`, 'data-hash': p.hash }, [p.label]);
    nav.append(a);
  }
  app.append(nav, content);

  function route(): void {
    document.querySelectorAll('.report-overlay').forEach(o => o.remove());
    const hash = location.hash.replace('#', '') || 'proportions';
    const page = PAGES.find(p => p.hash === hash) ?? PAGES[0];
    nav.querySelectorAll('a').forEach(a =>
      a.classList.toggle('active', a.getAttribute('data-hash') === page.hash));
    page.render(content);
  }
  window.addEventListener('hashchange', route);
  route();
}

boot();
