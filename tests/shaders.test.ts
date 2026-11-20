/**
 * WGSL 着色器静态校验:解析全部着色器源码,确保语法有效、
 * 入口函数和绑定存在(本机无 GPU 环境,以此替代编译验证)。
 */
import { describe, it, expect } from 'vitest';
import { RENDER_WGSL, RENDER_MAIN_WGSL, VERIFY_WGSL, MESH_WGSL, TRACE_WGSL, ENV_WGSL } from '../src/render/shaders';

// wgsl_reflect 的 ESM 入口(module 字段)是真正的 ESM,用它
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';

describe('WGSL 着色器', () => {
  it('渲染管线:语法有效且有 vs/fs 入口', () => {
    const code = RENDER_WGSL + RENDER_MAIN_WGSL;
    const reflect = new WgslReflect(code);
    const entryNames = [...reflect.entry.vertex, ...reflect.entry.fragment].map((e) => e.name);
    expect(entryNames).toContain('vs');
    expect(entryNames).toContain('fs');
    // 绑定:uniform sim + storage planesBuf
    expect(reflect.uniforms.map((u) => u.name)).toContain('sim');
    expect(reflect.storage.map((s) => s.name)).toContain('planesBuf');
  });

  it('核对计算着色器:语法有效且有 main 入口', () => {
    const reflect = new WgslReflect(VERIFY_WGSL);
    expect(reflect.entry.compute.map((e) => e.name)).toContain('main');
    expect(reflect.storage.map((s) => s.name)).toContain('result');
  });

  it('网格着色器:语法有效', () => {
    const reflect = new WgslReflect(MESH_WGSL);
    expect(reflect.entry.vertex.map((e) => e.name)).toContain('vs');
    expect(reflect.entry.fragment.map((e) => e.name)).toContain('fs');
  });

  it('追踪核心包含斯涅尔折射与菲涅尔函数', () => {
    expect(TRACE_WGSL).toContain('fn snellRefract');
    expect(TRACE_WGSL).toContain('fn fresnelUnpolarized');
    expect(TRACE_WGSL).toContain('fn traceGem');
    expect(ENV_WGSL).toContain('fn envColor');
  });
});
