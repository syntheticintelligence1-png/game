// Raymarched volumetric cloud deck (half resolution, depth-aware) + procedural noise textures.
import * as THREE from 'three';
import { GU, GLSL_COMMON, GLSL_CLOUDS, FULLSCREEN_VS } from './glsl.js';
import { makeCloudNoise3D, mulberry32 } from '../core/noise.js';

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

export function makeWeatherTexture(size = 512, seed = 3) {
  const data = new Uint8Array(size * size * 4);
  const big = periodicFbm(seed, 3, 4), mid = periodicFbm(seed + 9, 8, 4), typ = periodicFbm(seed + 17, 4, 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4;
    let c = 0.5 + 0.85 * big(u, v) + 0.55 * mid(u, v);
    c = Math.min(1, Math.max(0, c));
    data[i] = Math.round(c * 255);
    data[i + 1] = Math.round(Math.min(1, Math.max(0, 0.55 + typ(u, v) * 1.2)) * 255);
    data[i + 2] = 0; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function makeNoise3DTexture(size = 64) {
  const data = makeCloudNoise3D(size, 7);
  const t = new THREE.Data3DTexture(data, size, size, size);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

export function initCloudTextures() {
  GU.uNoiseTex.value = makeNoiseTexture(256);
  GU.uWeatherTex.value = makeWeatherTexture(512, 3);
  GU.uNoise3D.value = makeNoise3DTexture(64);
}

export function makeCloudMaterial() {
  const u = {};
  for (const n of ['uTime', 'uSunDir', 'uSunColor', 'uSkyAmb', 'uGroundAmb', 'uSkyTex', 'uFogDensity', 'uFogHeight', 'uThermal', 'uNight',
    'uWeatherTex', 'uNoise3D', 'uCloudBase', 'uCloudTop', 'uCloudCover', 'uWeatherScale', 'uWind', 'uLogFar']) u[n] = GU[n];
  Object.assign(u, {
    uDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
    uCamPosC: { value: new THREE.Vector3() }, uSteps: { value: 48 }, uFrame: { value: 0 },
    uPlumePos: { value: new THREE.Vector3() }, uPlumeCol: { value: new THREE.Vector3() },
  });
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: FULLSCREEN_VS,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_CLOUDS}
      uniform sampler2D uDepth; uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform vec3 uCamPosC;
      uniform float uLogFar; uniform int uSteps; uniform float uFrame;
      uniform vec3 uPlumePos; uniform vec3 uPlumeCol;
      varying vec2 vUv;
      float hg(float mu, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5)); }
      void main() {
        vec4 vr = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 vdir = normalize(vr.xyz / vr.w);
        vec3 rd = normalize(mat3(uCamWorld) * vdir);
        vec3 ro = uCamPosC;
        float d = texture(uDepth, vUv).r;
        float sceneDist = d < 0.999999 ? (exp2(d * uLogFar) - 1.0) / max(-vdir.z, 1e-4) : 1e9;
        float t0, t1;
        if (abs(rd.y) < 1e-5) {
          if (ro.y < uCloudBase || ro.y > uCloudTop) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          t0 = 0.0; t1 = 1e9;
        } else {
          float ta = (uCloudBase - ro.y) / rd.y, tb = (uCloudTop - ro.y) / rd.y;
          t0 = min(ta, tb); t1 = max(ta, tb);
        }
        t0 = max(t0, 0.0);
        t1 = min(t1, min(sceneDist, 70000.0));
        if (t1 <= t0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        float len = t1 - t0;
        float stepL = clamp(len / float(uSteps), 35.0, 900.0);
        float jitter = ign(gl_FragCoord.xy + mod(uFrame, 64.0) * vec2(5.588238, 3.2131));
        float t = t0 + stepL * jitter;
        vec3 scat = vec3(0.0); float T = 1.0; float tw = 0.0, ws = 0.0;
        float mu = dot(rd, uSunDir);
        float phase = mix(hg(mu, 0.72), hg(mu, -0.18), 0.32);
        const float SIG = 0.042;
        float sunVis = smoothstep(-0.04, 0.05, uSunDir.y);
        for (int i = 0; i < 128; i++) {
          if (i >= uSteps * 2 || t > t1 || T < 0.012) break;
          vec3 p = ro + rd * t;
          float lo = cloudDensityLo(p);
          if (lo <= 0.0) { t += stepL * 1.6; continue; }
          float dens = cloudDensityHi(p, t > 9000.0 ? 1.5 : 0.0);
          if (dens > 0.002) {
            float od = 0.0; float lt = 0.0;
            for (int j = 0; j < 5; j++) {
              float seg = 45.0 * pow(1.85, float(j));
              lt += seg;
              od += cloudDensityLo(p + uSunDir * (lt - seg * 0.5)) * seg;
            }
            float beer = exp(-SIG * od);
            float beerMS = exp(-SIG * od * 0.22);
            float powder = 1.0 - exp(-SIG * dens * 160.0);
            float hf = clamp((p.y - uCloudBase) / (uCloudTop - uCloudBase), 0.0, 1.0);
            vec3 sunL = uSunColor * sunVis * (beer * phase + beerMS * 0.055) * mix(0.55, 1.0, powder);
            vec3 amb = mix(uGroundAmb * 1.6 + uSkyAmb * 0.35, uSkyAmb * 1.15, hf);
            // rocket plume lighting the cloud from inside
            vec3 pl = uPlumePos - p; float pd2 = dot(pl, pl);
            vec3 plume = uPlumeCol * 4.0e4 / (pd2 + 2500.0);
            vec3 S = (sunL + amb + plume) * SIG * dens;
            float ext = SIG * dens;
            float Ts = exp(-ext * stepL);
            vec3 inc = T * S * (1.0 - Ts) / ext;
            scat += inc;
            float wgt = T * (1.0 - Ts); tw += t * wgt; ws += wgt;
            T *= Ts;
          }
          t += stepL;
        }
        if (ws > 0.0) {
          float md = tw / ws;
          float fT = fogTransmittance(ro, rd, md);
          vec3 dh = normalize(vec3(rd.x, max(rd.y, 0.0) * 0.6 + 0.015, rd.z));
          scat = scat * fT + sampleSky(dh) * (1.0 - T) * (1.0 - fT);
        }
        if (uThermal > 0.5) { float a = 1.0 - T; scat = vec3(0.18) * a; }
        gl_FragColor = vec4(scat, T);
      }`,
    depthTest: false, depthWrite: false,
  });
}
