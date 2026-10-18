// Gerstner-wave ocean: camera-following polar LOD grid, multi-octave Gerstner displacement in the vertex
// shader, per-pixel analytic normals plus short wind ripples (two tiles of a directional wave spectrum, re-summed
// on the GPU every frame with real dispersion), a planar reflection of the world and the clouds (Fresnel-weighted,
// blurred by the ripples too small to draw), microfacet sun glitter, wind-gust patches, subsurface light through
// crests, crest/shore foam, analytic Kelvin wakes (turbulent centreline, long calm slick, 19.47-degree arms, bow
// waves) per ship, explosion splash rings, cloud shadows.
// The same wave set is evaluated on the CPU for ship motion, splashes and sea-skimming missiles.
import * as THREE from 'three';
import { GU, GLSL_COMMON, GLSL_CLOUDS, GLSL_LIGHTS, FULLSCREEN_VS, fullscreenTriangle } from '../render/glsl.js';
import { mulberry32 } from '../core/noise.js';

const G = 9.81;
// direction (deg, travelling toward), wavelength m, amplitude m, steepness Q
const WAVES = [
  [250, 128, 0.62, 0.55],
  [228, 74, 0.42, 0.6],
  [272, 43, 0.25, 0.65],
  [205, 27, 0.16, 0.6],
  [290, 15.5, 0.085, 0.55],
  [240, 9.1, 0.05, 0.5],
  [180, 6.2, 0.03, 0.45],
  [315, 3.9, 0.018, 0.4],
];
export const MAX_SHIPS = 8;
export const MAX_SPLASH = 8;

// Ripple tiles: tile size m, shortest/longest wave in cycles per tile, wave count, mean square slope, spread of
// directions about the wind (rad). Integer wave numbers keep each tile seamless.
const RIPPLES = [
  { L: 27, n0: 3, n1: 40, N: 40, mss: 0.010, spread: 0.6, seed: 7 },
  { L: 4.3, n0: 2, n1: 36, N: 40, mss: 0.006, spread: 1.1, seed: 19 },
];
const RIPPLE_DIR = 80 * Math.PI / 180; // wind chop runs toward the east, with the game's wind
const RIPPLE_RES = 256;

function rippleWaves() {
  const out = [];
  for (const [ti, T] of RIPPLES.entries()) {
    const rnd = mulberry32(T.seed), seen = new Set();
    const amp = Math.sqrt(2 * T.mss / T.N);
    while (out.length < (ti + 1) * T.N) {
      const n = T.n0 * Math.pow(T.n1 / T.n0, rnd());
      const g = (rnd() + rnd() + rnd() - 1.5) * 2 * T.spread;
      const a = RIPPLE_DIR + g + (rnd() < 0.08 ? Math.PI : 0); // a few waves run against the wind
      const ix = Math.round(n * Math.sin(a)), iz = Math.round(-n * Math.cos(a));
      const key = `${ix},${iz}`; if ((!ix && !iz) || seen.has(key)) continue; seen.add(key);
      out.push(new THREE.Vector4(ix, iz, amp, rnd() * Math.PI * 2));
    }
  }
  return out;
}

class Ripples {
  constructor(renderer) {
    this.r = renderer;
    this.rt = new THREE.WebGLRenderTarget(RIPPLE_RES, RIPPLE_RES, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, anisotropy: 8,
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uW: { value: rippleWaves() }, uT: { value: 0 }, uL: { value: new THREE.Vector2(RIPPLES[0].L, RIPPLES[1].L) } },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: /* glsl */`
        uniform vec4 uW[80]; uniform float uT; uniform vec2 uL;
        varying vec2 vUv;
        // slope (dh/dx, dh/dz) of one tile: sum of waves w = (cycles x, cycles z, slope amplitude, phase)
        vec2 tile(int i0, float L) {
          vec2 s = vec2(0.0);
          for (int i = i0; i < i0 + 40; i++) {
            vec4 w = uW[i];
            float n = length(w.xy), k = 6.2831853 * n / L;
            float th = 6.2831853 * dot(w.xy, vUv) + w.w - sqrt(9.81 * k) * uT;
            s += (w.xy / n) * (w.z * cos(th));
          }
          return s;
        }
        void main() { gl_FragColor = vec4(tile(0, uL.x), tile(40, uL.y)); }`,
      depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene(); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const q = new THREE.Mesh(fullscreenTriangle(), this.mat); q.frustumCulled = false; this.scene.add(q);
  }
  update(t) {
    this.mat.uniforms.uT.value = t;
    const r = this.r, prev = r.getRenderTarget();
    r.setRenderTarget(this.rt); r.render(this.scene, this.cam); r.setRenderTarget(prev);
  }
}

export class Ocean {
  constructor(terrain, renderer) {
    this.terrain = terrain;
    this.waves = WAVES.map(([deg, L, A, Q]) => {
      const a = THREE.MathUtils.degToRad(deg); const k = 2 * Math.PI / L;
      return { dx: Math.sin(a), dz: -Math.cos(a), k, w: Math.sqrt(G * k), A, Q: Q / (k * A * WAVES.length) };
    });
    this.seaState = 1.0;
    const waveU = this.waves.map(w => new THREE.Vector4(w.dx, w.dz, w.k, w.A));
    const waveU2 = this.waves.map(w => new THREE.Vector2(w.w, w.Q));
    const ships = []; const ships2 = [];
    for (let i = 0; i < MAX_SHIPS; i++) { ships.push(new THREE.Vector4()); ships2.push(new THREE.Vector4()); }
    const spl = []; for (let i = 0; i < MAX_SPLASH; i++) spl.push(new THREE.Vector4(0, 0, -100, 0));
    this.ripples = renderer ? new Ripples(renderer) : null;
    const u = {};
    for (const n of ['uTime', 'uSunDir', 'uSunColor', 'uSkyAmb', 'uGroundAmb', 'uSkyTex', 'uFogDensity', 'uFogHeight', 'uThermal', 'uNight',
      'uNoiseTex', 'uWeatherTex', 'uNoise3D', 'uNoiseDetail', 'uCloudBase', 'uCloudTop', 'uCloudCover', 'uCloudDensity', 'uWeatherScale', 'uWind',
      'uLightPos', 'uLightCol', 'uReflTex', 'uReflMat', 'uReflOn']) u[n] = GU[n];
    Object.assign(u, {
      uWaves: { value: waveU }, uWaves2: { value: waveU2 }, uSea: { value: 1.0 },
      uShipA: { value: ships }, uShipB: { value: ships2 }, uShipCount: { value: 0 },
      uSplash: { value: spl },
      uShoreTex: { value: null }, uTerrHalf: { value: 20480 }, uTerrSize: { value: 40960 },
      uCamXZ: { value: new THREE.Vector2() },
      uRipTex: { value: this.ripples ? this.ripples.rt.texture : null }, uRipOn: { value: this.ripples ? 1 : 0 },
      uRipL: { value: new THREE.Vector2(RIPPLES[0].L, RIPPLES[1].L) }, uRipMss: { value: new THREE.Vector2(RIPPLES[0].mss, RIPPLES[1].mss) },
      uRough: { value: 1.0 },
    });
    this.uniforms = u;
    this.material = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        uniform vec4 uWaves[8]; uniform vec2 uWaves2[8]; uniform float uTime; uniform vec2 uCamXZ; uniform float uSea;
        varying vec3 vWP; varying vec2 vXZ; varying float vDist;
        void main() {
          vec2 xz = uCamXZ + position.xz;
          float dist = length(position.xz);
          vec3 disp = vec3(0.0);
          for (int i = 0; i < 8; i++) {
            vec4 w = uWaves[i]; vec2 w2 = uWaves2[i];
            // fade short waves with distance (they alias)
            float fade = 1.0 - smoothstep(2.0 * 6.2831 / w.z * 25.0, 6.2831 / w.z * 160.0, dist);
            float th = w.z * dot(w.xy, xz) - w2.x * uTime;
            float A = w.w * uSea * fade;
            disp.x += w2.y * A * w.x * cos(th);
            disp.z += w2.y * A * w.y * cos(th);
            disp.y += A * sin(th);
          }
          vec3 wp = vec3(xz.x + disp.x, disp.y, xz.y + disp.z);
          vWP = wp; vXZ = xz; vDist = dist;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        ${GLSL_CLOUDS}
        ${GLSL_LIGHTS}
        #include <logdepthbuf_pars_fragment>
        uniform vec4 uWaves[8]; uniform vec2 uWaves2[8]; uniform float uSea;
        uniform vec4 uShipA[${MAX_SHIPS}]; uniform vec4 uShipB[${MAX_SHIPS}]; uniform int uShipCount;
        uniform vec4 uSplash[${MAX_SPLASH}];
        uniform sampler2D uShoreTex; uniform float uTerrHalf; uniform float uTerrSize; uniform sampler2D uNoiseTex;
        uniform sampler2D uRipTex; uniform float uRipOn; uniform vec2 uRipL; uniform vec2 uRipMss; uniform float uRough;
        uniform sampler2D uReflTex; uniform mat4 uReflMat; uniform float uReflOn;
        varying vec3 vWP; varying vec2 vXZ; varying float vDist;

        // returns foam amount; perturbs normal xz; calm: how much the wake has smoothed the water
        float wakeFoam(vec2 p, inout vec2 nrm, out float calm) {
          float foam = 0.0; calm = 0.0;
          for (int i = 0; i < ${MAX_SHIPS}; i++) {
            if (i >= uShipCount) break;
            vec4 A = uShipA[i]; vec4 B = uShipB[i];
            // A: pos.xz, dir.xz (unit, bow direction); B: speed, length, beam, turnRate (rad/s)
            vec2 rel = p - A.xy;
            float along = dot(rel, A.zw);            // + toward bow
            vec2 side = vec2(-A.w, A.z);
            float lat = dot(rel, side);
            float L = B.y; float beam = B.z; float V = B.x;
            float s = -along - L * 0.5;               // distance behind stern
            if (s < -L * 1.2 || s > 3200.0 || abs(lat) > 0.36 * max(s, 0.0) + beam * 3.0 + 60.0) continue;
            // curvature correction for turning ships
            float curv = B.w / max(V, 1.0);
            lat += 0.5 * curv * max(s, 0.0) * max(s, 0.0);
            float spd = clamp(V / 15.0, 0.0, 1.5);
            float sp = max(s, 0.0);
            vec2 nuv = vec2(lat, s) / 9.0 + vec2(0.0, uTime * 0.25);
            float n1 = texture(uNoiseTex, nuv / 24.0).g, n2 = texture(uNoiseTex, nuv / 5.0 + 0.3).a;
            float n3 = texture(uNoiseTex, vec2(lat / 40.0, s / 160.0)).b;
            // turbulent centreline wake (prop wash): white for a few hundred metres, widening and breaking up
            float w = beam * 0.45 + sp * 0.05;
            float center = exp(-pow(lat / w, 2.0)) * step(-2.0, s);
            float wash = center * exp(-sp / (260.0 * spd + 60.0));
            float turb = wash * smoothstep(0.3, 0.8, n1 * 0.6 + n2 * 0.55 + wash * 0.3 - (1.0 - exp(-sp / 400.0)) * 0.25);
            foam += turb * spd * 1.1;
            // behind it a long smooth slick, a little wider, that outlasts the foam by far
            float sw = w * 1.5 + 6.0;
            calm += exp(-pow(lat / sw, 2.0)) * exp(-sp / (1700.0 * spd + 200.0)) * step(-2.0, s) * (0.75 + 0.5 * n3);
            // Kelvin divergent arms at 19.47 deg
            float armD = abs(abs(lat) - 0.354 * sp - beam * 0.35);
            float armW = 2.5 + sp * 0.02;
            float arm = exp(-pow(armD / armW, 2.0)) * exp(-sp / (240.0 * spd + 60.0)) * step(0.0, s);
            float lam = 6.2831 * V * V / 9.81 + 4.0;  // transverse wavelength
            float feather = 0.5 + 0.5 * sin(6.2831 * (sp + abs(lat) * 1.7) / (lam * 0.45));
            foam += arm * feather * smoothstep(0.3, 0.7, n2 + 0.25) * spd * 0.5;
            // transverse waves inside the wedge: normal ripple
            float inW = smoothstep(0.354 * sp + beam, 0.25 * sp, abs(lat)) * exp(-sp / 700.0) * step(0.0, s);
            float tw = cos(6.2831 * sp / lam);
            nrm += A.zw * tw * inW * 0.1 * spd;
            // the arms themselves are a ridge of steeper water
            nrm += side * sign(lat) * exp(-pow(armD / (armW * 2.0), 2.0)) * exp(-sp / 900.0) * 0.06 * spd * step(0.0, s);
            // bow wave
            float bowS = along - L * 0.5;
            float bow = exp(-pow(bowS / 6.0, 2.0)) * exp(-pow((abs(lat) - beam * 0.55) / 4.0, 2.0));
            float hullSide = step(abs(along), L * 0.5) * exp(-pow((abs(lat) - beam * 0.5) / (2.5 + spd * 2.0), 2.0)) * smoothstep(-L * 0.5, L * 0.3, along);
            foam += (bow * 1.5 + hullSide * 0.8 * smoothstep(0.4, 0.7, n2)) * spd;
          }
          return foam;
        }

        vec2 projRefl(vec3 d) { vec4 c = uReflMat * vec4(d, 0.0); return c.xy / max(c.w, 1e-5); }

        // light reflected along R. sh/sv: angular blur across and along the vertical (ripples too small to draw
        // smear reflections upward and downward, more than sideways)
        vec3 reflected(vec3 P, vec3 R, float sh, float sv) {
          vec3 sky = sampleSky(R);
          if (uReflOn < 0.5) {
            // no reflection picture (low quality): the sky, darkened and lit where the cloud layer covers it
            if (uCloudCover > 0.005 && R.y > 0.01) {
              float h = mix(uCloudBase, uCloudTop, 0.15);
              vec2 q = P.xz + R.xz * ((h - P.y) / R.y) + uWind;
              float a = cloudCoverage(textureLod(uWeatherTex, q / uWeatherScale, 1.5).r) * smoothstep(0.01, 0.1, R.y);
              vec3 cc = uSkyAmb * 0.8 + uSunColor * max(uSunDir.y, 0.0) * 0.035;
              sky = mix(sky, cc, a * 0.85);
            }
            return sky;
          }
          vec2 uv = projRefl(R);
          // the image directions of up and of sideways at this point give the blur footprint
          vec3 side = normalize(cross(R, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
          vec2 dv = (projRefl(normalize(R + vec3(0.0, 0.01, 0.0))) - uv) * (sv / 0.01);
          vec2 dh = (projRefl(normalize(R + side * 0.01)) - uv) * (sh / 0.01);
          vec3 c = textureGrad(uReflTex, uv, dh, dv).rgb;
          vec2 e = min(uv, 1.0 - uv);
          return mix(sky, c, smoothstep(0.0, 0.025, min(e.x, e.y)));
        }

        void main() {
          #include <logdepthbuf_fragment>
          vec2 xz = vXZ;
          float dist = length(vWP - cameraPosition);
          vec3 V = normalize(cameraPosition - vWP);
          float calm;
          vec2 wn = vec2(0.0);
          float foam = wakeFoam(vWP.xz, wn, calm);
          calm = clamp(calm, 0.0, 0.85);
          // gusts ruffle the sea in patches a few hundred metres across (cat's paws); between them it lies glassy
          float gust = texture(uNoiseTex, xz / 2900.0 + vec2(uTime * 0.0011, uTime * 0.0006)).g * 0.65
                     + texture(uNoiseTex, xz / 610.0 + vec2(-uTime * 0.0023, uTime * 0.0017)).b * 0.35;
          float rough = mix(0.12, 1.4, smoothstep(0.42, 0.78, gust)) * uRough * (1.0 - calm) * uSea;
          // short Gerstner waves are wind chop: they calm down with the ripples (their few cm of height don't matter).
          // On calm days the swell's slopes are drawn gentler too, so the sea holds a mirror picture of the sky.
          float chop = clamp(0.25 + 0.75 * rough, 0.25, 1.0);
          float swell = clamp(0.3 + 0.7 * uRough, 0.3, 1.0);
          // waves travel in groups: each wave's height swells and fades over patches several wavelengths across,
          // which breaks the corduroy of eight perfect sines seen from the air
          vec4 g1 = texture(uNoiseTex, xz / 4000.0 + vec2(0.13, 0.71)), g2 = texture(uNoiseTex, xz / 1000.0 + vec2(0.37, 0.29));
          vec4 grpA = clamp(1.0 + (g1 - 0.5) * 3.0, 0.15, 1.85), grpB = clamp(1.0 + (g2 - 0.5) * 3.0, 0.15, 1.85);
          // and their crests bend and bunch: a slowly wandering phase. Shading only: the mesh and the ships keep the
          // plain waves, a mismatch of under a metre of height that no view resolves
          vec4 phA = (g1.yzwx - 0.5) * 24.0, phB = (g2.yzwx - 0.5) * 24.0;
          // the pixel's footprint on the water: waves shorter than a few footprints can't be drawn (they alias into
          // moire rings round the camera) and turn into roughness instead
          float fp = max(length(dFdx(vWP.xz)), length(dFdy(vWP.xz))) + 1e-3;
          // analytic Gerstner normal
          vec3 N = vec3(0.0, 1.0, 0.0); float jac = 1.0; float crest = 0.0; float gFade = 0.0;
          for (int i = 0; i < 8; i++) {
            vec4 w = uWaves[i]; vec2 w2 = uWaves2[i];
            float lw = 6.2831 / w.z;
            float fade = (1.0 - smoothstep(0.1 * lw, 0.4 * lw, fp)) * (1.0 - smoothstep(lw * 35.0, lw * 260.0, dist));
            float th = w.z * dot(w.xy, xz) - w2.x * uTime + (i == 0 ? 0.0 : i < 4 ? phA[i] : phB[i - 4]);
            float grp = i < 4 ? grpA[i] : grpB[i - 4];
            float A = w.w * uSea * fade * grp * (i >= 4 ? chop : swell);
            float WA = w.z * A;
            N.x -= w.x * WA * cos(th);
            N.z -= w.y * WA * cos(th);
            N.y -= w2.y * WA * sin(th);
            jac -= w2.y * WA * sin(th) * 1.0;
            crest += A * sin(th);
            gFade += (1.0 - fade) * 0.125 * (i >= 4 ? chop * chop : swell * swell);
          }
          // ripples: how much of each tile's slope this pixel still resolves; the rest becomes roughness
          float kA = clamp(log2(uRipL.x / 3.0 / (2.0 * fp)) / log2(13.3), 0.0, 1.0);
          float kB = clamp(log2(uRipL.y / 2.0 / (2.0 * fp)) / log2(18.0), 0.0, 1.0);
          vec2 slope = vec2(0.0);
          if (uRipOn > 0.5) {
            vec4 ra = texture(uRipTex, xz / uRipL.x);
            vec2 xr = mat2(0.8, -0.6, 0.6, 0.8) * xz;
            vec4 rb = texture(uRipTex, xr / uRipL.y);
            slope = ra.rg * sqrt(rough) + mat2(0.8, 0.6, -0.6, 0.8) * rb.ba * sqrt(rough);
          } else {
            vec2 d1 = texture(uNoiseTex, xz / 37.0 + vec2(uTime * 0.012, uTime * 0.007)).rg - 0.5;
            vec2 d2 = texture(uNoiseTex, xz / 9.0 + vec2(-uTime * 0.021, uTime * 0.017)).ba - 0.5;
            slope = (d1 * 0.22 * kA + d2 * 0.2 * kB) * sqrt(rough);
          }
          N.xz -= slope;
          N.xz += wn;
          N = normalize(N);
          if (dot(N, V) < 0.02) N = normalize(N + V * (0.02 - dot(N, V)));
          // mean square slope left unresolved: faded swell, faded ripples, capillaries
          float mss = 0.0048 * gFade * uSea + (uRipMss.x * (1.0 - kA) + uRipMss.y * (1.0 - kB)) * rough + 0.0012 * rough + 0.0003;

          // shoreline depth from terrain
          vec2 tuv = (vWP.xz + uTerrHalf) / uTerrSize;
          float depth = 200.0;
          if (tuv.x > 0.0 && tuv.y > 0.0 && tuv.x < 1.0 && tuv.y < 1.0) depth = (texture(uShoreTex, tuv).a - 0.5) * 60.0;
          if (depth >= 29.0) depth = 200.0;

          float csh = cloudShadowAt(vWP);
          float NdotV = max(dot(N, V), 1e-3);
          float F = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
          vec3 R = reflect(-V, N); R.y = max(R.y, 0.004); R = normalize(R);
          // a tilt s of the water turns the reflected ray by 2s up or down, but sideways only by 2s times the
          // sine of the view's angle to the sea: far reflections smear into vertical streaks
          float sig = sqrt(mss * 2.0);
          vec3 refl = reflected(vWP, R, sig * max(V.y, 0.25), sig);
          // water body: what the light scattered up out of the depths looks like (deep blue-black, greener over sand)
          float sunUp = max(uSunDir.y, 0.0);
          vec3 deep = vec3(0.0028, 0.0095, 0.0155);
          vec3 shallow = vec3(0.018, 0.1, 0.09);
          float shal = smoothstep(26.0, 2.0, depth);
          vec3 waterCol = mix(deep, shallow, shal);
          vec3 Ld = (uSunColor * sunUp * csh / PI + uSkyAmb * 0.6);
          vec3 body = waterCol * Ld;
          // subsurface light through the crests when looking toward the sun
          float sss = pow(max(dot(V, -uSunDir) * 0.5 + 0.5, 0.0), 4.0) * max(crest + 0.35, 0.0) * 0.45;
          body += vec3(0.015, 0.09, 0.08) * sss * (uSunColor / PI) * csh * (1.0 - smoothstep(600.0, 3000.0, dist));
          vec3 col = mix(body, refl, F);
          // sun glitter: Beckmann microfacets with the unresolved slope variance, on the resolved normal
          vec3 H = normalize(V + uSunDir);
          float NdotH = max(dot(N, H), 1e-3), NdotL = dot(N, uSunDir);
          float m2 = max(mss, 0.0005);
          float t2 = (1.0 - NdotH * NdotH) / (NdotH * NdotH);
          float D = exp(-t2 / m2) / (PI * m2 * NdotH * NdotH * NdotH * NdotH);
          float FH = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
          float spec = D * FH / (4.0 * NdotV) * step(0.0, NdotL);
          col += uSunColor * min(spec, 2000.0) * csh * smoothstep(-0.02, 0.06, uSunDir.y);
          col += flashLights(vWP, N, vec3(0.05)) + flashLights(vWP, reflect(-V, N), vec3(0.0));
          // crest foam (Jacobian), shore break, wakes, splash rings
          float fnz = texture(uNoiseTex, xz / 13.0 + vec2(uTime * 0.01)).r;
          float crestFoam = smoothstep(0.62, 0.25, jac) * smoothstep(0.35, 0.65, fnz) * uSea;
          float shore = 0.0;
          if (depth < 6.0) {
            float band = sin(depth * 2.2 - uTime * 1.6 + fnz * 4.0) * 0.5 + 0.5;
            shore = smoothstep(6.0, 0.2, depth) * smoothstep(0.35, 0.8, band + fnz * 0.4) + smoothstep(0.8, 0.0, depth);
          }
          for (int i = 0; i < ${MAX_SPLASH}; i++) {
            vec4 s = uSplash[i];
            float age = uTime - s.z; if (age < 0.0 || age > 30.0) continue;
            float rr = s.w * (1.0 + age * 0.35) + age * 2.5;
            // ragged churned patch, not a flat white plate: noise eats into the edge and the inside
            float fs = texture(uNoiseTex, (vWP.xz - s.xy) / (6.0 + s.w * 0.4) + s.xy * 0.013).g;
            float d = length(vWP.xz - s.xy) + (fnz - 0.5) * rr * 0.35 + (fs - 0.5) * rr * 0.3;
            float ring = exp(-pow((d - rr) / (2.0 + rr * 0.15), 2.0)) * exp(-age * 0.15);
            float disk = smoothstep(rr, rr * 0.45, d) * exp(-age * 0.12) * 0.45 * smoothstep(0.2, 0.6, fs + 0.15);
            foam += (ring * 0.6 + disk) * smoothstep(0.2, 0.6, fnz + 0.3);
          }
          float foamAmt = clamp(crestFoam * 0.6 + foam + shore, 0.0, 1.0) * (1.0 - smoothstep(4000.0, 15000.0, dist));
          vec3 foamCol = vec3(0.85) * (uSunColor * max(dot(N, uSunDir), 0.2) * csh / PI + uSkyAmb);
          col = mix(col, foamCol, foamAmt);
          if (uThermal > 0.5) {
            float t = 0.12 + 0.05 * F + foamAmt * 0.03;
            gl_FragColor = vec4(vec3(t), 1.0); return;
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(this.buildGrid(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.ships = [];
    this.splashes = [];
    this.splashIdx = 0;
  }

  buildGrid() {
    // polar grid: dense near the camera, exponential out to 160 km
    const segs = 192, rings = 150; const r0 = 1.5, r1 = 160000;
    const pos = [0, 0, 0]; const idx = [];
    const k = Math.pow(r1 / r0, 1 / (rings - 1));
    for (let r = 0; r < rings; r++) {
      const rad = r0 * Math.pow(k, r);
      for (let s = 0; s < segs; s++) { const a = s / segs * Math.PI * 2; pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad); }
    }
    for (let s = 0; s < segs; s++) idx.push(0, 1 + (s + 1) % segs, 1 + s);
    for (let r = 0; r < rings - 1; r++) for (let s = 0; s < segs; s++) {
      const a = 1 + r * segs + s, b = 1 + r * segs + (s + 1) % segs, c = 1 + (r + 1) * segs + s, d = 1 + (r + 1) * segs + (s + 1) % segs;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    return g;
  }

  setShoreTexture(tex) { this.uniforms.uShoreTex.value = tex; }

  // CPU wave evaluation: displacement at undisplaced xz (matches the shader minus distance fade)
  displacement(x, z, t, out) {
    let dx = 0, dy = 0, dz = 0; const s = this.seaState;
    for (const w of this.waves) {
      const th = w.k * (w.dx * x + w.dz * z) - w.w * t; const A = w.A * s;
      const c = Math.cos(th);
      dx += w.Q * A * w.dx * c; dz += w.Q * A * w.dz * c; dy += A * Math.sin(th);
    }
    out.x = dx; out.y = dy; out.z = dz; return out;
  }
  // surface height at world xz (inverts the horizontal Gerstner displacement iteratively)
  heightAt(x, z, t) {
    const d = this._d || (this._d = { x: 0, y: 0, z: 0 });
    let px = x, pz = z;
    for (let i = 0; i < 3; i++) { this.displacement(px, pz, t, d); px = x - d.x; pz = z - d.z; }
    this.displacement(px, pz, t, d);
    return d.y;
  }
  // surface normal approx by finite differences
  normalAt(x, z, t, out = new THREE.Vector3()) {
    const e = 1.5; const h0 = this.heightAt(x, z, t);
    const hx = this.heightAt(x + e, z, t), hz = this.heightAt(x, z + e, t);
    return out.set(-(hx - h0) / e, 1, -(hz - h0) / e).normalize();
  }

  addSplash(x, z, size) {
    const u = this.uniforms.uSplash.value[this.splashIdx];
    u.set(x, z, GU.uTime.value, size);
    this.splashIdx = (this.splashIdx + 1) % MAX_SPLASH;
  }

  update(camPos, shipsList) {
    this.uniforms.uCamXZ.value.set(Math.round(camPos.x / 4) * 4, Math.round(camPos.z / 4) * 4);
    this.uniforms.uSea.value = this.seaState;
    if (this.ripples) this.ripples.update(GU.uTime.value);
    const A = this.uniforms.uShipA.value, B = this.uniforms.uShipB.value;
    let n = 0;
    for (const s of shipsList) {
      if (n >= MAX_SHIPS) break;
      if (!s.alive && s.sinkT > 25) continue;
      A[n].set(s.pos.x, s.pos.z, s.fwd.x, s.fwd.z);
      B[n].set(s.alive ? s.speed : s.speed * 0.3, s.length, s.beam, s.turnRate || 0);
      n++;
    }
    this.uniforms.uShipCount.value = n;
  }
}
