/** 页面 3:光学观测 —— 光路追踪 / ASET / IdealScope / 八心八箭 / 转台 */
import { el, numField, selectField, button } from '../dom';
import { state, modelOf } from '../store';
import { traceRay, TraceResult } from '../../optics/tracer';
import { computeAset, computeIdealScope, drawAset, drawIdeal, defaultAsetSettings } from '../../optics/aset';
import { analyzeHeartsArrows, drawHA } from '../../optics/heartsArrows';
import { diamondIOR, WAVELENGTHS } from '../../core/optics';
import { v3, Vec3 } from '../../core/vec3';
import { GemRenderer } from '../../render/gpu';

type Tab = 'ray' | 'aset' | 'ha' | 'turntable';

export function renderOptics(root: HTMLElement): void {
  root.innerHTML = '';
  const wrap = el('div', { class: 'page' });
  wrap.append(el('h2', {}, ['光学观测']));
  const which = { current: 'A' as 'A' | 'B' };
  const getModel = () => modelOf(which.current === 'A' ? state.schemeA : state.schemeB);
  let tab: Tab = 'ray';
  const body = el('div');
  let renderer: GemRenderer | null = null;

  const tabs = el('div', { class: 'tabs' });
  const mkTab = (id: Tab, text: string) => {
    const b = button(text, () => { tab = id; refreshTabs(); show(); }, tab === id ? 'tab active' : 'tab');
    b.dataset.tab = id;
    return b;
  };
  function refreshTabs(): void {
    tabs.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', (b as HTMLButtonElement).dataset.tab === tab);
    });
  }
  tabs.append(mkTab('ray', '光路追踪'), mkTab('aset', 'ASET / IdealScope'), mkTab('ha', '八心八箭'), mkTab('turntable', '转台闪烁'));

  wrap.append(el('div', { class: 'toolbar' }, [
    selectField('观测对象', [
      { value: 'A', text: '方案 A' }, { value: 'B', text: '方案 B' },
    ], which.current, v => { which.current = v as 'A' | 'B'; show(); }),
  ]), tabs, body);

  function show(): void {
    renderer?.dispose(); renderer = null;
    body.innerHTML = '';
    if (tab === 'ray') showRay(body, getModel);
    else if (tab === 'aset') showAset(body, getModel);
    else if (tab === 'ha') showHA(body, getModel);
    else showTurntable(body, getModel, r => (renderer = r));
  }
  show();
  root.append(wrap);
}

/* ---------- 单光线追迹 ---------- */
function showRay(box: HTMLElement, getModel: () => ReturnType<typeof modelOf>): void {
  const rayParams = { x: 0.3, y: 0.0, elevDeg: 90, azimDeg: 0, lambda: WAVELENGTHS.D };
  const canvas = el('canvas', { class: 'rayview', width: '520', height: '520' });
  const table = el('div', { class: 'ray-table' });
  const summary = el('p', { class: 'hint' });

  function run(): TraceResult {
    const m = getModel();
    const elev = rayParams.elevDeg * Math.PI / 180;
    const az = rayParams.azimDeg * Math.PI / 180;
    // 方向:从天空射向石头
    const d = v3(-Math.cos(elev) * Math.cos(az), -Math.cos(elev) * Math.sin(az), -Math.sin(elev));
    const ior = diamondIOR(rayParams.lambda);
    return traceRay(m, { o: v3(rayParams.x, rayParams.y, 5), d }, ior, rayParams.lambda);
  }

  function drawPath(r: TraceResult): void {
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#101218'; ctx.fillRect(0, 0, W, H);
    const m = getModel();
    // 侧视投影:把每个刻面顶点投到 (径向, z) 平面
    const s = W / 3.2;
    const px = (v: Vec3) => W / 2 + v.x * s;
    const pz = (v: Vec3) => H * 0.45 - v.z * s;
    ctx.strokeStyle = '#3a4152'; ctx.lineWidth = 1;
    for (const f of m.facets) {
      ctx.beginPath();
      f.verts.forEach((v, i) => { if (i === 0) ctx.moveTo(px(v), pz(v)); else ctx.lineTo(px(v), pz(v)); });
      ctx.closePath(); ctx.stroke();
    }
    // 光路
    if (r.events.length === 0) { summary.textContent = '光线未命中宝石'; return; }
    ctx.strokeStyle = '#ff5348'; ctx.lineWidth = 2;
    ctx.beginPath();
    const start = r.events[0].point;
    ctx.moveTo(px({ ...start, x: start.x, z: 2.2 } as Vec3), pz(v3(0, 0, 2.2)));
    for (const e of r.events) ctx.lineTo(px(e.point), pz(e.point));
    const last = r.events[r.events.length - 1];
    if (r.exitDir) {
      const end = { x: last.point.x + r.exitDir.x * 2, y: 0, z: last.point.z + r.exitDir.z * 2 };
      ctx.lineTo(px(end as Vec3), pz(end as Vec3));
    }
    ctx.stroke();
    // 逐次事件编号
    ctx.fillStyle = '#ffd166';
    ctx.font = '11px sans-serif';
    r.events.forEach((e, i) => ctx.fillText(String(i + 1), px(e.point) + 4, pz(e.point) - 4));
  }

  function fillTable(r: TraceResult): void {
    table.innerHTML = '';
    const t = el('table', { class: 'grid' });
    t.append(el('tr', {}, ['#', '事件', '刻面', '入射角°', '折射/反射角°', '能量损失'].map(h => el('th', {}, [h]))));
    for (const e of r.events) {
      const kindText = e.kind === 'enter' ? '折射进入' : e.kind === 'tir' ? '全内反射' : '折射出射';
      t.append(el('tr', {}, [
        el('td', {}, [String(e.seq + 1)]),
        el('td', {}, [kindText]),
        el('td', {}, [e.facetName]),
        el('td', {}, [e.angleInDeg.toFixed(3)]),
        el('td', {}, [e.angleOutDeg.toFixed(3)]),
        el('td', {}, [(e.fresnelLoss * 100).toFixed(2) + '%']),
      ]));
    }
    table.append(t);
    const escText = r.escaped === 'up' ? '从冠部返回观察者' : r.escaped === 'down' ? '从亭部漏出(漏光)' : r.escaped === 'side' ? '从侧面逸出' : '未逸出';
    summary.textContent =
      `波长 ${r.wavelengthNm}nm,n=${r.ior.toFixed(4)};共 ${r.events.length} 次交互,${escText};剩余能量 ${(r.throughput * 100).toFixed(1)}%。` +
      ' 角度均为双精度计算,可与手算斯涅尔定律逐位核对。';
  }

  function refresh(): void {
    const r = run();
    drawPath(r);
    fillTable(r);
  }

  const ctrl = el('div', { class: 'form row' }, [
    numField({ label: '入射点 X', value: rayParams.x, min: -1, max: 1, step: 0.02, onChange: v => { rayParams.x = v; refresh(); } }),
    numField({ label: '入射点 Y', value: rayParams.y, min: -1, max: 1, step: 0.02, onChange: v => { rayParams.y = v; refresh(); } }),
    numField({ label: '入射仰角', value: rayParams.elevDeg, min: 5, max: 90, step: 0.5, unit: '°', onChange: v => { rayParams.elevDeg = v; refresh(); } }),
    numField({ label: '方位角', value: rayParams.azimDeg, min: 0, max: 360, step: 5, unit: '°', onChange: v => { rayParams.azimDeg = v; refresh(); } }),
    selectField('波长', [
      { value: '486.1', text: '486nm 蓝紫(F)' },
      { value: '589.3', text: '589nm 黄(D)' },
      { value: '656.3', text: '656nm 红(C)' },
    ], String(rayParams.lambda), v => { rayParams.lambda = parseFloat(v); refresh(); }),
  ]);
  // 点画布改入射点
  canvas.onclick = ev => {
    const rect = canvas.getBoundingClientRect();
    const s = canvas.width / 3.2;
    rayParams.x = ((ev.clientX - rect.left) * (canvas.width / rect.width) - canvas.width / 2) / s;
    rayParams.y = 0;
    refresh();
  };

  box.append(el('div', { class: 'cols' }, [el('div', {}, [canvas, summary]), el('div', {}, [ctrl, table])]));
  refresh();
}

/* ---------- ASET / IdealScope ---------- */
function showAset(box: HTMLElement, getModel: () => ReturnType<typeof modelOf>): void {
  const c1 = el('canvas', { class: 'scope' });
  const c2 = el('canvas', { class: 'scope' });
  const stats = el('div', { class: 'derived' });
  const run = el('div');

  function refresh(): void {
    const m = getModel();
    const s = { ...defaultAsetSettings(), ...state.aset };
    const aset = computeAset(m, s);
    const ideal = computeIdealScope(m, s);
    drawAset(aset, c1);
    drawIdeal(ideal, c2);
    stats.innerHTML = '';
    stats.append(
      el('div', { class: 'stat' }, [el('b', {}, ['红(直射)']), (aset.stats.red * 100).toFixed(1) + '%']),
      el('div', { class: 'stat' }, [el('b', {}, ['绿(环境)']), (aset.stats.green * 100).toFixed(1) + '%']),
      el('div', { class: 'stat' }, [el('b', {}, ['蓝(头影)']), (aset.stats.blue * 100).toFixed(1) + '%']),
      el('div', { class: 'stat leak' }, [el('b', {}, ['漏光(黑)']), (aset.stats.leak * 100).toFixed(1) + '%']),
    );
    run.innerHTML = '';
    run.append(el('p', { class: 'hint' }, [
      `分区口径:仰角 ≥${s.blueMinDeg}° 蓝(头部遮挡),${s.redMinDeg}–${s.blueMinDeg}° 红(直射光),<${s.redMinDeg}° 绿(环境光),亭部逸出为黑色漏光。` +
      '确定性采样,亭角 40.6°→41.2° 微调时漏光面积连续变化,可在「切工评级」页并排验证。',
    ]));
  }
  box.append(
    el('div', { class: 'scopes' }, [
      el('figure', {}, [c1, el('figcaption', {}, ['ASET 镜']) ]),
      el('figure', {}, [c2, el('figcaption', {}, ['IdealScope'])]),
    ]),
    stats, run,
  );
  refresh();
}

/* ---------- 八心八箭 ---------- */
function showHA(box: HTMLElement, getModel: () => ReturnType<typeof modelOf>): void {
  const cA = el('canvas', { class: 'scope' });
  const cH = el('canvas', { class: 'scope' });
  const info = el('div');
  const r = analyzeHeartsArrows(getModel());
  drawHA(r.arrows, cA);
  drawHA(r.hearts, cH);
  info.append(
    el('div', { class: 'derived' }, [
      el('div', { class: 'stat' }, [el('b', {}, ['对称度']), r.symmetryScore.toFixed(1) + ' / 100']),
      el('div', { class: 'stat' }, [el('b', {}, ['最差扇区']), `#${r.worstSector + 1}`]),
    ]),
  );
  if (r.blamedFacets.length > 0) {
    const t = el('table', { class: 'grid' });
    t.append(el('tr', {}, ['刻面', '法线偏差°'].map(h => el('th', {}, [h]))));
    for (const b of r.blamedFacets)
      t.append(el('tr', {}, [el('td', {}, [b.name]), el('td', {}, [b.deviationDeg.toFixed(3)])]));
    info.append(el('h3', {}, ['让心形歪掉的刻面(按偏差排序)']), t);
  } else {
    info.append(el('p', { class: 'hint' }, ['各刻面法线与对称理想值一致,心箭图案对称。']));
  }
  const sec = el('div', { class: 'sector-bars' });
  r.sectorScores.forEach((s, i) => {
    const bar = el('div', { class: 'bar' }, [el('span', {}, [`${i + 1}`])]);
    (bar as HTMLElement).style.setProperty('--v', String(s / 100));
    bar.title = `扇区 ${i + 1}: ${s.toFixed(0)}`;
    sec.append(bar);
  });
  info.append(el('h3', {}, ['8 扇区对称度']), sec);
  box.append(
    el('div', { class: 'scopes' }, [
      el('figure', {}, [cA, el('figcaption', {}, ['箭(台面朝上)'])]),
      el('figure', {}, [cH, el('figcaption', {}, ['心(亭部朝上)'])]),
    ]),
    info,
  );
}

/* ---------- 转台 ---------- */
function showTurntable(
  box: HTMLElement, getModel: () => ReturnType<typeof modelOf>, setRenderer: (r: GemRenderer) => void,
): void {
  const canvas = el('canvas', { class: 'turntable', width: '640', height: '480' });
  const status = el('p', { class: 'hint' });
  const r = new GemRenderer(canvas, getModel(), state.light);
  setRenderer(r);
  r.init().then(ok => {
    status.textContent = ok
      ? 'WebGPU 渲染中:刻面亮度由当前光源模型逐刻面计算,转动时闪烁点跟随刻面。'
      : '当前环境无 WebGPU,已退回 2D 线框模式(光学计算页不受影响)。';
    r.play();
    r.start();
  });
  box.append(
    el('div', { class: 'toolbar' }, [
      selectField('光源', [
        { value: 'daylight', text: '散射日光' },
        { value: 'spot', text: '柜台射灯' },
        { value: 'point', text: '单点光源' },
      ], state.light.kind, v => {
        state.light.kind = v as typeof state.light.kind;
        r.setLight(state.light);
      }),
      button('播放/暂停', () => { r.isPlaying ? r.pause() : r.play(); }),
    ]),
    canvas, status,
  );
}
