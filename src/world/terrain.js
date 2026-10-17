// Procedural island terrain: heightmap generation (ridged mountains, carved canyon networks, coastal
// plain, airbase/city/SAM plateau flattening), GPU chunked-LOD rendering with skirts, slope/altitude
// splat shading with cloud & terrain shadows, CPU height queries and radar line-of-sight raycasts.
import * as THREE from 'three';
import { Simplex, mulberry32 } from '../core/noise.js';
import { GU, GLSL_COMMON, GLSL_CLOUDS, GLSL_LIGHTS, FULLSCREEN_VS, fullscreenTriangle } from '../render/glsl.js';

export const TER = {
  N: 1025,            // samples per side
  CELL: 40,           // meters per cell
  SIZE: 40960,        // meters
  HALF: 20480,
  CHUNK: 64,          // cells per chunk
};
const NCH = (TER.N - 1) / TER.CHUNK; // 16

// ---- Layout of the theater (world coords: +X east, -Z north) ----
export const SITES = {
  airbase: { x: -7600, z: 6200, len: 3000, wid: 60, elev: 14 },
  city: { x: 3400, z: 6900, rx: 1500, rz: 900, elev: 22 },
  port: { x: 6600, z: 8600 },
  samPlateau: { x: -900, z: -2700, r: 420, elev: 720 },
  frontline: { x: 8200, z: 1500, elev: 0 },
  shorad: { x: 2600, z: 5300 },
};
export const CANYONS = [
  { pts: [[-2600, 10400], [-2300, 7800], [-1700, 5600], [-900, 3300], [-1700, 900], [-1200, -1400], [-700, -2000]], floorIn: 520, w: 140, wall: 420 },
  { pts: [[5200, 10200], [4700, 7600], [4300, 5400], [5400, 3600], [6900, 2400], [8300, 1500], [9600, 300]], floorIn: 210, w: 230, wall: 520 },
  { pts: [[14800, -900], [12300, -700], [10400, -300], [9200, 300]], floorIn: 190, w: 200, wall: 480 },
  { pts: [[-12800, 2200], [-10400, 1600], [-8200, 300], [-6100, -900], [-4200, -1900]], floorIn: 600, w: 120, wall: 380 },
];
export const ROADS = [
  [[-9400, 6050], [-7600, 5980], [-5200, 5900], [-3000, 6200], [-1500, 6600], [700, 6800], [2600, 6900], [3400, 6900]],
  [[3400, 6900], [4400, 6300], [4500, 5200], [5300, 3700], [6800, 2500], [8200, 1600], [9500, 400], [10600, -900], [11500, -2600]],
  [[3400, 6900], [5200, 7800], [6600, 8500]],
  [[-1500, 6600], [-1500, 4600], [-900, 3300], [-1400, 1100], [-1100, -1300], [-900, -2600]],
];

function distToPolyline(px, pz, pts) {
  let best = 1e18, bestS = 0, acc = 0, total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az; const L2 = dx * dx + dz * dz; const L = Math.sqrt(L2);
    let t = ((px - ax) * dx + (pz - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - px, qz = az + dz * t - pz; const d = qx * qx + qz * qz;
    if (d < best) { best = d; bestS = (acc + t * L) / total; }
    acc += L;
  }
  return [Math.sqrt(best), bestS];
}

const smooth = (e0, e1, x) => { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export class Terrain {
  constructor(seed = 20261015) {
    this.seed = seed;
    this.sx = new Simplex(seed);
    this.heights = new Float32Array(TER.N * TER.N);
    this.feat = new Uint8Array(TER.N * TER.N * 4);
    this.normals = new Uint8Array(TER.N * TER.N * 4);
    this.chunkMin = new Float32Array(NCH * NCH);
    this.chunkMax = new Float32Array(NCH * NCH);
    this.craters = [];
  }

  rawHeight(x, z) {
    const sx = this.sx;
    // island shape with warped coastline
    const wx = sx.fbm2(x / 9000 + 3.1, z / 9000 - 1.7, 3) * 0.2;
    const wz = sx.fbm2(x / 9000 - 5.3, z / 9000 + 2.2, 3) * 0.2;
    const nx = x / 13500 + wx, nz = z / 10800 + wz;
    let q = Math.sqrt(nx * nx + nz * nz);
    // secondary islets
    const islets = [[-15500, -12500, 2600], [15200, 11800, 2200], [-14500, 13500, 1500]];
    let isletH = -400;
    for (const [ix, iz, r] of islets) {
      const d = Math.hypot(x - ix, z - iz) / r + sx.fbm2(x / 1800, z / 1800, 3) * 0.25;
      const h = (1 - smooth(0.0, 1.0, d)) * 380 * (0.6 + 0.4 * sx.ridged2(x / 2200, z / 2200, 4)) - 60 * smooth(0.7, 1.2, d) - 20;
      if (h > isletH) isletH = h;
    }
    if (q > 1.25) {
      const sea = -260 + sx.fbm2(x / 5000, z / 5000, 3) * 60 - smooth(1.2, 1.8, q) * 120;
      return Math.max(sea, isletH);
    }
    const inland = smooth(1.02, 0.25, q);
    const mask = smooth(1.08, 0.86, q);
    const hills = (sx.fbm2(x / 5200, z / 5200, 5) * 0.5 + 0.5) * 420 * inland;
    const north = smooth(2500, -3500, z);
    const ridge = Math.pow(sx.ridged2(x / 8200 + 11.3, z / 8200 - 4.1, 6), 1.35);
    const mount = ridge * 2150 * north * inland;
    const central = Math.pow(sx.ridged2(x / 4600 - 7.7, z / 4600 + 9.9, 5), 1.2) * 820 * smooth(5200, 600, z) * inland;
    let h = 25 + hills + mount + central;
    // southern coastal plain
    const plain = smooth(2600, 5600, z) * smooth(-11500, -9000, x) * smooth(12500, 10000, x);
    h = lerp(h, 14 + (sx.fbm2(x / 2500, z / 2500, 4) * 0.5 + 0.5) * 34, plain * 0.92);
    // beaches/coast falloff
    const seaFloor = -230 + sx.fbm2(x / 5000, z / 5000, 3) * 60;
    h = lerp(seaFloor, h, mask);
    h = Math.max(h, isletH);
    // canyons
    for (const c of CANYONS) {
      const [d, s] = distToPolyline(x, z, c.pts);
      if (d > c.w + c.wall + 300) continue;
      const floor = lerp(-6, c.floorIn, smooth(0.0, 1.0, s)) + sx.fbm2(x / 700, z / 700, 3) * 18;
      const w = c.w * (0.8 + 0.4 * (sx.noise2(s * 6.3, c.w) * 0.5 + 0.5));
      const t = smooth(w, w + c.wall, d + sx.fbm2(x / 400, z / 400, 2) * 60);
      if (h > floor) h = lerp(floor, h, Math.pow(t, 1.6));
    }
    // flattened sites
    const A = SITES.airbase;
    {
      const dx = Math.abs(x - A.x) - (A.len / 2 + 250), dz = Math.abs(z - (A.z - 120)) - 330;
      const d = Math.max(dx, dz, 0) + Math.min(Math.max(dx, dz), 0);
      const t = smooth(650, 0, d);
      h = lerp(h, A.elev, t);
    }
    {
      const C = SITES.city; const d = Math.hypot((x - C.x) / C.rx, (z - C.z) / C.rz);
      h = lerp(h, C.elev + sx.fbm2(x / 1200, z / 1200, 3) * 10, smooth(1.35, 0.85, d));
    }
    {
      const S = SITES.samPlateau; const d = Math.hypot(x - S.x, z - S.z);
      h = lerp(h, S.elev, smooth(S.r + 500, S.r, d));
    }
    {
      const F = SITES.frontline; const d = Math.hypot(x - F.x, z - F.z);
      if (d < 1600) h = lerp(h, Math.max(h * 0.4, 160), smooth(1600, 700, d) * 0.6);
    }
    return h;
  }

  generate(onProgress) {
    const N = TER.N, H = this.heights;
    for (let j = 0; j < N; j++) {
      const z = j * TER.CELL - TER.HALF;
      for (let i = 0; i < N; i++) {
        const x = i * TER.CELL - TER.HALF;
        H[j * N + i] = this.rawHeight(x, z);
      }
      if (onProgress && (j & 63) === 0) onProgress(j / N);
    }
    // force deep ocean at border
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const e = Math.min(i, j, N - 1 - i, N - 1 - j);
      if (e < 8) H[j * N + i] = Math.min(H[j * N + i], -300);
    }
    this.computeNormals();
    this.computeFeatures();
    this.computeChunkBounds();
  }

  computeNormals() {
    const N = TER.N, H = this.heights, out = this.normals, c2 = TER.CELL * 2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const hl = H[j * N + Math.max(i - 1, 0)], hr = H[j * N + Math.min(i + 1, N - 1)];
      const hd = H[Math.max(j - 1, 0) * N + i], hu = H[Math.min(j + 1, N - 1) * N + i];
      let nx = (hl - hr) / c2, ny = 1, nz = (hd - hu) / c2; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const o = (j * N + i) * 4;
      out[o] = Math.round((nx * 0.5 + 0.5) * 255); out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255); out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      const h = H[j * N + i];
      out[o + 3] = Math.round(Math.min(1, Math.max(0, 0.5 - h / 60)) * 255); // shoreline depth code
    }
  }

  computeFeatures() {
    const N = TER.N, H = this.heights, F = this.feat, sx = this.sx;
    const rnd = mulberry32(this.seed + 5);
    for (let j = 0; j < N; j++) {
      const z = j * TER.CELL - TER.HALF;
      for (let i = 0; i < N; i++) {
        const x = i * TER.CELL - TER.HALF; const o = (j * N + i) * 4; const h = H[j * N + i];
        const ny = this.normals[o + 1] / 255 * 2 - 1; const slope = 1 - ny;
        let forest = 0;
        if (h > 25 && h < 1250 && slope < 0.45) {
          const n = sx.fbm2(x / 2600 + 40, z / 2600 - 10, 4) * 0.5 + 0.5;
          forest = smooth(0.48, 0.66, n + (h < 300 ? 0.05 : 0)) * smooth(0.45, 0.25, slope) * smooth(1250, 950, h);
        }
        const C = SITES.city; const dc = Math.hypot((x - C.x) / C.rx, (z - C.z) / C.rz);
        let urban = smooth(1.05, 0.7, dc);
        const P = SITES.port; const dp = Math.hypot(x - P.x, z - P.z);
        urban = Math.max(urban, smooth(900, 500, dp) * (h > 1 ? 1 : 0));
        forest *= 1 - urban;
        let paved = 0;
        const A = SITES.airbase;
        if (Math.abs(x - A.x) < A.len / 2 + 60 && Math.abs(z - A.z) < 45) paved = 1;           // runway
        if (Math.abs(x - A.x) < 900 && z < A.z - 45 && z > A.z - 330) paved = Math.max(paved, 0.85); // apron
        if (Math.abs(x - A.x) < A.len / 2 && Math.abs(z - (A.z - 110)) < 18) paved = 1;        // taxiway
        const S = SITES.samPlateau; if (Math.hypot(x - S.x, z - S.z) < 260) paved = Math.max(paved, 0.55);
        const field = (h > 5 && h < 120 && slope < 0.08 && urban < 0.2) ? smooth(0.55, 0.7, sx.noise2(x / 900, z / 900) * 0.5 + 0.5) : 0;
        F[o] = Math.round(paved * 255); F[o + 1] = Math.round(urban * 255); F[o + 2] = Math.round(forest * 255); F[o + 3] = Math.round(field * 255);
      }
    }
    // roads: stamp into R (paved) with lower value to distinguish from runway concrete
    for (const road of ROADS) {
      for (let k = 0; k < road.length - 1; k++) {
        const [ax, az] = road[k], [bx, bz] = road[k + 1]; const L = Math.hypot(bx - ax, bz - az);
        for (let s = 0; s <= L; s += 15) {
          const x = ax + (bx - ax) * s / L, z = az + (bz - az) * s / L;
          const ci = Math.round((x + TER.HALF) / TER.CELL), cj = Math.round((z + TER.HALF) / TER.CELL);
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
            const wx = ii * TER.CELL - TER.HALF, wz = jj * TER.CELL - TER.HALF; const d = Math.hypot(wx - x, wz - z);
            const v = Math.round(smooth(34, 10, d) * 150); const o = (jj * N + ii) * 4;
            if (v > F[o] && F[o] < 200) F[o] = v;
            F[o + 2] = Math.min(F[o + 2], 255 - v * 1.6);
          }
        }
      }
    }
    void rnd;
  }

  computeChunkBounds() {
    const N = TER.N, H = this.heights;
    for (let cj = 0; cj < NCH; cj++) for (let ci = 0; ci < NCH; ci++) {
      let mn = 1e9, mx = -1e9;
      for (let j = cj * TER.CHUNK; j <= (cj + 1) * TER.CHUNK; j++) for (let i = ci * TER.CHUNK; i <= (ci + 1) * TER.CHUNK; i++) {
        const h = H[j * N + i]; if (h < mn) mn = h; if (h > mx) mx = h;
      }
      this.chunkMin[cj * NCH + ci] = mn; this.chunkMax[cj * NCH + ci] = mx;
    }
  }

  // ---------------- CPU queries ----------------
  heightAt(x, z) {
    const fx = (x + TER.HALF) / TER.CELL, fz = (z + TER.HALF) / TER.CELL;
    if (fx < 0 || fz < 0 || fx >= TER.N - 1 || fz >= TER.N - 1) return -300;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, N = TER.N, H = this.heights;
    const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 20; const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z), hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }
  featuresAt(x, z) {
    const i = Math.round((x + TER.HALF) / TER.CELL), j = Math.round((z + TER.HALF) / TER.CELL);
    if (i < 0 || j < 0 || i >= TER.N || j >= TER.N) return [0, 0, 0, 0];
    const o = (j * TER.N + i) * 4; return [this.feat[o] / 255, this.feat[o + 1] / 255, this.feat[o + 2] / 255, this.feat[o + 3] / 255];
  }
  // Radar/visual line of sight with terrain and earth curvature (4/3 effective earth radius).
  lineOfSight(a, b, curvature = true, clearance = 0) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const D = Math.hypot(dx, dz); const L = Math.hypot(dx, dy, dz);
    if (L < 1) return true;
    const steps = Math.min(400, Math.max(8, Math.ceil(D / 60)));
    const Reff = 8.5e6;
    for (let k = 1; k < steps; k++) {
      const t = k / steps; const x = a.x + dx * t, z = a.z + dz * t, y = a.y + dy * t;
      const s = D * t; const bulge = curvature ? s * (D - s) / (2 * Reff) : 0;
      const g = Math.max(this.heightAt(x, z), 0) + bulge + clearance;
      if (y < g) return false;
    }
    return true;
  }
  // segment vs terrain; returns t in [0,1] of first hit or -1
  raycast(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z; const L = Math.hypot(dx, dy, dz);
    const steps = Math.max(1, Math.ceil(L / 15));
    let prevT = 0, prevAbove = a.y - this.heightAt(a.x, a.z);
    if (prevAbove < 0) return 0;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps; const y = a.y + dy * t; const g = this.heightAt(a.x + dx * t, a.z + dz * t);
      const above = y - g;
      if (above < 0) { const f = prevAbove / (prevAbove - above); return prevT + (t - prevT) * f; }
      prevT = t; prevAbove = above;
    }
    return -1;
  }
  addCrater(x, z, r) {
    this.craters.push({ x, z, r, t: GU.uTime.value });
    if (this.craters.length > 24) this.craters.shift();
    const arr = this.material.uniforms.uCraters.value;
    for (let i = 0; i < 24; i++) {
      const c = this.craters[i];
      if (c) arr[i].set(c.x, c.z, c.r, c.t); else arr[i].set(0, 0, 0, -1);
    }
  }

  // ---------------- GPU resources ----------------
  build(renderer) {
    const N = TER.N;
    const hTex = new THREE.DataTexture(this.heights, N, N, THREE.RedFormat, THREE.FloatType);
    hTex.minFilter = hTex.magFilter = THREE.NearestFilter; hTex.needsUpdate = true;
    const nTex = new THREE.DataTexture(this.normals, N, N, THREE.RGBAFormat);
    nTex.minFilter = THREE.LinearMipmapLinearFilter; nTex.magFilter = THREE.LinearFilter; nTex.generateMipmaps = true; nTex.needsUpdate = true;
    const fTex = new THREE.DataTexture(this.feat, N, N, THREE.RGBAFormat);
    fTex.minFilter = THREE.LinearMipmapLinearFilter; fTex.magFilter = THREE.LinearFilter; fTex.generateMipmaps = true; fTex.needsUpdate = true;
    this.hTex = hTex; this.nTex = nTex; this.fTex = fTex;
    this.shadowRT = new THREE.WebGLRenderTarget(N, N, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.shadowMat = new THREE.ShaderMaterial({
      uniforms: { uHeight: { value: hTex }, uSun: { value: new THREE.Vector3() }, uCell: { value: TER.CELL } },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: /* glsl */`
        uniform sampler2D uHeight; uniform vec3 uSun; uniform float uCell; varying vec2 vUv;
        float H(vec2 p) { ivec2 s = textureSize(uHeight, 0); vec2 f = p - 0.5; ivec2 i = ivec2(floor(f)); vec2 t = fract(f);
          float a = texelFetch(uHeight, clamp(i, ivec2(0), s - 1), 0).r, b = texelFetch(uHeight, clamp(i + ivec2(1, 0), ivec2(0), s - 1), 0).r;
          float c = texelFetch(uHeight, clamp(i + ivec2(0, 1), ivec2(0), s - 1), 0).r, d = texelFetch(uHeight, clamp(i + ivec2(1, 1), ivec2(0), s - 1), 0).r;
          return mix(mix(a, b, t.x), mix(c, d, t.x), t.y); }
        void main() {
          vec2 sz = vec2(textureSize(uHeight, 0));
          vec2 p = vUv * sz;
          float h0 = H(p) + 2.0;
          vec2 dir = normalize(uSun.xz + 1e-6);
          float tanE = uSun.y / max(length(uSun.xz), 1e-4);
          float vis = 1.0;
          float dist = 0.0; float stp = 0.75;
          for (int i = 0; i < 72; i++) {
            dist += stp; stp *= 1.06;
            vec2 q = p + dir * dist;
            if (q.x < 0.0 || q.y < 0.0 || q.x > sz.x || q.y > sz.y) break;
            float hr = h0 + dist * uCell * tanE;
            float ht = H(q);
            vis = min(vis, clamp(1.0 - (ht - hr) / (8.0 + dist * uCell * 0.035), 0.0, 1.0));
            if (hr > 2600.0) break;
          }
          gl_FragColor = vec4(vis, vis, vis, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.shadowQuad = new THREE.Mesh(fullscreenTriangle(), this.shadowMat); this.shadowQuad.frustumCulled = false;
    this.shadowScene = new THREE.Scene(); this.shadowScene.add(this.shadowQuad);
    this.shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.renderer = renderer;

    const craters = []; for (let i = 0; i < 24; i++) craters.push(new THREE.Vector4(0, 0, 0, -1));
    const u = {};
    for (const n of ['uTime', 'uSunDir', 'uSunColor', 'uSkyAmb', 'uGroundAmb', 'uSkyTex', 'uFogDensity', 'uFogHeight', 'uThermal', 'uNight',
      'uNoiseTex', 'uWeatherTex', 'uNoise3D', 'uCloudBase', 'uCloudTop', 'uCloudCover', 'uWeatherScale', 'uWind', 'uLightPos', 'uLightCol']) u[n] = GU[n];
    Object.assign(u, {
      uHeight: { value: hTex }, uNormalTex: { value: nTex }, uFeatTex: { value: fTex }, uShadowTex: { value: this.shadowRT.texture },
      uCell: { value: TER.CELL }, uHalf: { value: TER.HALF }, uTerrSize: { value: TER.SIZE }, uSkirt: { value: 60 }, uCraters: { value: craters },
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec2 aChunk; attribute float aLod;
        uniform sampler2D uHeight; uniform float uCell; uniform float uHalf; uniform float uSkirt;
        varying vec3 vWP; varying vec2 vTUV;
        void main() {
          vec2 ci = aChunk + position.xz;
          ivec2 ti = clamp(ivec2(ci + 0.5), ivec2(0), ivec2(1024));
          float h = texelFetch(uHeight, ti, 0).r;
          if (position.y > 0.5) h -= uSkirt * (1.0 + aLod);
          vec3 wp = vec3(ci.x * uCell - uHalf, h, ci.y * uCell - uHalf);
          vWP = wp; vTUV = (ci + 0.5) / 1025.0;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        ${GLSL_CLOUDS}
        ${GLSL_LIGHTS}
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D uNormalTex; uniform sampler2D uFeatTex; uniform sampler2D uShadowTex; uniform sampler2D uNoiseTex;
        uniform vec4 uCraters[24];
        varying vec3 vWP; varying vec2 vTUV;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 wp = vWP;
          float camDist = length(wp - cameraPosition);
          vec3 n = normalize(texture(uNormalTex, vTUV).xyz * 2.0 - 1.0);
          vec4 ft = texture(uFeatTex, vTUV);
          vec4 nz = texture(uNoiseTex, wp.xz / 2100.0);
          vec4 nz2 = texture(uNoiseTex, wp.xz / 260.0);
          vec4 nz3 = texture(uNoiseTex, wp.xz / 31.0);
          vec4 nz4 = texture(uNoiseTex, wp.xz / 6.0);
          // detail bump from noise (fades with distance)
          float df = 1.0 - smoothstep(600.0, 4000.0, camDist);
          vec2 bump = (vec2(nz3.r, nz3.g) - 0.5) * 0.35 * df + (vec2(nz2.b, nz2.a) - 0.5) * 0.25;
          float rockiness = smoothstep(0.22, 0.42, 1.0 - n.y + (nz2.r - 0.5) * 0.18);
          n = normalize(n + vec3(bump.x, 0.0, bump.y) * (0.4 + rockiness));
          float slope = 1.0 - n.y;
          float h = wp.y;
          vec3 grass = mix(vec3(0.085, 0.12, 0.035), vec3(0.15, 0.17, 0.06), nz2.g);
          vec3 dry = mix(vec3(0.27, 0.23, 0.12), vec3(0.36, 0.31, 0.18), nz3.b);
          vec3 forest = mix(vec3(0.025, 0.05, 0.018), vec3(0.05, 0.075, 0.03), nz3.r);
          vec3 rock = mix(vec3(0.19, 0.17, 0.15), vec3(0.32, 0.28, 0.24), smoothstep(0.3, 0.7, nz2.b + sin(h * 0.05 + nz2.r * 6.0) * 0.15));
          vec3 sand = mix(vec3(0.5, 0.43, 0.3), vec3(0.62, 0.55, 0.4), nz3.g);
          vec3 snow = vec3(0.82, 0.86, 0.92);
          vec3 alb = mix(grass, dry, smoothstep(0.45, 0.75, nz.g + h / 2600.0 + nz2.a * 0.2));
          // farmland patches
          float fieldPat = step(0.5, fract((wp.x * 0.7 + wp.z * 0.3) / 140.0 + nz.r * 3.0));
          alb = mix(alb, mix(vec3(0.2, 0.18, 0.07), vec3(0.11, 0.16, 0.04), fieldPat), ft.a * 0.8);
          alb = mix(alb, forest, ft.b * smoothstep(0.25, 0.55, nz3.a + ft.b * 0.6));
          alb = mix(alb, rock, rockiness);
          float beach = smoothstep(7.0, 1.0, h + (nz2.g - 0.5) * 6.0) * (1.0 - rockiness * 0.7);
          alb = mix(alb, sand, beach);
          alb = mix(alb, sand * 0.55, smoothstep(0.5, -2.0, h));
          float snowF = smoothstep(1450.0, 1650.0, h + (nz.b - 0.5) * 500.0) * smoothstep(0.62, 0.38, slope);
          alb = mix(alb, snow, snowF);
          // urban: blocks, streets and roofs
          if (ft.g > 0.02) {
            vec2 g = wp.xz / 85.0; vec2 cellId = floor(g); vec2 f = fract(g);
            float street = 1.0 - step(0.12, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
            float rh = hash12(cellId);
            vec3 roof = mix(vec3(0.2, 0.19, 0.18), vec3(0.35, 0.22, 0.16), step(0.6, rh)) * (0.7 + 0.5 * hash12(cellId + 7.0));
            vec3 urb = mix(roof, vec3(0.07), street);
            alb = mix(alb, urb, ft.g);
          }
          // paved: runway concrete (1.0) / roads (~0.58)
          if (ft.r > 0.02) {
            vec3 conc = vec3(0.22, 0.215, 0.2) * (0.85 + 0.3 * nz3.r);
            vec3 asph = vec3(0.045, 0.045, 0.048) * (0.85 + 0.3 * nz4.r);
            vec3 pav = mix(asph, conc, smoothstep(0.7, 0.8, ft.r));
            alb = mix(alb, pav, smoothstep(0.05, 0.35, ft.r));
          }
          // craters / scorch
          float scorch = 0.0;
          for (int i = 0; i < 24; i++) {
            vec4 c = uCraters[i]; if (c.w < 0.0) continue;
            float d = length(wp.xz - c.xy) / c.z;
            if (d < 2.4) {
              float ring = smoothstep(2.4, 0.9, d) * (0.65 + 0.35 * nz3.g);
              scorch = max(scorch, ring);
            }
          }
          alb = mix(alb, vec3(0.025, 0.022, 0.02), scorch * 0.9);
          alb *= 0.82 + 0.36 * nz4.g * df + (nz2.r - 0.5) * 0.25;

          float tsh = texture(uShadowTex, vTUV).r;
          float csh = cloudShadowAt(wp);
          float ndl = max(dot(n, uSunDir), 0.0);
          vec3 sun = uSunColor * ndl * tsh * csh / PI;
          vec3 amb = uSkyAmb * (0.55 + 0.45 * n.y) * mix(0.55, 1.0, tsh) + uGroundAmb * (0.5 - 0.5 * n.y);
          vec3 col = alb * (sun + amb) + flashLights(wp, n, alb) ;
          // night city lights
          if (uNight > 0.01 && ft.g > 0.2) {
            vec2 g = wp.xz / 23.0; float lh = hash12(floor(g));
            float lamp = step(0.83, lh) * smoothstep(0.3, 0.0, length(fract(g) - 0.5));
            col += vec3(1.0, 0.72, 0.38) * lamp * 2.5 * uNight * ft.g;
          }
          if (uThermal > 0.5) {
            float dayHeat = clamp(uSunDir.y * 2.0, 0.0, 1.0);
            float temp = 0.2 + 0.22 * ndl * tsh * csh * dayHeat - 0.06 * ft.b + 0.1 * ft.r + 0.08 * ft.g + 0.04 * (1.0 - n.y);
            temp += scorch * 0.5 * exp(-max(uTime - 0.0, 0.0) * 0.0);
            temp -= 0.08 * snowF;
            temp += (nz3.r - 0.5) * 0.04;
            gl_FragColor = vec4(vec3(temp), 1.0);
            return;
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });

    // LOD grids
    this.lods = [];
    for (let L = 0; L < 4; L++) {
      const n = TER.CHUNK >> L, step = 1 << L;
      const pos = []; const idx = [];
      const vid = (i, j) => j * (n + 1) + i;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(i * step, 0, j * step);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = vid(i, j), b = vid(i + 1, j), c = vid(i, j + 1), d = vid(i + 1, j + 1);
        idx.push(a, c, b, b, c, d);
      }
      // skirts along 4 edges
      let base = pos.length / 3;
      const edge = (list) => {
        const start = pos.length / 3;
        for (const [i, j] of list) pos.push(i * step, 1, j * step);
        for (let k = 0; k < list.length - 1; k++) {
          const t0 = vid(list[k][0], list[k][1]), t1 = vid(list[k + 1][0], list[k + 1][1]);
          const s0 = start + k, s1 = start + k + 1;
          idx.push(t0, s0, t1, t1, s0, s1, t0, t1, s0, t1, s1, s0);
        }
      };
      const top = [], bot = [], left = [], right = [];
      for (let i = 0; i <= n; i++) { top.push([i, 0]); bot.push([i, n]); }
      for (let j = 0; j <= n; j++) { left.push([0, j]); right.push([n, j]); }
      edge(top); edge(bot); edge(left); edge(right);
      void base;
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      const chunkAttr = new THREE.InstancedBufferAttribute(new Float32Array(NCH * NCH * 2), 2); chunkAttr.setUsage(THREE.DynamicDrawUsage);
      const lodAttr = new THREE.InstancedBufferAttribute(new Float32Array(NCH * NCH), 1); lodAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aChunk', chunkAttr); geo.setAttribute('aLod', lodAttr);
      geo.instanceCount = 0;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.frustumCulled = false; mesh.receiveShadow = false; mesh.castShadow = false;
      this.lods.push({ mesh, geo, chunkAttr, lodAttr });
    }
    this.group = new THREE.Group();
    for (const l of this.lods) this.group.add(l.mesh);
    this._frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._box = new THREE.Box3();
  }

  updateShadows(sunDir) {
    const sd = sunDir.y > 0.02 ? sunDir : new THREE.Vector3(0.3, 0.6, 0.2).normalize();
    this.shadowMat.uniforms.uSun.value.copy(sd);
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(this.shadowRT); r.render(this.shadowScene, this.shadowCam); r.setRenderTarget(prev);
  }

  updateLOD(camera) {
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    const counts = [0, 0, 0, 0];
    const cp = camera.position;
    const csz = TER.CHUNK * TER.CELL;
    for (let cj = 0; cj < NCH; cj++) for (let ci = 0; ci < NCH; ci++) {
      const k = cj * NCH + ci;
      const mx = this.chunkMax[k]; if (mx < -6) continue;
      const x0 = ci * csz - TER.HALF, z0 = cj * csz - TER.HALF;
      this._box.min.set(x0, this.chunkMin[k] - 80, z0); this._box.max.set(x0 + csz, mx + 5, z0 + csz);
      if (!this._frustum.intersectsBox(this._box)) continue;
      const d = this._box.distanceToPoint(cp);
      const L = d < 2600 ? 0 : d < 6500 ? 1 : d < 14000 ? 2 : 3;
      const l = this.lods[L]; const c = counts[L]++;
      l.chunkAttr.array[c * 2] = ci * TER.CHUNK; l.chunkAttr.array[c * 2 + 1] = cj * TER.CHUNK;
      l.lodAttr.array[c] = L;
    }
    for (let L = 0; L < 4; L++) {
      const l = this.lods[L]; l.geo.instanceCount = counts[L];
      l.chunkAttr.needsUpdate = true; l.lodAttr.needsUpdate = true;
      l.mesh.visible = counts[L] > 0;
    }
  }
}
