// Physical Rayleigh/Mie sky: generated into an equirect HDR texture on the GPU when the sun or the
// observer altitude changes; sky dome samples it and adds the sun disk + stars. Also derives the
// sun irradiance and sky ambient on the CPU with the same model, and a PMREM env map for PBR.
import * as THREE from 'three';
import { GU, GLSL_COMMON, FULLSCREEN_VS, fullscreenTriangle } from './glsl.js';

const ATMO_GLSL = /* glsl */`
const float Re = 6360e3;
const float Ra = 6460e3;
const vec3 bR = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const float bM = 21e-6;
const float HR = 8000.0;
const float HM = 1200.0;
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd); float c = dot(ro, ro) - r * r; float d = b * b - c;
  if (d < 0.0) return vec2(1e20, -1e20);
  d = sqrt(d); return vec2(-b - d, -b + d);
}
vec3 atmosphere(vec3 ro, vec3 rd, vec3 sd, float sunI) {
  vec2 pa = raySphere(ro, rd, Ra);
  if (pa.x > pa.y) return vec3(0.0);
  vec2 pg = raySphere(ro, rd, Re);
  float tmin = max(pa.x, 0.0);
  float tmax = pa.y;
  if (pg.x < pg.y && pg.x > 0.0) tmax = min(tmax, pg.x);
  const int NS = 20; const int NL = 8;
  float ds = (tmax - tmin) / float(NS);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  float mu = dot(rd, sd);
  float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = 0.76;
  float phM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  for (int i = 0; i < NS; i++) {
    vec3 pos = ro + rd * (tmin + (float(i) + 0.5) * ds);
    float h = length(pos) - Re;
    float hr = exp(-h / HR) * ds; float hm = exp(-h / HM) * ds;
    odR += hr; odM += hm;
    vec2 pl = raySphere(pos, sd, Ra);
    vec2 plg = raySphere(pos, sd, Re);
    if (plg.x < plg.y && plg.x > 0.0) continue;
    float dsl = pl.y / float(NL);
    float odRl = 0.0, odMl = 0.0;
    for (int j = 0; j < NL; j++) {
      vec3 pj = pos + sd * ((float(j) + 0.5) * dsl);
      float hj = max(length(pj) - Re, 0.0);
      odRl += exp(-hj / HR) * dsl; odMl += exp(-hj / HM) * dsl;
    }
    vec3 tau = bR * (odR + odRl) + bM * 1.1 * (odM + odMl);
    vec3 att = exp(-tau);
    sumR += hr * att; sumM += hm * att;
  }
  return sunI * (sumR * bR * phR + sumM * bM * phM);
}
`;

// JS port (for sun colour / ambient) ---------------------------------------------------------
const Re = 6360e3, Ra = 6460e3, HR = 8000, HM = 1200, bM = 21e-6;
const bR = [5.5e-6, 13.0e-6, 22.4e-6];
function raySphere(ro, rd, r) {
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - r * r;
  let d = b * b - c; if (d < 0) return [1e20, -1e20]; d = Math.sqrt(d); return [-b - d, -b + d];
}
export function sunTransmittance(alt, sd) {
  const ro = [0, Re + Math.max(alt, 1), 0];
  const pg = raySphere(ro, sd, Re);
  if (pg[0] < pg[1] && pg[0] > 0) return [0, 0, 0];
  const pa = raySphere(ro, sd, Ra); const n = 24; const ds = pa[1] / n;
  let odR = 0, odM = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * ds; const p = [ro[0] + sd[0] * t, ro[1] + sd[1] * t, ro[2] + sd[2] * t];
    const h = Math.max(Math.hypot(p[0], p[1], p[2]) - Re, 0);
    odR += Math.exp(-h / HR) * ds; odM += Math.exp(-h / HM) * ds;
  }
  return bR.map(b => Math.exp(-(b * odR + bM * 1.1 * odM)));
}
function atmoJS(alt, rd, sd, sunI) {
  const ro = [0, Re + Math.max(alt, 1), 0];
  const pa = raySphere(ro, rd, Ra); if (pa[0] > pa[1]) return [0, 0, 0];
  const pg = raySphere(ro, rd, Re);
  const tmin = Math.max(pa[0], 0); let tmax = pa[1]; if (pg[0] < pg[1] && pg[0] > 0) tmax = Math.min(tmax, pg[0]);
  const NS = 12, NL = 6; const ds = (tmax - tmin) / NS;
  const mu = rd[0] * sd[0] + rd[1] * sd[1] + rd[2] * sd[2];
  const phR = 3 / (16 * Math.PI) * (1 + mu * mu), g = 0.76;
  const phM = 3 / (8 * Math.PI) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
  let odR = 0, odM = 0; const sR = [0, 0, 0]; let sM = [0, 0, 0];
  for (let i = 0; i < NS; i++) {
    const t = tmin + (i + 0.5) * ds; const p = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const h = Math.hypot(p[0], p[1], p[2]) - Re; const hr = Math.exp(-h / HR) * ds, hm = Math.exp(-h / HM) * ds;
    odR += hr; odM += hm;
    const plg = raySphere(p, sd, Re); if (plg[0] < plg[1] && plg[0] > 0) continue;
    const pl = raySphere(p, sd, Ra); const dsl = pl[1] / NL; let oR = 0, oM = 0;
    for (let j = 0; j < NL; j++) {
      const tj = (j + 0.5) * dsl; const q = [p[0] + sd[0] * tj, p[1] + sd[1] * tj, p[2] + sd[2] * tj];
      const hj = Math.max(Math.hypot(q[0], q[1], q[2]) - Re, 0); oR += Math.exp(-hj / HR) * dsl; oM += Math.exp(-hj / HM) * dsl;
    }
    for (let k = 0; k < 3; k++) {
      const att = Math.exp(-(bR[k] * (odR + oR) + bM * 1.1 * (odM + oM)));
      sR[k] += hr * att; sM[k] += hm * att;
    }
  }
  return [0, 1, 2].map(k => sunI * (sR[k] * bR[k] * phR + sM[k] * bM * phM));
}

export const SUN_I = 20;

export class Sky {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(512, 256, {
      type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, generateMipmaps: false,
    });
    this.rt.texture.wrapS = THREE.RepeatWrapping;
    this.rt.texture.mapping = THREE.EquirectangularReflectionMapping;
    GU.uSkyTex.value = this.rt.texture;
    this.genMat = new THREE.ShaderMaterial({
      uniforms: { uSunDirGen: { value: new THREE.Vector3() }, uAlt: { value: 0 }, uSunI: { value: SUN_I }, uNightSky: { value: 0 } },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: /* glsl */`
        #define PI 3.14159265359
        uniform vec3 uSunDirGen; uniform float uAlt; uniform float uSunI; uniform float uNightSky;
        varying vec2 vUv;
        ${ATMO_GLSL}
        void main() {
          float phi = (vUv.x - 0.5) * 2.0 * PI; float th = (vUv.y - 0.5) * PI;
          vec3 rd = vec3(sin(phi) * cos(th), sin(th), -cos(phi) * cos(th));
          vec3 ro = vec3(0.0, Re + max(uAlt, 2.0), 0.0);
          vec3 col = atmosphere(ro, rd, uSunDirGen, uSunI);
          // moonlit / airglow floor so night is not pitch black
          vec3 night = vec3(0.004, 0.006, 0.012) * (0.4 + 0.6 * smoothstep(-0.1, 0.4, rd.y)) * uNightSky;
          col += night;
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(fullscreenTriangle(), this.genMat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Sky dome
    const domeMat = new THREE.ShaderMaterial({
      uniforms: { ...pickGU() },
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        #include <logdepthbuf_pars_fragment>
        varying vec3 vDir;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 d = normalize(vDir);
          vec3 dq = d; if (dq.y < 0.0) dq.y = 0.004 * (1.0 + dq.y);
          vec3 col = sampleSky(normalize(dq));
          if (uThermal > 0.5) { gl_FragColor = vec4(vec3(0.04 + 0.08 * (1.0 - abs(d.y))), 1.0); return; }
          float mu = dot(d, uSunDir);
          float r = 0.0095;
          float c = 1.0 - mu;
          float disk = 1.0 - smoothstep(r * r * 0.5 * 0.8, r * r * 0.5, c);
          if (disk > 0.0) {
            float x = clamp(c / (r * r * 0.5), 0.0, 1.0);
            float limb = 0.55 + 0.45 * sqrt(1.0 - x);
            col += uSunColor * disk * limb * 7.0 * smoothstep(-0.02, 0.01, d.y);
          }
          // stars at night
          if (uNight > 0.01 && d.y > 0.0) {
            vec3 sd = d * 420.0; vec3 cell = floor(sd); float h = hash13(cell);
            if (h > 0.9965) {
              vec3 f = fract(sd) - 0.5; float s = smoothstep(0.18, 0.0, length(f));
              float tw = 0.75 + 0.25 * sin(uTime * (2.0 + h * 9.0) + h * 40.0);
              col += vec3(0.8, 0.85, 1.0) * s * tw * uNight * (h - 0.9965) * 900.0 * smoothstep(0.0, 0.2, d.y);
            }
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: true,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(150000, 48, 24), domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;

    this.sunLight = new THREE.DirectionalLight(0xffffff, 3);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const sc = this.sunLight.shadow.camera;
    sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 6000;
    this.sunLight.shadow.bias = -0.0004; this.sunLight.shadow.normalBias = 0.04;
    this.hemi = new THREE.HemisphereLight(0x8899aa, 0x223344, 0.0);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastAlt = -1e9; this.lastSun = new THREE.Vector3(9, 9, 9);
    this.hours = 9.5; this.dirty = true;
    this.exposure = 0.35;
  }

  setTime(hours) { this.hours = hours; this.dirty = true; this.computeSunDir(); }

  computeSunDir() {
    // simple diurnal arc: sunrise ~6h east, noon ~south at 62 deg, sunset ~18h west
    const h = this.hours;
    const dayFrac = (h - 6) / 12; // 0 at sunrise, 1 at sunset
    const elev = Math.sin(Math.PI * dayFrac) * THREE.MathUtils.degToRad(62) - (dayFrac < 0 || dayFrac > 1 ? 0.25 : 0);
    const az = THREE.MathUtils.degToRad(90 + 180 * dayFrac); // from north, clockwise
    const ce = Math.cos(elev);
    let dir = new THREE.Vector3(Math.sin(az) * ce, Math.sin(elev), -Math.cos(az) * ce).normalize();
    this.isNight = dir.y < -0.05;
    this.moon = null;
    if (this.isNight) {
      // moon: lights the scene dimly from the south-west
      this.moonDir = new THREE.Vector3(-0.35, 0.55, 0.6).normalize();
    }
    GU.uSunDir.value.copy(dir);
    return dir;
  }

  update(camPos, frame) {
    const sd = GU.uSunDir.value;
    const alt = camPos.y;
    const altChanged = Math.abs(alt - this.lastAlt) > 250;
    const sunChanged = this.lastSun.distanceToSquared(sd) > 1e-6;
    if (!(this.dirty || sunChanged || (altChanged && frame % 6 === 0))) return false;
    this.dirty = false; this.lastAlt = alt; this.lastSun.copy(sd);
    const night = THREE.MathUtils.clamp((-sd.y - 0.0) / 0.12, 0, 1);
    GU.uNight.value = night;
    this.genMat.uniforms.uSunDirGen.value.copy(sd);
    this.genMat.uniforms.uAlt.value = alt;
    this.genMat.uniforms.uNightSky.value = night;
    const r = this.renderer; const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt); r.render(this.quadScene, this.quadCam); r.setRenderTarget(prev);

    // sun irradiance (transmitted) and ambient
    const sdArr = [sd.x, sd.y, sd.z];
    const tr = sunTransmittance(alt, sdArr);
    const fade = THREE.MathUtils.smoothstep(sd.y, -0.03, 0.04);
    GU.uSunColor.value.set(tr[0] * SUN_I * fade, tr[1] * SUN_I * fade, tr[2] * SUN_I * fade);
    // mean sky radiance over upper hemisphere (few samples)
    const acc = [0, 0, 0]; let n = 0;
    const dirs = [[0, 1, 0], [0.7, 0.5, 0], [-0.7, 0.5, 0], [0, 0.5, 0.7], [0, 0.5, -0.7], [0.9, 0.15, 0.3], [-0.9, 0.15, -0.3], [0.3, 0.15, 0.9], [-0.3, 0.15, -0.9]];
    for (const d of dirs) {
      const l = Math.hypot(...d); const dd = d.map(v => v / l);
      const c = atmoJS(alt, dd, sdArr, SUN_I); acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; n++;
    }
    const nightAmb = 0.015 * night;
    GU.uSkyAmb.value.set(acc[0] / n + nightAmb * 0.6, acc[1] / n + nightAmb * 0.8, acc[2] / n + nightAmb * 1.3);
    const gA = GU.uSkyAmb.value.clone().multiplyScalar(0.25).add(new THREE.Vector3(...GU.uSunColor.value.toArray()).multiplyScalar(0.012 * Math.max(sd.y, 0)));
    GU.uGroundAmb.value.copy(gA);

    // directional light: sun by day, moon by night
    if (this.isNight) {
      this.sunLight.color.setRGB(0.55, 0.65, 0.9);
      this.sunLight.intensity = 0.08;
      this.lightDir = this.moonDir;
    } else {
      const sc = GU.uSunColor.value; const m = Math.max(sc.x, sc.y, sc.z, 1e-6);
      this.sunLight.color.setRGB(sc.x / m, sc.y / m, sc.z / m);
      this.sunLight.intensity = m;
      this.lightDir = sd;
    }
    // exposure: daylight vs dusk vs night
    const dayL = Math.max(acc[1] / n, 0.0005);
    this.exposure = THREE.MathUtils.clamp(0.42 / Math.pow(dayL / 0.9, 0.6), 0.25, 9.0);
    return true;
  }

  updateEnv() {
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromEquirectangular(this.rt.texture);
    return this.envRT.texture;
  }

  followCamera(cam, focus) {
    this.dome.position.copy(cam.position);
    const L = this.lightDir || GU.uSunDir.value;
    // keep shadow map texel-snapped around the focus point to avoid shimmering
    const s = this.sunLight; const texel = 220 / 2048;
    const f = focus.clone();
    s.target.position.copy(f);
    s.position.copy(f).addScaledVector(L, 3000);
    s.target.updateMatrixWorld();
    s.updateMatrixWorld();
    // snap in light space
    const m = new THREE.Matrix4().lookAt(s.position, s.target.position, new THREE.Vector3(0, 1, 0));
    const inv = m.clone().invert();
    const lp = f.clone().applyMatrix4(inv);
    lp.x = Math.round(lp.x / texel) * texel; lp.y = Math.round(lp.y / texel) * texel;
    const snapped = lp.applyMatrix4(m);
    const off = snapped.sub(f);
    s.target.position.add(off); s.position.add(off);
    s.target.updateMatrixWorld();
  }
}

function pickGU() {
  const names = ['uTime', 'uSunDir', 'uSunColor', 'uSkyAmb', 'uGroundAmb', 'uSkyTex', 'uFogDensity', 'uFogHeight', 'uThermal', 'uNight'];
  const o = {}; for (const n of names) o[n] = GU[n]; return o;
}
