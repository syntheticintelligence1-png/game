// Visual effects: GPU-instanced soft particles (lit smoke, additive fire), ribbon trails (missile smoke,
// contrails, wingtip vortices), afterburner flames with shock diamonds, tracers, flash-light pool,
// debris physics and the 5-stage detonation system (flash, shockwave/Wilson cloud, fireball+plume,
// debris+sparks, acoustically delayed boom & pressure-wave shake).
import * as THREE from 'three';
import { GU, GLSL_COMMON, GLSL_CLOUDS } from '../render/glsl.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
export const PT = { SMOKE: 0, FIRE: 1, FLASH: 2, SPARK: 3, DUST: 4, SPRAY: 5, STEAM: 6, FLARE: 7, MUZZLE: 8, EMBER: 9 };

const PARTICLE_VS = /* glsl */`
${GLSL_COMMON}
${GLSL_CLOUDS}
attribute vec4 iPosSize; attribute vec4 iData; attribute vec4 iColor;
uniform vec2 uRes;
varying vec2 vUv; varying vec4 vData; varying vec4 vColor; varying float vViewZ; varying float vSize; varying float vCloudT; varying float vFogT; varying vec3 vHaze; varying float vStretch;
float cloudOcclusion(vec3 a, vec3 b) {
  vec3 d = b - a; float L = length(d); if (L < 1.0) return 1.0; d /= L;
  float t0, t1;
  if (abs(d.y) < 1e-4) { if (a.y < uCloudBase || a.y > uCloudTop) return 1.0; t0 = 0.0; t1 = L; }
  else { float ta = (uCloudBase - a.y) / d.y, tb = (uCloudTop - a.y) / d.y; t0 = max(min(ta, tb), 0.0); t1 = min(max(ta, tb), L); }
  if (t1 <= t0) return 1.0;
  float od = 0.0; float seg = (t1 - t0) / 5.0;
  for (int i = 0; i < 5; i++) od += cloudDensityLo(a + d * (t0 + (float(i) + 0.5) * seg)) * seg;
  return exp(-od * 0.042);
}
void main() {
  vec3 c = iPosSize.xyz; float size = iPosSize.w;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  float cr = cos(iData.x), sr = sin(iData.x);
  vec2 q = position.xy;
  vStretch = 0.0;
  if (iData.z > 2.5 && iData.z < 3.5) {
    // sparks: stretch along screen-space velocity (rotation encodes direction)
    q.x *= 4.0; vStretch = 1.0;
  }
  vec2 rq = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
  mv.xy += rq * size;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy; vData = iData; vColor = iColor; vViewZ = -mv.z; vSize = size;
  vec3 rd = c - cameraPosition; float dist = length(rd); rd /= max(dist, 1e-3);
  vFogT = fogTransmittance(cameraPosition, rd, dist);
  vHaze = sampleSky(normalize(vec3(rd.x, max(rd.y, 0.0) * 0.6 + 0.015, rd.z)));
  vCloudT = cloudOcclusion(cameraPosition, c);
}`;

const PARTICLE_FS_ALPHA = /* glsl */`
${GLSL_COMMON}
uniform sampler2D uDepth; uniform vec2 uRes; uniform float uLogFar; uniform sampler2D uNoiseTex;
varying vec2 vUv; varying vec4 vData; varying vec4 vColor; varying float vViewZ; varying float vSize; varying float vCloudT; varying float vFogT; varying vec3 vHaze; varying float vStretch;
void main() {
  float r2 = dot(vUv, vUv); if (r2 > 1.0) discard;
  vec4 n = texture(uNoiseTex, vUv * 0.33 + vData.w * 7.31 + vec2(uTime * 0.01));
  vec4 n2 = texture(uNoiseTex, vUv * 0.8 + vData.w * 3.17);
  float r = sqrt(r2) + (n.g - 0.5) * 0.5 + (n2.b - 0.5) * 0.25;
  float shape = smoothstep(1.0, 0.35, r);
  float a = shape * vData.y;
  vec2 suv = gl_FragCoord.xy / uRes;
  float d = texture(uDepth, suv).r;
  float sceneW = d < 0.999999 ? exp2(d * uLogFar) - 1.0 : 1e9;
  a *= clamp((sceneW - vViewZ) / max(vSize * 0.6, 0.3), 0.0, 1.0);
  a *= vCloudT;
  if (a < 0.002) discard;
  vec3 nV = normalize(vec3(vUv + (n.rg - 0.5) * 0.6, sqrt(max(1.0 - r2, 0.0)) + 0.2));
  vec3 nW = (vec4(nV, 0.0) * viewMatrix).xyz;
  float ndl = dot(nW, uSunDir) * 0.5 + 0.5;
  vec3 col;
  if (uThermal > 0.5) { col = vec3(vColor.a); }
  else {
    vec3 alb = vColor.rgb;
    col = alb * (uSunColor * ndl * ndl * 0.3 + uSkyAmb * 0.9 + uGroundAmb * 0.4);
    // self-glow at the base of fresh fire smoke
    col += vec3(1.0, 0.45, 0.15) * max(vColor.a - 0.6, 0.0) * 6.0 * (1.0 - r);
    col = col * vFogT + vHaze * (1.0 - vFogT);
  }
  gl_FragColor = vec4(col * a, a);
}`;

const PARTICLE_FS_ADD = /* glsl */`
${GLSL_COMMON}
uniform sampler2D uDepth; uniform vec2 uRes; uniform float uLogFar; uniform sampler2D uNoiseTex;
varying vec2 vUv; varying vec4 vData; varying vec4 vColor; varying float vViewZ; varying float vSize; varying float vCloudT; varying float vFogT; varying vec3 vHaze; varying float vStretch;
void main() {
  float r2 = dot(vUv, vUv); if (r2 > 1.0) discard;
  float r = sqrt(r2);
  vec4 n = texture(uNoiseTex, vUv * 0.4 + vData.w * 5.13 + vec2(0.0, -uTime * 0.2));
  float shape;
  if (vStretch > 0.5) shape = exp(-r2 * 6.0);
  else shape = smoothstep(1.0, 0.0, r + (n.r - 0.5) * 0.55) * (0.6 + 0.6 * n.g);
  vec2 suv = gl_FragCoord.xy / uRes;
  float d = texture(uDepth, suv).r;
  float sceneW = d < 0.999999 ? exp2(d * uLogFar) - 1.0 : 1e9;
  float soft = clamp((sceneW - vViewZ) / max(vSize * 0.5, 0.2), 0.0, 1.0);
  float a = shape * vData.y * soft * vCloudT;
  vec3 col = uThermal > 0.5 ? vec3(vColor.a * 2.0) : vColor.rgb * mix(0.4, 1.0, vFogT);
  gl_FragColor = vec4(col * a, 0.0);
}`;

class ParticleSystem {
  constructor(max, additive, depthU) {
    this.max = max; this.n = 0; this.additive = additive;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max); this.life = new Float32Array(max); this.size = new Float32Array(max); this.grow = new Float32Array(max);
    this.rot = new Float32Array(max); this.spin = new Float32Array(max); this.type = new Uint8Array(max); this.alpha = new Float32Array(max);
    this.col = new Float32Array(max * 3); this.heat = new Float32Array(max); this.drag = new Float32Array(max); this.buoy = new Float32Array(max); this.seed = new Float32Array(max);
    this.order = new Uint32Array(max); this.keys = new Float32Array(max);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.aData.setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.aCol.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPosSize', this.aPos); g.setAttribute('iData', this.aData); g.setAttribute('iColor', this.aCol);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e8);
    const u = {};
    for (const k of ['uTime', 'uSunDir', 'uSunColor', 'uSkyAmb', 'uGroundAmb', 'uSkyTex', 'uFogDensity', 'uFogHeight', 'uThermal', 'uNight',
      'uWeatherTex', 'uNoise3D', 'uCloudBase', 'uCloudTop', 'uCloudCover', 'uWeatherScale', 'uWind', 'uLogFar', 'uNoiseTex']) u[k] = GU[k];
    Object.assign(u, depthU);
    this.material = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: PARTICLE_VS, fragmentShader: additive ? PARTICLE_FS_ADD : PARTICLE_FS_ALPHA,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, this.material); this.mesh.frustumCulled = false; this.geo = g;
  }
  spawn(type, x, y, z, vx, vy, vz, size, life, o = {}) {
    if (this.n >= this.max) { if (o.must) this.kill(0); else return -1; }
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.grow[i] = o.grow || 0;
    this.rot[i] = o.rot != null ? o.rot : Math.random() * 6.283; this.spin[i] = o.spin != null ? o.spin : (Math.random() - 0.5) * 0.6;
    this.type[i] = type; this.alpha[i] = o.alpha != null ? o.alpha : 1;
    const c = o.color || [1, 1, 1]; this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
    this.heat[i] = o.heat != null ? o.heat : 0.3; this.drag[i] = o.drag != null ? o.drag : 0.5; this.buoy[i] = o.buoy || 0; this.seed[i] = Math.random();
    return i;
  }
  kill(i) {
    const j = --this.n; if (i === j) return;
    for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; this.col[i * 3 + k] = this.col[j * 3 + k]; }
    this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.size[i] = this.size[j]; this.grow[i] = this.grow[j]; this.rot[i] = this.rot[j]; this.spin[i] = this.spin[j];
    this.type[i] = this.type[j]; this.alpha[i] = this.alpha[j]; this.heat[i] = this.heat[j]; this.drag[i] = this.drag[j]; this.buoy[i] = this.buoy[j]; this.seed[i] = this.seed[j];
  }
  update(dt, camera, wind) {
    const P = this.pos, V = this.vel;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.kill(i); i--; continue; }
      const dr = this.drag[i];
      const k = Math.min(1, dr * dt);
      V[i * 3] += (wind.x - V[i * 3]) * k; V[i * 3 + 1] += (this.buoy[i] - V[i * 3 + 1]) * k * (this.buoy[i] !== 0 ? 1 : 0); V[i * 3 + 2] += (wind.z - V[i * 3 + 2]) * k;
      const t = this.type[i];
      if (t === PT.SPARK || t === PT.SPRAY || t === PT.EMBER || t === PT.DUST) V[i * 3 + 1] -= 9.81 * dt * (t === PT.DUST ? 0.2 : 1);
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt; this.rot[i] += this.spin[i] * dt;
    }
    // write instance buffers (alpha systems sorted back to front)
    const n = this.n; const cam = camera.position; const ord = this.order;
    for (let i = 0; i < n; i++) ord[i] = i;
    if (!this.additive && n > 1) {
      const K = this.keys;
      for (let i = 0; i < n; i++) { const dx = P[i * 3] - cam.x, dy = P[i * 3 + 1] - cam.y, dz = P[i * 3 + 2] - cam.z; K[i] = dx * dx + dy * dy + dz * dz; }
      const sub = ord.subarray(0, n); const arr = Array.from(sub); arr.sort((a, b) => K[b] - K[a]); for (let i = 0; i < n; i++) ord[i] = arr[i];
    }
    const A = this.aPos.array, D = this.aData.array, C = this.aCol.array;
    const vm = camera.matrixWorldInverse.elements;
    for (let o = 0; o < n; o++) {
      const i = ord[o]; const f = this.age[i] / this.life[i]; const t = this.type[i];
      A[o * 4] = P[i * 3]; A[o * 4 + 1] = P[i * 3 + 1]; A[o * 4 + 2] = P[i * 3 + 2]; A[o * 4 + 3] = this.size[i];
      let a = this.alpha[i], r = this.col[i * 3], g = this.col[i * 3 + 1], b = this.col[i * 3 + 2], heat = this.heat[i];
      let rot = this.rot[i];
      switch (t) {
        case PT.SMOKE: a *= Math.min(1, f * 8) * (1 - f) ** 1.3; heat *= 1 - f; break;
        case PT.DUST: case PT.SPRAY: case PT.STEAM: a *= Math.min(1, f * 6) * (1 - f) ** 1.6; break;
        case PT.FIRE: {
          // temperature curve: white-yellow core -> orange -> deep red -> out
          const T = 1 - f;
          r = 30 * Math.pow(T, 1.5) + 1.5 * T; g = 16 * Math.pow(T, 2.4) + 0.3 * T; b = 6 * Math.pow(T, 5);
          r *= this.col[i * 3]; g *= this.col[i * 3 + 1]; b *= this.col[i * 3 + 2];
          a *= Math.min(1, f * 12) * (1 - f) ** 0.8; heat = 2.5 * T; break;
        }
        case PT.FLASH: case PT.MUZZLE: { const k = 1 - f; a *= k * k; break; }
        case PT.SPARK: case PT.EMBER: {
          // align streak with screen-space velocity
          const vx = this.vel[i * 3], vy = this.vel[i * 3 + 1], vz = this.vel[i * 3 + 2];
          const sx = vm[0] * vx + vm[4] * vy + vm[8] * vz, sy = vm[1] * vx + vm[5] * vy + vm[9] * vz;
          rot = Math.atan2(sy, sx); a *= (1 - f); break;
        }
        case PT.FLARE: a *= (1 - f * 0.6) * (0.85 + Math.random() * 0.3); break;
      }
      D[o * 4] = rot; D[o * 4 + 1] = a; D[o * 4 + 2] = t; D[o * 4 + 3] = this.seed[i];
      C[o * 4] = r; C[o * 4 + 1] = g; C[o * 4 + 2] = b; C[o * 4 + 3] = heat;
    }
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = true; this.aData.needsUpdate = true; this.aCol.needsUpdate = true;
    this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, n * 4);
    this.aData.clearUpdateRanges(); this.aData.addUpdateRange(0, n * 4);
    this.aCol.clearUpdateRanges(); this.aCol.addUpdateRange(0, n * 4);
  }
}

// ---------------- ribbon trails ----------------
class Trail {
  constructor(sys, o) {
    this.sys = sys; this.kind = o.kind; this.w0 = o.width || 1; this.grow = o.grow != null ? o.grow : (o.kind === 'missile' ? 0.9 : o.kind === 'contrail' ? 0.6 : o.kind === 'vortex' ? 0.15 : 0.6);
    this.maxAge = o.maxAge || (o.kind === 'missile' ? 16 : o.kind === 'contrail' ? 35 : o.kind === 'vortex' ? 1.6 : 12);
    this.opacity = o.opacity != null ? o.opacity : 0.6; this.color = o.color || [0.9, 0.9, 0.9];
    this.pts = []; this.minStep = o.minStep || (o.kind === 'vortex' ? 2 : 12); this.alive = true; this.emitting = true; this.heat = o.heat || 0.2;
  }
  add(p, w = 1) {
    if (!this.emitting) { this.emitting = true; this.pts.push(null); }
    const last = this.pts.length ? this.pts[this.pts.length - 1] : null;
    const t = this.sys.time;
    if (last && last.p.distanceToSquared(p) < this.minStep * this.minStep) { last.p.copy(p); last.t = t; return; }
    this.pts.push({ p: p.clone(), t, w });
    if (this.pts.length > 220) this.pts.shift();
  }
  stop() { this.emitting = false; }
}

const TRAIL_VS = /* glsl */`
${GLSL_COMMON}
attribute vec4 aData; attribute vec3 aCol;
varying vec4 vData; varying vec3 vCol; varying float vFogT; varying vec3 vHaze; varying vec3 vWP;
void main() {
  vData = aData; vCol = aCol; vWP = position;
  vec3 rd = position - cameraPosition; float dist = length(rd); rd /= max(dist, 1e-3);
  vFogT = fogTransmittance(cameraPosition, rd, dist);
  vHaze = sampleSky(normalize(vec3(rd.x, max(rd.y, 0.0) * 0.6 + 0.015, rd.z)));
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;
const TRAIL_FS = /* glsl */`
${GLSL_COMMON}
uniform sampler2D uNoiseTex; uniform sampler2D uDepth; uniform vec2 uRes; uniform float uLogFar;
varying vec4 vData; varying vec3 vCol; varying float vFogT; varying vec3 vHaze; varying vec3 vWP;
void main() {
  // vData: x = age fraction, y = along (m), z = side (-1..1), w = opacity
  float side = vData.z;
  float n = texture(uNoiseTex, vec2(vData.y * 0.011, side * 0.12 + vData.x * 0.4)).r;
  float n2 = texture(uNoiseTex, vec2(vData.y * 0.043, side * 0.3)).g;
  float edge = 1.0 - smoothstep(0.35 + 0.4 * n2, 1.0, abs(side) + (n - 0.5) * 0.5);
  float fade = (1.0 - vData.x) * smoothstep(0.0, 0.02, vData.x + 0.005);
  float a = vData.w * edge * fade * (0.55 + 0.6 * n);
  float d = texture(uDepth, gl_FragCoord.xy / uRes).r;
  float sceneW = d < 0.999999 ? exp2(d * uLogFar) - 1.0 : 1e9;
  float vz = -(viewMatrix * vec4(vWP, 1.0)).z;
  a *= clamp((sceneW - vz) / 3.0, 0.0, 1.0);
  if (a < 0.003) discard;
  vec3 col = uThermal > 0.5 ? vec3(0.15 + 0.3 * (1.0 - vData.x)) : vCol * (uSunColor * 0.12 + uSkyAmb * 1.0);
  if (uThermal < 0.5) col = col * vFogT + vHaze * (1.0 - vFogT);
  gl_FragColor = vec4(col * a, a);
}`;

class TrailSystem {
  constructor(depthU) {
    this.trails = []; this.time = 0;
    this.maxVerts = 64000;
    this.posA = new Float32Array(this.maxVerts * 3); this.dataA = new Float32Array(this.maxVerts * 4); this.colA = new Float32Array(this.maxVerts * 3);
    this.idx = new Uint32Array(this.maxVerts * 3);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.posA, 3); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.BufferAttribute(this.dataA, 4); this.aData.setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.colA, 3); this.aCol.setUsage(THREE.DynamicDrawUsage);
    this.aIdx = new THREE.BufferAttribute(this.idx, 1); this.aIdx.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aData', this.aData); g.setAttribute('aCol', this.aCol); g.setIndex(this.aIdx);
    g.setDrawRange(0, 0); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e8);
    const u = {};
    for (const k of ['uTime', 'uSunDir', 'uSunColor', 'uSkyAmb', 'uGroundAmb', 'uSkyTex', 'uFogDensity', 'uFogHeight', 'uThermal', 'uNight', 'uNoiseTex', 'uLogFar']) u[k] = GU[k];
    Object.assign(u, depthU);
    this.material = new THREE.ShaderMaterial({ uniforms: u, vertexShader: TRAIL_VS, fragmentShader: TRAIL_FS, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    this.mesh = new THREE.Mesh(g, this.material); this.mesh.frustumCulled = false; this.geo = g;
  }
  create(o) { const t = new Trail(this, o); this.trails.push(t); return t; }
  update(dt, camera) {
    this.time += dt;
    const cam = camera.position; let nv = 0, ni = 0;
    const P = this.posA, D = this.dataA, C = this.colA, I = this.idx;
    for (let ti = 0; ti < this.trails.length; ti++) {
      const tr = this.trails[ti];
      // drop expired points
      while (tr.pts.length && (tr.pts[0] === null || this.time - tr.pts[0].t > tr.maxAge)) tr.pts.shift();
      if (!tr.pts.length && !tr.emitting) { this.trails.splice(ti, 1); ti--; continue; }
      const pts = tr.pts; let along = 0; let prevV = -1;
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k];
        if (!p) { prevV = -1; continue; }
        if (nv + 2 > this.maxVerts) break;
        const nx = pts[k + 1] || null, pv = k > 0 ? pts[k - 1] : null;
        const a = nx ? nx.p : p.p, b = pv ? pv.p : p.p;
        _v.copy(a).sub(b); if (_v.lengthSq() < 1e-6) _v.set(0, 0, 1);
        _v2.copy(p.p).sub(cam);
        _v3.copy(_v).cross(_v2).normalize();
        const age = (this.time - p.t) / tr.maxAge;
        const w = (tr.w0 + tr.grow * (this.time - p.t) * 2.0) * p.w * 0.5;
        if (pv) along += p.p.distanceTo(pv.p);
        for (let s = -1; s <= 1; s += 2) {
          P[nv * 3] = p.p.x + _v3.x * w * s; P[nv * 3 + 1] = p.p.y + _v3.y * w * s; P[nv * 3 + 2] = p.p.z + _v3.z * w * s;
          D[nv * 4] = Math.min(age, 1); D[nv * 4 + 1] = along; D[nv * 4 + 2] = s; D[nv * 4 + 3] = tr.opacity;
          C[nv * 3] = tr.color[0]; C[nv * 3 + 1] = tr.color[1]; C[nv * 3 + 2] = tr.color[2];
          nv++;
        }
        if (prevV >= 0) { I[ni++] = prevV; I[ni++] = prevV + 1; I[ni++] = nv - 2; I[ni++] = prevV + 1; I[ni++] = nv - 1; I[ni++] = nv - 2; }
        prevV = nv - 2;
      }
    }
    this.geo.setDrawRange(0, ni);
    this.aPos.needsUpdate = this.aData.needsUpdate = this.aCol.needsUpdate = this.aIdx.needsUpdate = true;
    this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, nv * 3);
    this.aData.clearUpdateRanges(); this.aData.addUpdateRange(0, nv * 4);
    this.aCol.clearUpdateRanges(); this.aCol.addUpdateRange(0, nv * 3);
    this.aIdx.clearUpdateRanges(); this.aIdx.addUpdateRange(0, ni);
  }
}

// ---------------- afterburner flame ----------------
function flameMaterial(inner) {
  return new THREE.ShaderMaterial({
    uniforms: { uAB: { value: 0 }, uRPM: { value: 0.7 }, uTime: GU.uTime, uThermal: GU.uThermal, uInner: { value: inner ? 1 : 0 } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying float vRim;
      void main() {
        vUv = uv;
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vRim = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uAB; uniform float uRPM; uniform float uTime; uniform float uThermal; uniform float uInner;
      varying vec2 vUv; varying float vRim;
      float h(float x) { return fract(sin(x * 91.7) * 43758.5); }
      void main() {
        float z = 1.0 - vUv.y;   // 0 at nozzle -> 1 at tip
        float flick = 0.85 + 0.15 * h(floor(uTime * 40.0) + vUv.x * 3.0);
        float diamonds = pow(0.5 + 0.5 * cos(z * 6.2831 * 4.5 - 0.6), 6.0) * exp(-z * 2.4);
        float core = exp(-z * (uInner > 0.5 ? 3.5 : 2.2));
        vec3 hot = vec3(0.75, 0.82, 1.0), mid = vec3(1.0, 0.62, 0.28), cool = vec3(1.0, 0.32, 0.08);
        vec3 col = mix(mix(hot, mid, smoothstep(0.0, 0.35, z)), cool, smoothstep(0.35, 0.9, z));
        float I = uAB * (core * (uInner > 0.5 ? 5.0 : 2.2) + diamonds * 9.0 * uInner) * flick;
        I *= pow(vRim, 0.7) * smoothstep(1.0, 0.75, z);
        I += (1.0 - uAB) * max(uRPM - 0.9, 0.0) * 2.0 * core * (1.0 - uInner) * 0.4;
        if (uThermal > 0.5) { gl_FragColor = vec4(vec3(I * 0.6 + core * uRPM * 0.8), 1.0); return; }
        gl_FragColor = vec4(col * I, 1.0);
      }`,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
export class AfterburnerFlame {
  constructor(radius = 0.38, length = 7) {
    this.group = new THREE.Group();
    // cylinder top (uv.y = 1) sits at the nozzle exit; plume extends along +Z
    const outerG = new THREE.CylinderGeometry(radius * 0.98, radius * 0.4, length, 18, 12, true); outerG.translate(0, -length / 2, 0); outerG.rotateX(-Math.PI / 2);
    const innerG = new THREE.CylinderGeometry(radius * 0.8, radius * 0.12, length * 0.55, 14, 10, true); innerG.translate(0, -length * 0.55 / 2, 0); innerG.rotateX(-Math.PI / 2);
    this.outerMat = flameMaterial(false); this.innerMat = flameMaterial(true);
    this.outer = new THREE.Mesh(outerG, this.outerMat); this.inner = new THREE.Mesh(innerG, this.innerMat);
    this.outer.frustumCulled = false; this.inner.frustumCulled = false;
    this.group.add(this.outer, this.inner);
  }
  set(ab, rpm) {
    this.outerMat.uniforms.uAB.value = ab; this.innerMat.uniforms.uAB.value = ab;
    this.outerMat.uniforms.uRPM.value = rpm; this.innerMat.uniforms.uRPM.value = rpm;
    const s = 0.55 + 0.45 * ab; this.group.scale.set(1, 1, s);
    this.group.visible = ab > 0.01 || rpm > 0.92;
  }
}

// ---------------- light pool ----------------
class LightPool {
  constructor(scene) {
    this.lights = []; this.sources = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffaa66, 0, 0, 2); l.castShadow = false; scene.add(l); this.lights.push(l); }
  }
  add(pos, color, intensity, life, o = {}) { const s = { pos: pos.clone(), color: new THREE.Color(...color), I0: intensity, I: intensity, life, age: 0, follow: o.follow || null, decay: o.decay != null ? o.decay : 2.5 }; this.sources.push(s); return s; }
  update(dt, camPos) {
    for (let i = this.sources.length - 1; i >= 0; i--) {
      const s = this.sources[i]; s.age += dt;
      if (s.life > 0) { if (s.age > s.life) { this.sources.splice(i, 1); continue; } s.I = s.I0 * Math.pow(1 - s.age / s.life, s.decay); }
      if (s.follow) s.follow(s);
    }
    const ranked = this.sources.map(s => ({ s, w: s.I / (s.pos.distanceToSquared(camPos) + 2500) })).sort((a, b) => b.w - a.w);
    for (let i = 0; i < 4; i++) {
      const l = this.lights[i]; const r = ranked[i];
      if (r && r.s.I > 0) { l.position.copy(r.s.pos); l.color.copy(r.s.color); l.intensity = r.s.I; GU.uLightPos.value[i].copy(r.s.pos); GU.uLightCol.value[i].set(r.s.color.r * r.s.I, r.s.color.g * r.s.I, r.s.color.b * r.s.I); }
      else { l.intensity = 0; GU.uLightCol.value[i].set(0, 0, 0); }
    }
  }
}

// ---------------- debris ----------------
class Debris {
  constructor(scene, fx, max = 400) {
    this.fx = fx; this.max = max; this.items = [];
    const g = new THREE.BufferGeometry();
    const shard = new THREE.TetrahedronGeometry(1, 0).toNonIndexed(); shard.scale(1, 0.4, 1.6);
    this.mesh = new THREE.InstancedMesh(shard, new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.8, metalness: 0.4 }), max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    scene.add(this.mesh); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); void g;
  }
  spawn(pos, vel, size, life, burning) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ p: pos.clone(), v: vel.clone(), r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12), s: size, life, age: 0, burning, rest: false, emit: 0 });
  }
  update(dt, game) {
    const fx = this.fx; let n = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i]; d.age += dt;
      if (d.age > d.life) { this.items.splice(i, 1); continue; }
      if (!d.rest) {
        d.v.y -= 9.81 * dt; d.v.multiplyScalar(1 - dt * 0.05);
        d.p.addScaledVector(d.v, dt); d.r.addScaledVector(d.w, dt);
        const th = game.terrain.heightAt(d.p.x, d.p.z);
        if (th < 0 && d.p.y < 0) { fx.splash(d.p, d.s * 0.4); d.age = d.life; continue; }
        if (d.p.y < th + d.s * 0.3) { d.p.y = th + d.s * 0.3; if (Math.abs(d.v.y) < 3) { d.rest = true; d.w.set(0, 0, 0); } d.v.y = -d.v.y * 0.3; d.v.x *= 0.5; d.v.z *= 0.5; d.w.multiplyScalar(0.5); fx.dustPuff(d.p, d.s); }
        if (d.burning) { d.emit -= dt; if (d.emit < 0) { d.emit = 0.05; fx.ps.alpha.spawn(PT.SMOKE, d.p.x, d.p.y, d.p.z, 0, 1, 0, d.s * 1.2, 2.5, { grow: 2.5, color: [0.08, 0.075, 0.07], alpha: 0.7, heat: 0.8, drag: 1.2 }); fx.ps.add.spawn(PT.FIRE, d.p.x, d.p.y, d.p.z, 0, 0, 0, d.s * 0.9, 0.35, { color: [1, 1, 1] }); } }
      }
    }
    for (const d of this.items) {
      if (n >= this.max) break;
      this._e.set(d.r.x, d.r.y, d.r.z); this._q.setFromEuler(this._e);
      this._m.compose(d.p, this._q, _v.set(d.s, d.s, d.s)); this.mesh.setMatrixAt(n++, this._m);
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------- FX manager ----------------
export class FX {
  constructor(game, pipeline) {
    this.game = game; this.pipe = pipeline;
    this.scene = new THREE.Scene(); // drawn in the transparent pass
    this.depthU = { uDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) } };
    this.ps = { alpha: new ParticleSystem(7000, false, this.depthU), add: new ParticleSystem(5000, true, this.depthU) };
    this.scene.add(this.ps.alpha.mesh, this.ps.add.mesh);
    this.trails = new TrailSystem(this.depthU); this.scene.add(this.trails.mesh);
    this.lights = new LightPool(game.scene);
    this.debris = new Debris(game.scene, this);
    this.emitters = []; this.shocks = []; this.pending = [];
    // tracers (instanced streaks)
    this.tracerMax = 1500;
    const tg = new THREE.InstancedBufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3)); tg.setIndex([0, 1, 2, 0, 2, 3]);
    this.trA = new THREE.InstancedBufferAttribute(new Float32Array(this.tracerMax * 4), 4); this.trB = new THREE.InstancedBufferAttribute(new Float32Array(this.tracerMax * 4), 4);
    this.trA.setUsage(THREE.DynamicDrawUsage); this.trB.setUsage(THREE.DynamicDrawUsage);
    tg.setAttribute('aA', this.trA); tg.setAttribute('aB', this.trB); tg.instanceCount = 0; tg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e8);
    this.tracerGeo = tg;
    const trMat = new THREE.ShaderMaterial({
      uniforms: { uThermal: GU.uThermal },
      vertexShader: /* glsl */`
        attribute vec4 aA; attribute vec4 aB; varying float vU; varying float vSide; varying float vI;
        void main() {
          vec3 a = aA.xyz, b = aB.xyz; vec3 p = mix(a, b, position.x);
          vec3 dir = b - a; vec3 toCam = cameraPosition - p;
          vec3 side = normalize(cross(dir, toCam));
          float dist = length(toCam);
          float w = max(aA.w, dist * 0.0016);
          p += side * position.y * w;
          vU = position.x; vSide = position.y; vI = aB.w * clamp(aA.w / w, 0.25, 1.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uThermal; varying float vU; varying float vSide; varying float vI;
        void main() {
          float a = (1.0 - vSide * vSide) * smoothstep(0.0, 0.4, vU);
          vec3 c = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.9, 0.6), vU) * 22.0 * vI;
          if (uThermal > 0.5) c = vec3(1.5);
          gl_FragColor = vec4(c * a, 0.0);
        }`,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.tracerMesh = new THREE.Mesh(tg, trMat); this.tracerMesh.frustumCulled = false; this.scene.add(this.tracerMesh);
    // shockwave distortion material
    this.shockMat = new THREE.ShaderMaterial({
      uniforms: { uStr: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uStr; varying vec3 vN; varying vec3 vV; void main(){ float rim = 1.0 - abs(dot(vN, vV)); float ring = pow(rim, 4.0); gl_FragColor = vec4(vN.xy * ring * uStr, 0.0, 1.0); }`,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.shockGeo = new THREE.SphereGeometry(1, 24, 16);
    // Wilson cloud (condensation shell) material
    this.wilsonMat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 }, uNoiseTex: GU.uNoiseTex, uSkyAmb: GU.uSkyAmb, uSunColor: GU.uSunColor, uThermal: GU.uThermal },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uA; uniform sampler2D uNoiseTex; uniform vec3 uSkyAmb; uniform vec3 uSunColor; uniform float uThermal; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ float rim = 1.0 - abs(dot(vN, vV)); float n = texture(uNoiseTex, vP.xz * 0.6 + vP.y * 0.3).r;
          float a = uA * (0.25 + 0.75 * pow(rim, 1.5)) * smoothstep(0.25, 0.7, n + 0.2) * smoothstep(-0.05, 0.25, vP.y);
          vec3 c = uThermal > 0.5 ? vec3(0.1) : vec3(0.9) * (uSkyAmb * 1.2 + uSunColor * 0.08);
          gl_FragColor = vec4(c * a, a); }`,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.wilsonGeo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    this.shake = 0;
  }

  setDepth(depthTex, w, h) { this.depthU.uDepth.value = depthTex; this.depthU.uRes.value.set(w, h); }

  // ---- small helpers ----
  bulletHit(p, kind) {
    const A = this.ps.add;
    for (let i = 0; i < 4; i++) A.spawn(PT.SPARK, p.x, p.y, p.z, (Math.random() - 0.5) * 40, Math.random() * 30, (Math.random() - 0.5) * 40, 0.25, 0.3 + Math.random() * 0.3, { color: [6, 4, 1.5], drag: 0.3 });
    A.spawn(PT.FLASH, p.x, p.y, p.z, 0, 0, 0, 1.6, 0.06, { color: [8, 6, 3] });
    this.ps.alpha.spawn(PT.SMOKE, p.x, p.y, p.z, 0, 1, 0, 1.2, 1.4, { grow: 2, color: [0.2, 0.2, 0.2], alpha: 0.5, heat: 0.6 });
    if (Math.random() < 0.3) this.game.audio.bulletHit(p);
  }
  bulletImpact(p, kind) {
    if (kind === 'water') { for (let i = 0; i < 3; i++) this.ps.alpha.spawn(PT.SPRAY, p.x, p.y, p.z, (Math.random() - 0.5) * 3, 8 + Math.random() * 10, (Math.random() - 0.5) * 3, 0.8, 1.0, { grow: 1.5, color: [0.85, 0.88, 0.9], alpha: 0.7, drag: 0.4 }); return; }
    this.ps.alpha.spawn(PT.DUST, p.x, p.y + 0.5, p.z, (Math.random() - 0.5) * 3, 4 + Math.random() * 3, (Math.random() - 0.5) * 3, 1.5, 2.0, { grow: 2.5, color: [0.35, 0.3, 0.24], alpha: 0.7, drag: 0.8 });
    if (Math.random() < 0.5) this.ps.add.spawn(PT.SPARK, p.x, p.y, p.z, (Math.random() - 0.5) * 20, 10 + Math.random() * 20, (Math.random() - 0.5) * 20, 0.2, 0.25, { color: [6, 4, 1.5] });
  }
  dustPuff(p, s) { this.ps.alpha.spawn(PT.DUST, p.x, p.y, p.z, 0, 1.5, 0, s * 2, 1.8, { grow: s * 1.5, color: [0.32, 0.28, 0.22], alpha: 0.6, drag: 0.8 }); }
  splash(p, s) {
    this.game.ocean.addSplash(p.x, p.z, s * 2);
    for (let i = 0; i < 6 + s * 2; i++) this.ps.alpha.spawn(PT.SPRAY, p.x, p.y, p.z, (Math.random() - 0.5) * s * 3, 6 + Math.random() * s * 6, (Math.random() - 0.5) * s * 3, s * 0.8, 1.6 + Math.random(), { grow: s * 0.8, color: [0.88, 0.9, 0.92], alpha: 0.75, drag: 0.35 });
    this.game.audio.splash(p, s);
  }
  muzzleFlash(p, dir, size = 1) {
    this.ps.add.spawn(PT.MUZZLE, p.x + dir.x, p.y + dir.y, p.z + dir.z, 0, 0, 0, 1.4 * size, 0.04, { color: [14, 9, 4] });
    this.lights.add(p, [1, 0.7, 0.35], 2500 * size, 0.06);
  }
  flareVisual(f) { this.ps.add.spawn(PT.FLARE, f.pos.x, f.pos.y, f.pos.z, f.vel.x, f.vel.y, f.vel.z, 2.2, 0.06, { color: [40, 34, 26], drag: 0 }); }
  steam(p, rate, dir) { this.ps.alpha.spawn(PT.STEAM, p.x, p.y, p.z, dir.x * 2 + (Math.random() - 0.5) * 2, 2 + Math.random() * 3, dir.z * 2 + (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, 2.5 + Math.random() * 2, { grow: 2.5, color: [0.95, 0.95, 0.95], alpha: 0.55 * rate, drag: 0.6, buoy: 1.5 }); }

  // persistent burning wreck emitter
  addFire(pos, intensity = 1, duration = 240, o = {}) {
    const e = { pos: pos.clone(), I: intensity, life: duration, age: 0, acc: 0, follow: o.follow || null, smokeOnly: !!o.smokeOnly };
    this.emitters.push(e);
    if (!e.smokeOnly) e.light = this.lights.add(pos, [1, 0.5, 0.2], 3000 * intensity, duration, { decay: 0.3, follow: (s) => { if (e.follow) s.pos.copy(e.follow()); s.I = s.I0 * (0.75 + Math.random() * 0.25) * Math.max(0, 1 - e.age / e.life); } });
    return e;
  }

  // ---------------- the 5-stage detonation ----------------
  explosion(p, size, o = {}) {
    const g = this.game; const A = this.ps.add, S = this.ps.alpha;
    const water = !!o.water; const surface = o.surface || 'air';
    // Stage 1: thermal flash (sub-frame HDR light spike + blinding white core)
    this.lights.add(p, [1, 0.85, 0.65], 5000 * size * size, 0.2 + size * 0.03, { decay: 3 });
    this.lights.add(p, [1, 0.45, 0.15], 1500 * size * size, 1.2 + size * 0.25, { decay: 1.5 });
    A.spawn(PT.FLASH, p.x, p.y, p.z, 0, 0, 0, 4 + size * 5, 0.12 + size * 0.015, { color: [60, 52, 45], must: true });
    A.spawn(PT.FLASH, p.x, p.y, p.z, 0, 0, 0, 2 + size * 2.5, 0.25 + size * 0.02, { color: [30, 18, 8] });
    // Stage 2: refractive shockwave + Wilson condensation cloud
    const shockR = 25 + size * 22;
    const sm = new THREE.Mesh(this.shockGeo, this.shockMat.clone()); sm.position.copy(p); sm.scale.setScalar(1); sm.frustumCulled = false;
    this.pipe.distScene.add(sm);
    this.shocks.push({ mesh: sm, age: 0, life: 0.45 + size * 0.06, R: shockR, kind: 'shock' });
    if (size >= 6 && (water || p.y < 120)) {
      const wm = new THREE.Mesh(this.wilsonGeo, this.wilsonMat.clone()); wm.position.copy(p); wm.position.y = Math.max(p.y - 4, water ? 0 : p.y - 4); wm.frustumCulled = false;
      this.scene.add(wm); this.shocks.push({ mesh: wm, age: 0, life: 1.1, R: shockR * 1.3, kind: 'wilson' });
    }
    // Stage 3: volumetric fireball cooling into a towering smoke column
    const nf = Math.floor(8 + size * 7);
    for (let i = 0; i < nf; i++) {
      const dir = _v.set(Math.random() - 0.5, Math.random() * (surface === 'air' ? 1 : 0.8) - (surface === 'air' ? 0.5 : -0.1), Math.random() - 0.5).normalize();
      const sp = (2 + Math.random() * 6) * Math.sqrt(size) * 2.2;
      A.spawn(PT.FIRE, p.x + dir.x * size * 0.6, p.y + dir.y * size * 0.6, p.z + dir.z * size * 0.6, dir.x * sp, dir.y * sp + size * 0.8, dir.z * sp,
        (1.5 + Math.random() * 2.5) * Math.pow(size, 0.8), 0.5 + Math.random() * 0.6 + size * 0.06, { grow: size * 2.2, drag: 2.0, buoy: 6 + size, color: [1, 1, 1], must: i < 6 });
    }
    const ns = Math.floor(6 + size * 5);
    for (let i = 0; i < ns; i++) {
      const dir = _v.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      const sp = (1 + Math.random() * 4) * Math.sqrt(size) * 1.6;
      const dark = surface === 'air' ? 0.16 + Math.random() * 0.1 : 0.05 + Math.random() * 0.06;
      S.spawn(PT.SMOKE, p.x + dir.x * size, p.y + dir.y * size, p.z + dir.z * size, dir.x * sp, dir.y * sp + 2, dir.z * sp,
        (2 + Math.random() * 3) * Math.pow(size, 0.85), 6 + Math.random() * 6 + size * 2, { grow: 1.2 + size * 0.9, drag: 0.7, buoy: 2 + size * 0.6, color: [dark, dark * 0.95, dark * 0.9], alpha: 0.9, heat: 0.9 });
    }
    // Stage 4: debris, shrapnel and arcing white-hot sparks trailing smoke
    if (surface !== 'water') {
      const nd = surface === 'air' ? Math.floor(size * 2) : Math.floor(size * 4);
      for (let i = 0; i < nd; i++) {
        const dir = _v.set(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize();
        this.debris.spawn(p, dir.multiplyScalar(10 + Math.random() * 25 * Math.sqrt(size)), 0.2 + Math.random() * 0.5 * Math.sqrt(size), 6 + Math.random() * 10, Math.random() < 0.35);
      }
      const nsp = Math.floor(size * 6);
      for (let i = 0; i < nsp; i++) {
        const dir = _v.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize(); const sp = 25 + Math.random() * 45 * Math.sqrt(size);
        A.spawn(PT.EMBER, p.x, p.y, p.z, dir.x * sp, dir.y * sp, dir.z * sp, 0.35, 1.2 + Math.random() * 1.6, { color: [12, 9, 6], drag: 0.25 });
      }
      if (size >= 5) {
        // white phosphorus-like streamers with smoke ribbons
        for (let i = 0; i < Math.min(8, size); i++) {
          const dir = _v.set(Math.random() - 0.5, 0.5 + Math.random() * 0.8, Math.random() - 0.5).normalize();
          const tr = this.trails.create({ kind: 'smoke', width: 0.8, grow: 0.5, maxAge: 5, opacity: 0.7, color: [0.92, 0.92, 0.9], minStep: 2 });
          this.emitters.push({ streamer: true, pos: p.clone(), vel: dir.multiplyScalar(30 + Math.random() * 40), trail: tr, age: 0, life: 1.6 + Math.random(), acc: 0 });
        }
      }
      if (surface === 'ground' || surface === 'target') {
        for (let i = 0; i < 6 + size * 3; i++) S.spawn(PT.DUST, p.x, p.y, p.z, (Math.random() - 0.5) * size * 8, 2 + Math.random() * size * 3, (Math.random() - 0.5) * size * 8, size * 1.2, 4 + Math.random() * 4, { grow: size * 1.6, color: [0.33, 0.28, 0.22], alpha: 0.75, drag: 0.9, heat: 0.4 });
      }
    } else {
      // water: towering spray column
      const n = 10 + size * 6;
      for (let i = 0; i < n; i++) S.spawn(PT.SPRAY, p.x + (Math.random() - 0.5) * size, p.y, p.z + (Math.random() - 0.5) * size, (Math.random() - 0.5) * size * 3, 10 + Math.random() * size * 9, (Math.random() - 0.5) * size * 3, size * 1.4, 2.5 + Math.random() * 2, { grow: size * 1.2, color: [0.9, 0.92, 0.94], alpha: 0.85, drag: 0.25 });
      this.game.ocean.addSplash(p.x, p.z, size * 3);
    }
    // Stage 5: acoustic delay (speed of sound) + pressure wave buffet when it arrives
    const camPos = g.camera.position; const d = camPos.distanceTo(p);
    const delay = d / 343;
    g.audio.explosion(p, size, delay);
    this.pending.push({ t: delay, fn: () => { const k = size * size * 18 / (d + 30); this.shake = Math.min(1.5, this.shake + k); } });
    g.onBlast(p, size);
  }

  update(dt, camera) {
    const g = this.game;
    this.setDepth(this.pipe.depthTexture, this.pipe.w, this.pipe.h);
    // pending delayed events
    for (let i = this.pending.length - 1; i >= 0; i--) { const e = this.pending[i]; e.t -= dt; if (e.t <= 0) { e.fn(); this.pending.splice(i, 1); } }
    // shockwaves & wilson clouds
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i]; s.age += dt; const f = s.age / s.life;
      if (f >= 1) { s.mesh.parent && s.mesh.parent.remove(s.mesh); this.shocks.splice(i, 1); continue; }
      if (s.kind === 'shock') { s.mesh.scale.setScalar(Math.max(1, s.R * Math.sqrt(f))); s.mesh.material.uniforms.uStr.value = 0.035 * (1 - f); }
      else { s.mesh.scale.set(s.R * (0.4 + 0.6 * Math.sqrt(f)), s.R * (0.25 + 0.4 * f), s.R * (0.4 + 0.6 * Math.sqrt(f))); s.mesh.material.uniforms.uA.value = 0.7 * Math.sin(Math.PI * Math.min(1, f * 1.3)) * (1 - f); }
    }
    // emitters: burning wrecks & streamers
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i]; e.age += dt;
      if (e.age > e.life) { if (e.trail) e.trail.stop(); this.emitters.splice(i, 1); continue; }
      if (e.streamer) {
        e.vel.y -= 9.81 * dt; e.pos.addScaledVector(e.vel, dt); e.trail.add(e.pos);
        this.ps.add.spawn(PT.EMBER, e.pos.x, e.pos.y, e.pos.z, 0, 0, 0, 0.5, 0.15, { color: [15, 14, 12] });
        continue;
      }
      if (e.follow) e.pos.copy(e.follow());
      e.acc += dt; const k = Math.max(0.15, 1 - e.age / e.life);
      const rate = 0.08 / Math.max(e.I, 0.3);
      while (e.acc > rate) {
        e.acc -= rate;
        const w = g.wind;
        if (!e.smokeOnly) this.ps.add.spawn(PT.FIRE, e.pos.x + (Math.random() - 0.5) * 3 * e.I, e.pos.y + Math.random() * 2, e.pos.z + (Math.random() - 0.5) * 3 * e.I, 0, 3 + Math.random() * 3, 0, (2 + Math.random() * 2) * e.I, 0.6 + Math.random() * 0.5, { grow: 1.5 * e.I, drag: 1.5, buoy: 7, color: [0.8, 0.8, 0.8] });
        this.ps.alpha.spawn(PT.SMOKE, e.pos.x, e.pos.y + 3 * e.I, e.pos.z, w.x * 0.3, 4 + 3 * e.I, w.z * 0.3, (3 + Math.random() * 3) * e.I, (14 + Math.random() * 10) * (0.5 + 0.5 * k), { grow: 2.2 * e.I + 1, drag: 0.35, buoy: 5 + 3 * e.I, color: [0.05, 0.048, 0.045], alpha: 0.85 * k, heat: 0.7 });
      }
    }
    this.ps.alpha.update(dt, camera, g.wind);
    this.ps.add.update(dt, camera, g.wind);
    this.trails.update(dt, camera);
    this.debris.update(dt, g);
    this.lights.update(dt, camera.position);
    this.updateTracers(g.bullets);
    this.shake *= Math.exp(-dt * 3.5);
  }

  updateTracers(b) {
    let n = 0; const A = this.trA.array, B = this.trB.array;
    for (let i = 0; i < b.n && n < this.tracerMax; i++) {
      if (!b.tracer[i]) continue;
      const x = b.p[i * 3], y = b.p[i * 3 + 1], z = b.p[i * 3 + 2]; const vx = b.v[i * 3], vy = b.v[i * 3 + 1], vz = b.v[i * 3 + 2];
      const L = 0.035;
      A[n * 4] = x - vx * L; A[n * 4 + 1] = y - vy * L; A[n * 4 + 2] = z - vz * L; A[n * 4 + 3] = b.tracer[i] === 2 ? 0.35 : 0.22;
      B[n * 4] = x; B[n * 4 + 1] = y; B[n * 4 + 2] = z; B[n * 4 + 3] = Math.min(1, b.life[i] * 2);
      n++;
    }
    this.tracerGeo.instanceCount = n; this.trA.needsUpdate = true; this.trB.needsUpdate = true;
  }
}
