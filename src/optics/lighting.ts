/**
 * 光源模型:柜台射灯 / 散射日光 / 单点光源。
 * 以方向分布表示:给定出射方向(单位向量,指向天空)返回辐射亮度权重。
 * 观察者头部遮挡:仰角高于 headShadowDeg 的天区被头挡住。
 */
import { Vec3 } from '../core/vec3';

export type LightKind = 'spot' | 'daylight' | 'point';

export interface LightSettings {
  kind: LightKind;
  headShadowDeg: number;   // 头部遮挡起始仰角(默认 75)
  spotElevDeg: number;     // 射灯仰角(默认 55)
  spotCount: number;       // 射灯数量(绕方位均布)
  pointElevDeg: number;    // 单点光源仰角
  pointAzimDeg: number;    // 单点光源方位
}

export const defaultLight = (): LightSettings => ({
  kind: 'daylight', headShadowDeg: 75, spotElevDeg: 55, spotCount: 4,
  pointElevDeg: 60, pointAzimDeg: 30,
});

const DEG = Math.PI / 180;

/** 方向 d(指向天空)处的光源亮度 */
export function radiance(d: Vec3, s: LightSettings): number {
  const elev = Math.asin(Math.min(1, Math.max(-1, d.z))) / DEG;
  if (elev < 0) return 0;
  if (elev >= s.headShadowDeg) return 0.06; // 头部遮挡:只剩环境余光
  switch (s.kind) {
    case 'daylight':
      return 0.55 + 0.45 * Math.sin(elev * DEG); // 余弦加权半球
    case 'point': {
      const px = Math.cos(s.pointElevDeg * DEG) * Math.cos(s.pointAzimDeg * DEG);
      const py = Math.cos(s.pointElevDeg * DEG) * Math.sin(s.pointAzimDeg * DEG);
      const pz = Math.sin(s.pointElevDeg * DEG);
      const cosA = d.x * px + d.y * py + d.z * pz;
      const ang = Math.acos(Math.min(1, Math.max(-1, cosA))) / DEG;
      return ang < 3 ? 1 : 0.03; // 3° 锐光源 + 微弱环境
    }
    case 'spot': {
      let best = 0;
      for (let k = 0; k < s.spotCount; k++) {
        const az = k * 2 * Math.PI / s.spotCount;
        const px = Math.cos(s.spotElevDeg * DEG) * Math.cos(az);
        const py = Math.cos(s.spotElevDeg * DEG) * Math.sin(az);
        const pz = Math.sin(s.spotElevDeg * DEG);
        const cosA = d.x * px + d.y * py + d.z * pz;
        const ang = Math.acos(Math.min(1, Math.max(-1, cosA))) / DEG;
        best = Math.max(best, ang < 12 ? 1 : 0);
      }
      return best > 0 ? 1 : 0.12; // 射灯锥 + 店铺环境光
    }
  }
}
