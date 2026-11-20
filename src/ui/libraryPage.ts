/** 款式库页面:新建/复制/删除/导入/导出 */
import { h } from './common';
import { store, shapeName } from '../state/store';
import { CutShape } from '../geometry/types';
import { downloadText } from '../report';

export function libraryPage(root: HTMLElement, navigate: (hash: string) => void): () => void {
  const page = h('div', { class: 'page' });

  function render() {
    page.innerHTML = '';
    const designs = store.list();

    const newSel = h('select') as HTMLSelectElement;
    for (const s of ['round', 'princess', 'oval'] as CutShape[]) {
      newSel.append(h('option', { value: s }, shapeName(s)));
    }
    const newBtn = h('button', { class: 'primary' }, '＋ 新建款式');
    newBtn.onclick = () => {
      const d = store.create(newSel.value as CutShape);
      navigate(`#/editor?id=${d.id}`);
    };

    const exportBtn = h('button', {}, '导出全部');
    exportBtn.onclick = () => downloadText('diamond-designs.json', store.exportJSON(), 'application/json');

    const importBtn = h('button', {}, '导入');
    const fileInput = h('input', { type: 'file', accept: '.json', style: 'display:none' }) as HTMLInputElement;
    importBtn.onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      try {
        const n = store.importJSON(await f.text());
        alert(`成功导入 ${n} 个款式`);
      } catch (e) {
        alert(`导入失败:${(e as Error).message}`);
      }
      fileInput.value = '';
    };

    page.append(
      h('div', { class: 'toolbar' },
        h('h2', {}, '款式库'), h('span', { class: 'grow' }),
        newSel, newBtn, importBtn, exportBtn, fileInput),
    );

    const grid = h('div', { class: 'card-grid' });
    for (const d of designs) {
      const card = h('div', { class: 'card' },
        h('div', { class: 'name' }, d.name),
        h('div', { class: 'meta' },
          `${shapeName(d.params.shape)} · 台面 ${d.params.tablePct}% · 冠角 ${d.params.crownAngleDeg}° · 亭角 ${d.params.pavilionAngleDeg}°`),
        h('div', { class: 'meta' }, `更新于 ${new Date(d.updatedAt).toLocaleString('zh-CN')}`),
      );
      const actions = h('div', { class: 'actions' });
      const editBtn = h('button', {}, '编辑');
      editBtn.onclick = (e) => { e.stopPropagation(); navigate(`#/editor?id=${d.id}`); };
      const prevBtn = h('button', {}, '预览');
      prevBtn.onclick = (e) => { e.stopPropagation(); navigate(`#/preview?id=${d.id}`); };
      const anaBtn = h('button', {}, '分析');
      anaBtn.onclick = (e) => { e.stopPropagation(); navigate(`#/analysis?id=${d.id}`); };
      const dupBtn = h('button', {}, '复制');
      dupBtn.onclick = (e) => { e.stopPropagation(); store.duplicate(d.id); };
      const delBtn = h('button', { class: 'danger' }, '删除');
      delBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`确定删除「${d.name}」?`)) store.remove(d.id);
      };
      const expBtn = h('button', {}, '导出');
      expBtn.onclick = (e) => {
        e.stopPropagation();
        downloadText(`${d.name}.json`, store.exportJSON([d.id]), 'application/json');
      };
      actions.append(editBtn, prevBtn, anaBtn, dupBtn, expBtn, delBtn);
      card.append(actions);
      card.onclick = () => navigate(`#/editor?id=${d.id}`);
      grid.append(card);
    }
    page.append(grid);
  }

  render();
  const unsub = store.subscribe(render);
  root.append(page);
  return () => unsub();
}
