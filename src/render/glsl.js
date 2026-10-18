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
  uWeatherTex: { value: null },   // cloud weather map: r how cloudy, g cloud type, b darker cores
  uNoise3D: { value: null },      // 128^3 cloud shape: r Perlin-Worley, gba Worley fbm
  uNoiseDetail: { value: null },  // 32^3 cloud edge erosion: rgb Worley fbm
  uCloudBase: { value: 1400 },
  uCloudTop: { value: 4600 },
  uCloudCover: { value: 0.45 },
  uCloudDensity: { value: 1.0 },
  uWeatherScale: { value: 48000 },
  uWind: { value: new THREE.Vector2(0, 0) },
  // planar reflection of the world above the water, made by Pipeline for the ocean
  uReflTex: { value: null },
  uReflMat: { value: new THREE.Matrix4() },
  uReflOn: { value: 0 },
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

// Cloud density model (after Schneider's Nubis talks): a weather map says how likely cloud is and how tall it grows,
// a Perlin-Worley volume gives each cloud its billowing shape and a small Worley volume erodes the edges into wisps
// near the base and cauliflower curls near the top. cloudBulkCPU in clouds.js is the CPU copy: keep them in step.
export const GLSL_CLOUDS = /* glsl */`
uniform sampler2D uWeatherTex;
uniform highp sampler3D uNoise3D;
uniform highp sampler3D uNoiseDetail;
uniform float uCloudBase;
uniform float uCloudTop;
uniform float uCloudCover;
uniform float uCloudDensity;
uniform float uWeatherScale;
uniform vec2 uWind;
#define CLOUD_SHAPE_SCALE 7600.0
#define CLOUD_DETAIL_SCALE 560.0
#define CLOUD_SIGMA 0.07

float remap(float v, float lo, float hi, float nlo, float nhi) { return nlo + (v - lo) * (nhi - nlo) / (hi - lo); }
// the share of this column that is cloud for the current weather. Weather r is spread evenly over 0..1 and the
// ramp is gentle, so the shape noise rather than the map's outline gives each cloud its form (a steep ramp drew
// the map's texels as vertical flutes down the cloud walls)
float cloudCoverage(float r) { return clamp(uCloudCover + (r - 0.5) * 1.3 * min(uCloudCover * 4.0, 1.0), 0.0, 1.0); }
// vertical profile: a flat base that thickens quickly, a rounded top whose height depends on the cloud type
float cloudProfile(float h, float type) {
  float top = mix(0.3, 1.0, type);
  return smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(top * 0.3, top, h));
}
// the cloud's bulk shape (no edge detail); hf = height fraction in the layer. The baked shape noise is spread over
// 0..1, and only what pokes above the coverage threshold is cloud.
float cloudShape(vec3 p, float lod, out float hf) {
  hf = (p.y - uCloudBase) / (uCloudTop - uCloudBase);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  vec2 q = p.xz + uWind;
  vec4 w = textureLod(uWeatherTex, q / uWeatherScale, 0.0);
  float cov = cloudCoverage(w.r);
  if (cov <= 0.001) return 0.0;
  if (cloudProfile(hf, w.g) <= 0.0) return 0.0;
  float n = textureLod(uNoise3D, vec3(q.x, p.y, q.y) / CLOUD_SHAPE_SCALE, lod).r;
  // the thin outskirts of a cloud start higher and end lower than its core: rounded bellies and domes
  float prof = cloudProfile(hf - (1.0 - n) * 0.1, w.g);
  return max(n * prof - (1.0 - cov), 0.0) * (0.75 + 0.5 * w.b);
}
// the shape eaten away at the edges by the detail volume
float cloudErode(vec3 p, float base, float hf, float lod) {
  vec3 q = vec3(p.x + uWind.x * 1.12, p.y - uTime * 0.8, p.z + uWind.y * 1.12) / CLOUD_DETAIL_SCALE;
  vec3 d = textureLod(uNoiseDetail, q, lod).rgb;
  float hfbm = dot(d, vec3(0.5, 0.3, 0.2));
  float m = mix(hfbm, 1.0 - hfbm, clamp(hf * 5.0, 0.0, 1.0));
  // eaten deeper near the base: ragged undersides instead of one smooth grey ceiling
  float e = m * mix(0.45, 0.3, smoothstep(0.0, 0.25, hf));
  return max(base - e, 0.0) / (1.0 - e);
}
// a real cumulus ends in a sharp boundary: thin density thickens fast and the inside saturates
float cloudCrisp(float x) { return 1.0 - exp(-x * 5.0); }
float cloudDensity(vec3 p, float lod) {
  float hf; float b = cloudShape(p, lod, hf);
  return b > 0.0 ? cloudErode(p, b, hf, lod) : 0.0;
}
// bulk density only: shadows, light marching, particle occlusion
float cloudDensityLo(vec3 p) { float hf; return cloudShape(p, 1.0, hf); }
// sun shadow cast by the cloud layer onto a surface point (light still leaks through thin cloud)
float cloudShadowAt(vec3 p) {
  if (uSunDir.y < 0.03 || uCloudCover < 0.01) return 1.0;
  float th = uCloudTop - uCloudBase, od = 0.0;
  float seg = th * 0.25 / uSunDir.y;
  for (int i = 0; i < 4; i++) {
    float hy = uCloudBase + th * (0.08 + 0.22 * float(i));
    vec3 q = p + uSunDir * ((hy - p.y) / uSunDir.y);
    od += cloudDensityLo(q) * min(seg, 1600.0);
  }
  float T = exp(-od * CLOUD_SIGMA * uCloudDensity * 0.08);
  return mix(1.0, 0.16 + 0.84 * T, smoothstep(0.03, 0.12, uSunDir.y));
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
