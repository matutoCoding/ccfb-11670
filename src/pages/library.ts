import { el, button, selectRow } from '../ui/dom';
import { store, CUT_LABEL, downloadFile, Design } from '../state';
import { CutType } from '../geometry/cuts';

/** 款式库页面 */
export function renderLibrary(root: HTMLElement, nav: (hash: string) => void): void {
  const listWrap = el('div', {});

  const rebuild = () => {
    listWrap.replaceChildren(buildTable());
  };

  const buildTable = (): HTMLElement => {
    if (store.designs.length === 0) {
      return el('div', { className: 'card muted' }, '暂无款式，点击上方"新建款式"开始设计。');
    }
    const table = el('table', { className: 'list' });
    table.append(el('tr', {},
      el('th', {}, '名称'), el('th', {}, '切工'), el('th', {}, '台面比'),
      el('th', {}, '冠角'), el('th', {}, '亭角'), el('th', {}, '更新时间'), el('th', {}, '操作'),
    ));
    for (const d of store.designs) {
      const nameCell = el('td', {}, d.name);
      nameCell.style.cursor = 'text';
      nameCell.title = '点击重命名';
      nameCell.addEventListener('click', () => {
        const input = el('input', { type: 'text', value: d.name }) as HTMLInputElement;
        const commit = () => { store.rename(d.id, input.value.trim() || d.name); };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
        nameCell.replaceChildren(input);
        input.focus();
        input.select();
      });
      table.append(el('tr', {},
        nameCell,
        el('td', {}, CUT_LABEL[d.cut]),
        el('td', {}, `${d.params.tablePct}%`),
        el('td', {}, `${d.params.crownAngle}°`),
        el('td', {}, `${d.params.pavilionAngle}°`),
        el('td', { className: 'muted' }, new Date(d.updatedAt).toLocaleString('zh-CN')),
        el('td', { className: 'actions' },
          button('编辑', () => nav(`#/editor/${d.id}`)),
          button('预览', () => nav(`#/preview/${d.id}`)),
          button('分析', () => nav(`#/analysis/${d.id}`)),
          button('复制', () => store.duplicate(d.id)),
          button('导出', () => {
            downloadFile(`${d.name}.json`, JSON.stringify({ app: 'diamond-cut-studio', version: 1, designs: [d] }, null, 2), 'application/json');
          }),
          button('删除', () => {
            if (confirm(`确定删除款式「${d.name}」？`)) store.remove(d.id);
          }, 'btn danger'),
        ),
      ));
    }
    return table;
  };

  let newCut: CutType = 'round';
  const fileInput = el('input', { type: 'file', accept: '.json', style: 'display:none' }) as HTMLInputElement;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const n = store.importJson(await file.text());
      toast(`成功导入 ${n} 个款式`);
    } catch (e) {
      toast(`导入失败：${(e as Error).message}`);
    }
    fileInput.value = '';
  });

  root.append(
    el('div', { className: 'page' },
      el('h2', {}, '款式库'),
      el('div', { className: 'toolbar' },
        selectRow('新建切工', [
          ['round', CUT_LABEL.round], ['princess', CUT_LABEL.princess], ['oval', CUT_LABEL.oval],
        ], 'round', (v) => { newCut = v as CutType; }),
        button('＋ 新建款式', () => {
          const d = store.create(newCut);
          nav(`#/editor/${d.id}`);
        }, 'btn primary'),
        button('导入款式', () => fileInput.click()),
        button('导出全部', () => {
          downloadFile(`钻石款式库-${new Date().toISOString().slice(0, 10)}.json`, store.exportAll(), 'application/json');
        }),
        el('span', { className: 'muted' }, `共 ${store.designs.length} 个款式 · 数据保存在浏览器本地`),
      ),
      listWrap,
      fileInput,
    ),
  );
  rebuild();
  store.subscribe(rebuild);
}

export function toast(msg: string): void {
  const t = el('div', { className: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

export type { Design };
