// Volumetric clouds. The noise volumes are baked on the GPU at start-up, the weather map on the CPU (the game reads
// it back for its own cloud checks). CloudRenderer raymarches the layer at reduced resolution with a per-frame
// jittered start, then a temporal pass reprojects last frame's result and blends it in, so a modest step count
// gives a smooth picture. The same renderer draws the clouds the ocean reflects (mirror: rays start at the sea).
import * as THREE from 'three';
import { GU, GLSL_COMMON, GLSL_CLOUDS, FULLSCREEN_VS, fullscreenTriangle } from './glsl.js';
import { mulberry32 } from '../core/noise.js';

const HALF = THREE.HalfFloatType;

// periodic 2D gradient noise for tileable textures
function periodicNoise2D(period, seed) {
  const rnd = mulberry32(seed);
  const g = new Float32Array(period * period * 2);
  for (let i = 0; i < period * period; i++) { const a = rnd() * Math.PI * 2; g[i * 2] = Math.cos(a); g[i * 2 + 1] = Math.sin(a); }
  return (x, y) => { // x,y in [0,1)
    const fx = x * period, fy = y * period; const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const gr = (cx, cy, dx, dy) => { const k = ((((cy % period) + period) % period) * period + (((cx % period) + period) % period)) * 2; return g[k] * dx + g[k + 1] * dy; };
    const u = tx * tx * tx * (tx * (tx * 6 - 15) + 10), v = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
    const a = gr(ix, iy, tx, ty), b = gr(ix + 1, iy, tx - 1, ty), c = gr(ix, iy + 1, tx, ty - 1), d = gr(ix + 1, iy + 1, tx - 1, ty - 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  };
}
function periodicFbm(seed, basePeriod, oct) {
  const layers = []; for (let o = 0; o < oct; o++) layers.push(periodicNoise2D(basePeriod << o, seed + o * 101));
  return (x, y) => { let s = 0, a = 1, n = 0; for (const L of layers) { s += a * L(x, y); n += a; a *= 0.5; } return s / n; };
}
// tileable 2D Worley: 1 at a cell's feature point falling to 0 between cells
function periodicCells(cells, seed) {
  const rnd = mulberry32(seed); const pts = new Float32Array(cells * cells * 2);
  for (let i = 0; i < pts.length; i++) pts[i] = rnd();
  return (x, y) => {
    const fx = x * cells, fy = y * cells, ix = Math.floor(fx), iy = Math.floor(fy); let md = 9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, k = ((((cy % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells)) * 2;
      const px = cx + pts[k] - fx, py = cy + pts[k + 1] - fy; md = Math.min(md, px * px + py * py);
    }
    return Math.max(0, 1 - Math.sqrt(md));
  };
}

export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const f0 = periodicFbm(11, 4, 5), f1 = periodicFbm(23, 8, 5), f2 = periodicFbm(37, 16, 4), f3 = periodicFbm(51, 32, 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4;
    data[i] = Math.round((f0(u, v) * 0.5 + 0.5) * 255);
    data[i + 1] = Math.round((f1(u, v) * 0.5 + 0.5) * 255);
    data[i + 2] = Math.round((f2(u, v) * 0.5 + 0.5) * 255);
    data[i + 3] = Math.round((f3(u, v) * 0.5 + 0.5) * 255);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

// Weather map. r: how much this spot wants to be cloud, histogram-equalised so that a cover setting of c clouds
// about a fraction c of the sky. Clouds come in clumps (cells about 5 km across) inside regions of more and less
// cloud. g: cloud type (flat stratocumulus 0 .. towering cumulus 1), taller where the clumps are thick. b: darker,
// denser cores.
export function makeWeatherTexture(size = 512, seed = 3) {
  const N = size * size;
  const region = periodicFbm(seed, 2, 3), mid = periodicFbm(seed + 9, 12, 3), cells = periodicCells(9, seed + 5), small = periodicCells(23, seed + 6);
  const typ = periodicFbm(seed + 17, 3, 3), core = periodicFbm(seed + 29, 16, 2);
  const raw = new Float32Array(N), ty = new Float32Array(N), co = new Float32Array(N);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const c = cells(u, v), s = small(u, v);
    raw[i] = region(u, v) * 0.9 + c * 0.75 + s * 0.35 + mid(u, v) * 0.45;
    ty[i] = Math.min(1, Math.max(0, 0.5 + typ(u, v) * 1.6 + (c - 0.45) * 0.9));
    co[i] = Math.min(1, Math.max(0, 0.5 + core(u, v) * 1.4));
  }
  const order = Array.from(raw.keys()).sort((a, b) => raw[a] - raw[b]);
  const data = new Uint8Array(N * 4);
  for (let k = 0; k < N; k++) data[order[k] * 4] = Math.round(k / (N - 1) * 255);
  for (let i = 0; i < N; i++) { data[i * 4 + 1] = Math.round(ty[i] * 255); data[i * 4 + 2] = Math.round(co[i] * 255); data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// CPU copy of the shape noise (its 32^3 mip, read back once after the bake); null until then
let shapeCPU = null;
const SHAPE_N = 32, SHAPE_SCALE = 7600;
function shapeNoiseCPU(x, y, z) {
  if (!shapeCPU) return 0.55;
  const N = SHAPE_N, fx = x / SHAPE_SCALE * N - 0.5, fy = y / SHAPE_SCALE * N - 0.5, fz = z / SHAPE_SCALE * N - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz), tx = fx - ix, ty = fy - iy, tz = fz - iz;
  const at = (a, b, c) => shapeCPU[((((c % N) + N) % N) * N + (((b % N) + N) % N)) * N + (((a % N) + N) % N)];
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(at(ix, iy, iz), at(ix + 1, iy, iz), tx), L(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), tx), ty),
    L(L(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), tx), L(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), tx), ty), tz) / 255;
}
const ss = (e0, e1, t) => { const k = Math.min(1, Math.max(0, (t - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };
// the GLSL cloudShape density (without the edge erosion), for game logic that needs to know how much cloud lies
// along a line or around a point
export function cloudBulkCPU(data, size, x, y, z) {
  const base = GU.uCloudBase.value, top = GU.uCloudTop.value, C = GU.uCloudCover.value;
  const hf = (y - base) / (top - base); if (hf <= 0 || hf >= 1 || C <= 0.005) return 0;
  const S = GU.uWeatherScale.value, w = GU.uWind.value, qx = x + w.x, qz = z + w.y;
  let u = (qx / S) % 1; if (u < 0) u += 1; let v = (qz / S) % 1; if (v < 0) v += 1;
  const i = (Math.floor(v * size) * size + Math.floor(u * size)) * 4;
  const cov = Math.min(1, Math.max(0, C + (data[i] / 255 - 0.5) * 1.3 * Math.min(C * 4, 1))); if (cov <= 0) return 0;
  const tp = 0.3 + 0.7 * data[i + 1] / 255, n = shapeNoiseCPU(qx, y, qz), h = hf - (1 - n) * 0.1;
  const prof = ss(0, 0.1, h) * (1 - ss(tp * 0.3, tp, h));
  return Math.max(0, n * prof + cov - 1) * (0.75 + 0.5 * data[i + 2] / 255) * GU.uCloudDensity.value;
}

// ---- noise volumes, baked on the GPU one slice at a time ----
const NOISE_GLSL = /* glsl */`
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// tileable gradient noise, period per in lattice cells, about -1..1
float gnoise(vec3 x, float per) {
  vec3 i = floor(x), f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define GR(o) dot(hash33(mod(i + o, per)) * 2.0 - 1.0, f - o)
  float a = GR(vec3(0, 0, 0)), b = GR(vec3(1, 0, 0)), c = GR(vec3(0, 1, 0)), d = GR(vec3(1, 1, 0));
  float e = GR(vec3(0, 0, 1)), g = GR(vec3(1, 0, 1)), h = GR(vec3(0, 1, 1)), k = GR(vec3(1, 1, 1));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z) * 1.6;
}
// tileable Worley: 1 at feature points, 0 far from them
float worley(vec3 x, float per) {
  vec3 i = floor(x), f = fract(x); float d = 1.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int xx = -1; xx <= 1; xx++) {
    vec3 o = vec3(float(xx), float(y), float(z));
    vec3 r = o + hash33(mod(i + o, per) + 0.5) - f;
    d = min(d, dot(r, r));
  }
  return 1.0 - sqrt(d);
}
`;

function bakeVolume(renderer, size, fragment) {
  const rt = new THREE.WebGL3DRenderTarget(size, size, size, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: false,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  });
  const tex = rt.texture; tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uZ: { value: 0 } }, vertexShader: FULLSCREEN_VS, depthTest: false, depthWrite: false,
    fragmentShader: `uniform float uZ; varying vec2 vUv;\n${NOISE_GLSL}\n${fragment}`,
  });
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(fullscreenTriangle(), mat); quad.frustumCulled = false; scene.add(quad);
  const prev = renderer.getRenderTarget();
  for (let z = 0; z < size; z++) {
    // the mip chain is built once, after the last slice
    if (z === size - 1) tex.generateMipmaps = true;
    mat.uniforms.uZ.value = (z + 0.5) / size;
    renderer.setRenderTarget(rt, z); renderer.render(scene, cam);
  }
  renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose();
  return rt;
}

// reads the shape volume's 32^3 mip back into shapeCPU: one draw into a 32 x 1024 strip of slices, one readback
function readShapeCPU(renderer, tex) {
  const N = SHAPE_N;
  const rt = new THREE.WebGLRenderTarget(N, N * N, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false });
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex } }, vertexShader: FULLSCREEN_VS, depthTest: false, depthWrite: false,
    fragmentShader: /* glsl */`
      uniform highp sampler3D uTex; varying vec2 vUv;
      void main() {
        float z = floor(gl_FragCoord.y / ${N}.0);
        vec2 xy = vec2(gl_FragCoord.x, mod(gl_FragCoord.y, ${N}.0)) / ${N}.0;
        gl_FragColor = vec4(textureLod(uTex, vec3(xy, (z + 0.5) / ${N}.0), ${Math.log2(128 / N)}.0).r);
      }`,
  });
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(fullscreenTriangle(), mat); quad.frustumCulled = false; scene.add(quad);
  const prev = renderer.getRenderTarget(), buf = new Uint8Array(N * N * N * 4);
  renderer.setRenderTarget(rt); renderer.render(scene, cam);
  renderer.readRenderTargetPixels(rt, 0, 0, N, N * N, buf);
  renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose(); rt.dispose();
  const out = new Uint8Array(N * N * N); let sum = 0;
  for (let i = 0; i < out.length; i++) { out[i] = buf[i * 4]; sum += out[i]; }
  shapeCPU = sum > 0 ? out : null;
}

export function initCloudTextures(renderer) {
  GU.uNoiseTex.value = makeNoiseTexture(256);
  GU.uWeatherTex.value = makeWeatherTexture(512, 3);
  if (!renderer) return;
  // shape: r billows, a Perlin-Worley (Perlin fbm lifted by a Worley fbm floor) dilated by a finer Worley fbm and
  // spread over 0..1; g Worley fbm, b Perlin fbm, a fine Worley
  GU.uNoise3D.value = bakeVolume(renderer, 128, /* glsl */`
    void main() {
      vec3 p = vec3(vUv, uZ);
      float pf = gnoise(p * 4.0, 4.0) * 0.6 + gnoise(p * 8.0, 8.0) * 0.28 + gnoise(p * 16.0, 16.0) * 0.12;
      pf = clamp(pf * 0.62 + 0.5, 0.0, 1.0);
      float w4 = worley(p * 4.0, 4.0), w8 = worley(p * 8.0, 8.0), w16 = worley(p * 16.0, 16.0), w32 = worley(p * 32.0, 32.0);
      float wf = w4 * 0.625 + w8 * 0.25 + w16 * 0.125;
      float pw = clamp(wf + pf * (1.0 - wf) - 0.35 * (1.0 - pf), 0.0, 1.0);
      float fb = (w8 * 0.625 + w16 * 0.25 + w32 * 0.125) * 0.625 + (w16 * 0.75 + w32 * 0.25) * 0.25 + w32 * 0.125;
      float nr = (pw - (fb - 1.0)) / (2.0 - fb);
      // nr sits in about 0.58..0.84; stretched so that the coverage threshold cuts through the billows
      gl_FragColor = vec4(clamp((nr - 0.52) / 0.36, 0.0, 1.0), wf, pf, w32);
    }`).texture;
  try { readShapeCPU(renderer, GU.uNoise3D.value); } catch (e) { shapeCPU = null; }
  // detail: rgb Worley fbm at three frequencies
  GU.uNoiseDetail.value = bakeVolume(renderer, 32, /* glsl */`
    void main() {
      vec3 p = vec3(vUv, uZ);
      float w2 = worley(p * 2.0, 2.0), w4 = worley(p * 4.0, 4.0), w8 = worley(p * 8.0, 8.0), w16 = worley(p * 16.0, 16.0);
      gl_FragColor = vec4(w2 * 0.625 + w4 * 0.25 + w8 * 0.125, w4 * 0.625 + w8 * 0.25 + w16 * 0.125, w8 * 0.75 + w16 * 0.25, 1.0);
    }`).texture;
}

// ---- raymarch + temporal resolve ----
function makeMarchMaterial() {
  const u = {};
  for (const n of ['uTime', 'uSunDir', 'uSunColor', 'uSkyAmb', 'uGroundAmb', 'uSkyTex', 'uFogDensity', 'uFogHeight', 'uThermal', 'uNight',
    'uWeatherTex', 'uNoise3D', 'uNoiseDetail', 'uCloudBase', 'uCloudTop', 'uCloudCover', 'uCloudDensity', 'uWeatherScale', 'uWind', 'uLogFar']) u[n] = GU[n];
  Object.assign(u, {
    uDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
    uCamPosC: { value: new THREE.Vector3() }, uSteps: { value: 48 }, uLightSteps: { value: 6 }, uFrame: { value: 0 }, uMirror: { value: 0 },
    uMaxDist: { value: 60000 }, uPlumePos: { value: new THREE.Vector3(0, -1e6, 0) }, uPlumeCol: { value: new THREE.Vector3() },
  });
  return new THREE.ShaderMaterial({
    uniforms: u, glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VS,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_CLOUDS}
      uniform sampler2D uDepth; uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform vec3 uCamPosC;
      uniform float uLogFar; uniform int uSteps; uniform int uLightSteps; uniform float uFrame; uniform float uMirror; uniform float uMaxDist;
      uniform vec3 uPlumePos; uniform vec3 uPlumeCol;
      varying vec2 vUv;
      layout(location = 0) out vec4 oColor;   // rgb in-scattered light, a transmittance
      layout(location = 1) out vec4 oAux;     // r distance to the cloud (km), for reprojection
      float hg(float mu, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5)); }
      // strong forward lobe (the silver lining toward the sun) plus some back-scatter; k softens it for the
      // multiple-scattering octaves
      float phase2(float mu, float k) { return mix(hg(mu, 0.82 * k), hg(mu, -0.22 * k), 0.3); }
      void main() {
        vec4 vr = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 vdir = normalize(vr.xyz / vr.w);
        vec3 rd = normalize(mat3(uCamWorld) * vdir);
        vec3 ro = uCamPosC;
        float d = texture(uDepth, vUv).r;
        float sceneDist = d < 0.999999 ? (exp2(d * uLogFar) - 1.0) / max(-vdir.z, 1e-4) : 1e9;
        // the mirror camera sits under the sea: its rays start where they come out of the water
        float tw = 0.0;
        if (uMirror > 0.5) {
          if (rd.y < 1e-4) { oColor = vec4(0.0, 0.0, 0.0, 1.0); oAux = vec4(30.0); return; }
          tw = max(-ro.y / rd.y, 0.0);
        }
        float t0, t1;
        if (abs(rd.y) < 1e-5) {
          t0 = ro.y > uCloudBase && ro.y < uCloudTop ? 0.0 : 1e9; t1 = 1e9;
        } else {
          float ta = (uCloudBase - ro.y) / rd.y, tb = (uCloudTop - ro.y) / rd.y;
          t0 = min(ta, tb); t1 = max(ta, tb);
        }
        t0 = max(t0, tw);
        t1 = min(t1, min(sceneDist, uMaxDist + tw));
        float repro = clamp(t0 < 1e8 ? t0 : 30000.0, 50.0, min(sceneDist, 60000.0));
        if (t1 <= t0 || uCloudCover < 0.005) { oColor = vec4(0.0, 0.0, 0.0, 1.0); oAux = vec4(repro / 1000.0); return; }
        float len = t1 - t0;
        // steps grow with distance (a far cloud covers fewer pixels) but never beyond an even split of the path;
        // the growth is set so the step budget reaches about 50 km from inside the layer
        float stepMax = max(len / float(uSteps), 30.0), stepK = 2.0 / float(uSteps);
        // per pixel a golden-ratio sequence from a random start: a structured start (IGN) left its pattern behind in
        // the accumulated picture as stripes
        float jitter = fract(hash12(gl_FragCoord.xy) + uFrame * 0.618034);
        float t = t0 + min(30.0 + t0 * stepK, stepMax) * jitter;
        float mu = dot(rd, uSunDir);
        float ph0 = phase2(mu, 1.0), ph1 = phase2(mu, 0.55), ph2 = phase2(mu, 0.3);
        float sunVis = smoothstep(-0.05, 0.04, uSunDir.y);
        vec3 sunC = uSunColor * sunVis * 2.2;
        vec3 ambTop = uSkyAmb * 1.05 + uSunColor * 0.004 * sunVis;
        vec3 ambBot = uSkyAmb * 0.22 + uGroundAmb * 0.55;
        vec3 scat = vec3(0.0); float T = 1.0; float tSum = 0.0, wSum = 0.0;
        // empty air is crossed two steps at a time. The samples must stay on the jittered grid (a longer stride
        // left bands along the cloud edges), so on finding cloud the march goes back to the point it skipped.
        float tBack = -1.0; bool single = false;
        for (int i = 0; i < 256; i++) {
          if (i >= uSteps * 2 || t > t1 || T < 0.008) break;
          float stepL = min(30.0 + t * stepK, stepMax);
          vec3 p = ro + rd * t;
          // mips only where a texel of the volume gets smaller than a pixel (blurrier ones turned clouds to cotton)
          float lod = clamp(log2(t / 10000.0), 0.0, 2.0), lodD = clamp(log2(t / 7000.0), 0.0, 1.5);
          float hf; float b = cloudShape(p, lod, hf);
          if (b <= 0.0) {
            if (single) { single = false; t += stepL; continue; }
            tBack = t + stepL; t = tBack + min(30.0 + tBack * stepK, stepMax); continue;
          }
          if (tBack > 0.0) { t = tBack; tBack = -1.0; single = true; continue; }
          single = false;
          float dens = cloudCrisp(t < 26000.0 ? cloudErode(p, b, hf, lodD) : b * 0.8) * uCloudDensity;
          if (dens > 0.002) {
            float ext = dens * CLOUD_SIGMA;
            // in cloud the step shrinks toward a mean free path: the picture of a dense cloud is made in its first
            // few hundred metres, and long steps there left bands that no jitter could average away
            float sl = clamp(0.7 / ext, stepL * 0.25, stepL);
            // optical depth toward the sun: short steps first, then ever longer ones
            float od = 0.0, lt = 0.0, seg = 34.0;
            for (int j = 0; j < 6; j++) {
              if (j >= uLightSteps) break;
              vec3 q = p + uSunDir * (lt + seg * 0.5);
              float hq; float lq = cloudShape(q, 1.0 + float(j) * 0.4, hq);
              if (j < 2 && lq > 0.0) lq = cloudErode(q, lq, hq, 1.0);
              od += cloudCrisp(lq) * seg; lt += seg; seg *= 1.95;
            }
            od *= CLOUD_SIGMA * uCloudDensity;
            // multiple scattering as octaves of ever softer extinction and phase (Wrenninge). The last stands for the
            // light that has diffused through kilometres of cloud and lights the bases from inside: diffusion lets
            // through about 1 / (1 + 0.75 tau (1 - g)), far more than any exponential, so thin spots in a deck glow
            float sunT = ph0 * exp(-od) + 0.6 * ph1 * exp(-od * 0.25) + 0.5 * ph2 / (1.0 + 0.08 * od);
            // powder: the dark crevices and edges of a dense cloud seen with the sun behind you
            float powder = 1.0 - exp(-ext * 90.0);
            sunT *= mix(1.0, powder, 0.65 * clamp(0.6 - 0.6 * mu, 0.0, 1.0));
            // sky light reaches the tops better than the bases
            vec3 amb = mix(ambBot, ambTop, smoothstep(0.0, 0.85, hf)) * (0.55 + 0.45 * exp(-od * 0.15));
            vec3 pl = uPlumePos - p;
            vec3 plume = uPlumeCol * 4.0e4 / (dot(pl, pl) + 2500.0);
            vec3 S = (sunC * sunT + amb + plume) * ext;
            float Tr = exp(-ext * sl);
            scat += T * (S - S * Tr) / ext;
            float wgt = T * (1.0 - Tr); tSum += t * wgt; wSum += wgt;
            T *= Tr;
            t += sl;
            continue;
          }
          t += stepL;
        }
        float md = wSum > 0.0 ? tSum / wSum : repro;
        if (wSum > 0.0) {
          // aerial perspective between the eye (or the sea surface) and the cloud
          vec3 fo = ro + rd * tw;
          float fT = fogTransmittance(fo, rd, max(md - tw, 0.0));
          vec3 dh = normalize(vec3(rd.x, max(rd.y, 0.0) * 0.6 + 0.015, rd.z));
          scat = scat * fT + sampleSky(dh) * (1.0 - T) * (1.0 - fT);
        }
        if (uThermal > 0.5) scat = vec3(0.18) * (1.0 - T);
        oColor = vec4(scat, T);
        oAux = vec4(md / 1000.0);
      }`,
    depthTest: false, depthWrite: false,
  });
}

function makeResolveMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCur: { value: null }, uAux: { value: null }, uHist: { value: null }, uPrevVP: { value: new THREE.Matrix4() },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPosC: { value: new THREE.Vector3() },
      uTexel: { value: new THREE.Vector2() }, uBlend: { value: 0 },
    },
    vertexShader: FULLSCREEN_VS,
    fragmentShader: /* glsl */`
      uniform sampler2D uCur; uniform sampler2D uAux; uniform sampler2D uHist; uniform mat4 uPrevVP;
      uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform vec3 uCamPosC; uniform vec2 uTexel; uniform float uBlend;
      varying vec2 vUv;
      void main() {
        vec4 c = texture(uCur, vUv);
        // the current frame's 3x3 neighbourhood: history outside mean +- 1.25 sigma is clipped (no ghosts)
        vec4 m1 = vec4(0.0), m2 = vec4(0.0);
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec4 s = texture(uCur, vUv + vec2(float(x), float(y)) * uTexel); m1 += s; m2 += s * s;
        }
        m1 /= 9.0; m2 /= 9.0;
        vec4 sd = sqrt(max(m2 - m1 * m1, 0.0));
        float md = texture(uAux, vUv).r * 1000.0;
        vec4 vr = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 rd = normalize(mat3(uCamWorld) * normalize(vr.xyz / vr.w));
        vec4 pc = uPrevVP * vec4(uCamPosC + rd * md, 1.0);
        vec2 puv = pc.xy / max(pc.w, 1e-4) * 0.5 + 0.5;
        float ok = uBlend * step(0.0, pc.w) * step(0.0, puv.x) * step(puv.x, 1.0) * step(0.0, puv.y) * step(puv.y, 1.0);
        vec4 h = clamp(texture(uHist, puv), m1 - sd * 1.25 - 0.002, m1 + sd * 1.25 + 0.002);
        gl_FragColor = mix(c, h, ok);
      }`,
    depthTest: false, depthWrite: false,
  });
}

export class CloudRenderer {
  constructor(renderer, { steps = 48, lightSteps = 6, temporal = true, mirror = false } = {}) {
    this.r = renderer; this.steps = steps; this.lightSteps = lightSteps; this.temporal = temporal; this.mirror = mirror;
    this.march = makeMarchMaterial(); this.resolve = makeResolveMaterial();
    this.march.uniforms.uMirror.value = mirror ? 1 : 0;
    this.prevVP = new THREE.Matrix4(); this.prevPos = new THREE.Vector3(); this.histOK = false; this.histN = 0; this.frame = 0; this.ping = 0;
    this.texture = null; this.w = 0; this.h = 0;
  }

  setSize(w, h) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    for (const rt of [this.mrt, ...(this.hist || [])]) if (rt) rt.dispose();
    const o = { type: HALF, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false };
    this.mrt = new THREE.WebGLRenderTarget(w, h, { ...o, count: 2 });
    this.mrt.textures[1].minFilter = this.mrt.textures[1].magFilter = THREE.NearestFilter;
    this.hist = [new THREE.WebGLRenderTarget(w, h, o), new THREE.WebGLRenderTarget(w, h, o)];
    this.histOK = false;
    this.texture = this.mrt.textures[0];
  }

  // camera: the (possibly mirrored) view; depth: its scene depth texture; pass(material, target) draws a quad
  render(camera, depth, pass, plume) {
    this.frame++;
    camera.updateMatrixWorld();
    const u = this.march.uniforms;
    u.uDepth.value = depth; u.uInvProj.value.copy(camera.projectionMatrixInverse); u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamPosC.value.copy(camera.position); u.uSteps.value = this.steps; u.uLightSteps.value = this.lightSteps;
    u.uFrame.value = this.temporal ? this.frame % 4096 : 0;
    if (plume) { u.uPlumePos.value.copy(plume.pos); u.uPlumeCol.value.copy(plume.col); }
    pass(this.march, this.mrt);
    if (!this.temporal) { this.texture = this.mrt.textures[0]; return this.texture; }
    const ru = this.resolve.uniforms;
    // a jump of the camera (respawn, view change) starts the history over
    const jumped = camera.position.distanceTo(this.prevPos) > 600;
    ru.uCur.value = this.mrt.textures[0]; ru.uAux.value = this.mrt.textures[1]; ru.uHist.value = this.hist[this.ping].texture;
    ru.uPrevVP.value.copy(this.prevVP); ru.uInvProj.value.copy(camera.projectionMatrixInverse); ru.uCamWorld.value.copy(camera.matrixWorld);
    ru.uCamPosC.value.copy(camera.position); ru.uTexel.value.set(1 / this.w, 1 / this.h);
    // a true running mean over the first frames after a reset (fast to settle), then an exponential one
    this.histN = this.histOK && !jumped ? this.histN + 1 : 0;
    ru.uBlend.value = Math.min(0.9, this.histN / (this.histN + 1));
    const out = this.hist[1 - this.ping];
    pass(this.resolve, out);
    this.ping = 1 - this.ping; this.histOK = true;
    this.prevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.prevPos.copy(camera.position);
    this.texture = out.texture;
    return this.texture;
  }
}
