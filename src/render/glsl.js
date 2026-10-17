// Shared GLSL chunks and the global uniform set used by every custom shader.
import * as THREE from 'three';

export const GU = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.2).normalize() },
  uSunColor: { value: new THREE.Vector3(18, 17, 15) },     // direct sun irradiance (linear RGB)
  uSkyAmb: { value: new THREE.Vector3(0.6, 0.8, 1.1) },     // mean sky radiance, upper hemisphere
  uGroundAmb: { value: new THREE.Vector3(0.15, 0.15, 0.14) },
  uSkyTex: { value: null },
  uFogDensity: { value: 5.0e-5 },
  uFogHeight: { value: 2600 },
  uNoiseTex: { value: null },     // 256^2 RGBA tileable noise
  uWeatherTex: { value: null },   // cloud coverage map
  uNoise3D: { value: null },      // 64^3 Perlin-Worley
  uCloudBase: { value: 1700 },
  uCloudTop: { value: 3300 },
  uCloudCover: { value: 0.55 },
  uWeatherScale: { value: 60000 },
  uWind: { value: new THREE.Vector2(0, 0) },
  uThermal: { value: 0 },
  uNight: { value: 0 },
  uLightPos: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
  uLightCol: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
  uLogFar: { value: Math.log2(200001) },
  uCamPos: { value: new THREE.Vector3() },
};

export function pickU(...names) {
  const o = {};
  for (const n of names) o[n] = GU[n];
  return o;
}

export const GLSL_COMMON = /* glsl */`
#ifndef PI
#define PI 3.14159265359
#endif
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform sampler2D uSkyTex;
uniform float uFogDensity;
uniform float uFogHeight;
uniform float uThermal;
uniform float uNight;

vec2 dirToEquirect(vec3 d) {
  float u = atan(d.x, -d.z) * (0.5 / PI) + 0.5;
  float v = asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5;
  return vec2(u, v);
}
vec3 sampleSky(vec3 d) { return texture(uSkyTex, dirToEquirect(d)).rgb; }

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

// Exponential-height-fog aerial perspective, in-scatter taken from the sky radiance at the horizon
vec3 aerialPerspective(vec3 col, vec3 ro, vec3 rd, float dist) {
  float a = uFogDensity * exp(-max(ro.y, -100.0) / uFogHeight);
  float k = rd.y * dist / uFogHeight;
  float od = abs(k) > 1e-4 ? a * dist * (1.0 - exp(-k)) / k : a * dist;
  vec3 ext = exp(-od * vec3(0.8, 0.92, 1.12));
  vec3 dh = normalize(vec3(rd.x, max(rd.y, 0.0) * 0.6 + 0.015, rd.z));
  vec3 haze = sampleSky(dh);
  return col * ext + haze * (1.0 - ext);
}
float fogTransmittance(vec3 ro, vec3 rd, float dist) {
  float a = uFogDensity * exp(-max(ro.y, -100.0) / uFogHeight);
  float k = rd.y * dist / uFogHeight;
  float od = abs(k) > 1e-4 ? a * dist * (1.0 - exp(-k)) / k : a * dist;
  return exp(-od);
}
`;

export const GLSL_CLOUDS = /* glsl */`
uniform sampler2D uWeatherTex;
uniform highp sampler3D uNoise3D;
uniform float uCloudBase;
uniform float uCloudTop;
uniform float uCloudCover;
uniform float uWeatherScale;
uniform vec2 uWind;

float remap(float v, float lo, float hi, float nlo, float nhi) { return nlo + (v - lo) * (nhi - nlo) / (hi - lo); }

// coverage-only density used for shadows and cheap light marching
float cloudDensityLo(vec3 p) {
  float h = (p.y - uCloudBase) / (uCloudTop - uCloudBase);
  if (h <= 0.0 || h >= 1.0) return 0.0;
  vec2 wp = p.xz + uWind;
  vec4 w = texture(uWeatherTex, wp / uWeatherScale);
  float cov = clamp(w.r * uCloudCover * 1.25, 0.0, 1.0);
  if (cov < 0.02) return 0.0;
  float top = mix(0.45, 1.0, w.g);
  float grad = smoothstep(0.0, 0.1, h) * smoothstep(top, top * 0.55, h);
  vec4 n = texture(uNoise3D, vec3(wp.x, p.y * 1.6, wp.y) * 0.00019);
  float fbm = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float base = remap(n.r, -(1.0 - fbm), 1.0, 0.0, 1.0);
  base = clamp(base * grad, 0.0, 1.0);
  float c = clamp(remap(base, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0) * cov;
  return c;
}
float cloudDensityHi(vec3 p, float lod) {
  float c = cloudDensityLo(p);
  if (c <= 0.0) return 0.0;
  float h = (p.y - uCloudBase) / (uCloudTop - uCloudBase);
  vec2 wp = p.xz + uWind * 1.3;
  vec4 d = textureLod(uNoise3D, vec3(wp.x, p.y, wp.y) * 0.0021 + vec3(0.0, uTime * 0.004, 0.0), lod);
  float dfbm = d.g * 0.625 + d.b * 0.25 + d.a * 0.125;
  float eros = mix(dfbm, 1.0 - dfbm, clamp(h * 4.0, 0.0, 1.0));
  return clamp(remap(c, eros * 0.32, 1.0, 0.0, 1.0), 0.0, 1.0);
}
// sun shadow cast by the cloud deck onto a surface point
float cloudShadowAt(vec3 p) {
  if (uSunDir.y < 0.03) return 1.0;
  float od = 0.0;
  for (int i = 0; i < 3; i++) {
    float hy = mix(uCloudBase, uCloudTop, 0.15 + 0.3 * float(i));
    vec3 q = p + uSunDir * ((hy - p.y) / uSunDir.y);
    od += cloudDensityLo(q);
  }
  return mix(1.0, exp(-od * 2.6), smoothstep(0.03, 0.12, uSunDir.y));
}
`;

export const GLSL_ACES = /* glsl */`
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 ACESFitted(vec3 color) {
  const mat3 ACESIn = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOut = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = ACESIn * color; color = RRTAndODTFit(color); color = ACESOut * color;
  return clamp(color, 0.0, 1.0);
}
vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
`;

// Flash-light pool shared with three's PointLights (for custom shaders)
export const GLSL_LIGHTS = /* glsl */`
uniform vec3 uLightPos[4];
uniform vec3 uLightCol[4];
vec3 flashLights(vec3 p, vec3 n, vec3 albedo) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 L = uLightPos[i] - p; float d2 = dot(L, L) + 1.0;
    acc += uLightCol[i] * max(dot(n, L * inversesqrt(d2)), 0.0) / d2;
  }
  return acc * albedo;
}
`;

export const FULLSCREEN_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export function fullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}
