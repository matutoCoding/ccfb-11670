declare module 'wgsl_reflect/wgsl_reflect.module.js' {
  export class WgslReflect {
    constructor(code: string);
    entry: {
      vertex: Array<{ name: string }>;
      fragment: Array<{ name: string }>;
      compute: Array<{ name: string }>;
    };
    uniforms: Array<{ name: string }>;
    storage: Array<{ name: string }>;
  }
}
