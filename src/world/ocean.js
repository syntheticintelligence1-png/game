// Gerstner-wave ocean: camera-following polar LOD grid, multi-octave Gerstner displacement in the vertex
// shader, per-pixel analytic normals + scrolling detail normals, Fresnel sky reflection, sun glints,
// subsurface scattering on crests, crest/shore foam, analytic Kelvin wakes (turbulent centerline,
// 19.47-degree divergent arms, bow waves) per ship, explosion splash rings, cloud shadows.
// The same wave set is evaluated on the CPU for ship motion, splashes and sea-skimming missiles.
import * as THREE from 'three';
import { GU, GLSL_COMMON, GLSL_CLOUDS, GLSL_LIGHTS } from '../render/glsl.js';

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

export class Ocean {
  constructor(terrain) {
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
    const u = {};
    for (const n of ['uTime', 'uSunDir', 'uSunColor', 'uSkyAmb', 'uGroundAmb', 'uSkyTex', 'uFogDensity', 'uFogHeight', 'uThermal', 'uNight',
      'uNoiseTex', 'uWeatherTex', 'uNoise3D', 'uCloudBase', 'uCloudTop', 'uCloudCover', 'uWeatherScale', 'uWind', 'uLightPos', 'uLightCol']) u[n] = GU[n];
    Object.assign(u, {
      uWaves: { value: waveU }, uWaves2: { value: waveU2 }, uSea: { value: 1.0 },
      uShipA: { value: ships }, uShipB: { value: ships2 }, uShipCount: { value: 0 },
      uSplash: { value: spl },
      uShoreTex: { value: null }, uTerrHalf: { value: 20480 }, uTerrSize: { value: 40960 },
      uCamXZ: { value: new THREE.Vector2() }, uNormalTex: { value: null },
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
            float fade = 1.0 - smoothstep(30.0 / w.z, 110.0 / w.z, dist * 0.02 + 0.0) * 0.0;
            // fade short waves with distance (they alias)
            fade = 1.0 - smoothstep(2.0 * 6.2831 / w.z * 25.0, 6.2831 / w.z * 160.0, dist);
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
        varying vec3 vWP; varying vec2 vXZ; varying float vDist;

        // returns foam amount; perturbs normal xz
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
            if (s < -L * 1.2 || s > 2600.0 || abs(lat) > 0.36 * max(s, 0.0) + beam * 3.0 + 60.0) continue;
            // curvature correction for turning ships
            float curv = B.w / max(V, 1.0);
            lat += 0.5 * curv * max(s, 0.0) * max(s, 0.0);
            float spd = clamp(V / 15.0, 0.0, 1.5);
            float sp = max(s, 0.0);
            vec2 nuv = vec2(lat, s) / 9.0 + vec2(0.0, uTime * 0.25);
            float n1 = texture(uNoiseTex, nuv / 24.0).g, n2 = texture(uNoiseTex, nuv / 5.0 + 0.3).a;
            // turbulent centreline wake (prop wash), widening and decaying with distance
            float w = beam * 0.45 + sp * 0.055;
            float center = exp(-pow(lat / w, 2.0)) * exp(-sp / (900.0 * spd + 120.0)) * step(-2.0, s);
            float turb = center * smoothstep(0.25, 0.75, n1 * 0.6 + n2 * 0.55 + center * 0.35);
            foam += turb * spd * 1.1;
            calm += center;
            // Kelvin divergent arms at 19.47 deg
            float armD = abs(abs(lat) - 0.354 * sp - beam * 0.35);
            float armW = 2.5 + sp * 0.02;
            float arm = exp(-pow(armD / armW, 2.0)) * exp(-sp / (650.0 * spd + 80.0)) * step(0.0, s);
            float lam = 6.2831 * V * V / 9.81 + 4.0;  // transverse wavelength
            float feather = 0.5 + 0.5 * sin(6.2831 * (sp + abs(lat) * 1.7) / (lam * 0.45));
            foam += arm * feather * smoothstep(0.3, 0.7, n2 + 0.25) * spd * 0.9;
            // transverse waves inside the wedge: normal ripple
            float inW = smoothstep(0.354 * sp + beam, 0.25 * sp, abs(lat)) * exp(-sp / 700.0) * step(0.0, s);
            float tw = cos(6.2831 * sp / lam);
            nrm += A.zw * tw * inW * 0.12 * spd;
            // bow wave
            float bowS = along - L * 0.5;
            float bow = exp(-pow(bowS / 6.0, 2.0)) * exp(-pow((abs(lat) - beam * 0.55) / 4.0, 2.0));
            float hullSide = step(abs(along), L * 0.5) * exp(-pow((abs(lat) - beam * 0.5) / (2.5 + spd * 2.0), 2.0)) * smoothstep(-L * 0.5, L * 0.3, along);
            foam += (bow * 1.5 + hullSide * 0.8 * smoothstep(0.4, 0.7, n2)) * spd;
          }
          return foam;
        }

        void main() {
          #include <logdepthbuf_fragment>
          vec2 xz = vXZ;
          float dist = length(vWP - cameraPosition);
          // analytic Gerstner normal
          vec3 N = vec3(0.0, 1.0, 0.0); float jac = 1.0; float crest = 0.0;
          for (int i = 0; i < 8; i++) {
            vec4 w = uWaves[i]; vec2 w2 = uWaves2[i];
            float fade = 1.0 - smoothstep(6.2831 / w.z * 35.0, 6.2831 / w.z * 260.0, dist);
            float th = w.z * dot(w.xy, xz) - w2.x * uTime;
            float A = w.w * uSea * fade;
            float WA = w.z * A;
            N.x -= w.x * WA * cos(th);
            N.z -= w.y * WA * cos(th);
            N.y -= w2.y * WA * sin(th);
            jac -= w2.y * WA * sin(th) * 1.0;
            crest += A * sin(th);
          }
          // detail normals
          float df = 1.0 - smoothstep(150.0, 2500.0, dist);
          vec2 d1 = (texture(uNoiseTex, xz / 37.0 + vec2(uTime * 0.012, uTime * 0.007)).rg - 0.5);
          vec2 d2 = (texture(uNoiseTex, xz / 9.0 + vec2(-uTime * 0.021, uTime * 0.017)).ba - 0.5);
          vec2 d3 = (texture(uNoiseTex, xz / 2.3 + vec2(uTime * 0.05, -uTime * 0.03)).rg - 0.5);
          vec2 detail = d1 * 0.32 + d2 * 0.28 * df + d3 * 0.18 * (1.0 - smoothstep(20.0, 260.0, dist));
          float calm;
          vec2 wn = vec2(0.0);
          float foam = wakeFoam(vWP.xz, wn, calm);
          detail *= 1.0 - clamp(calm, 0.0, 0.7);
          N.xz += detail * uSea + wn;
          N = normalize(N);
          vec3 V = normalize(cameraPosition - vWP);
          if (dot(N, V) < 0.02) N = normalize(N + V * (0.02 - dot(N, V)));

          // shoreline depth from terrain
          vec2 tuv = (vWP.xz + uTerrHalf) / uTerrSize;
          float depth = 200.0;
          if (tuv.x > 0.0 && tuv.y > 0.0 && tuv.x < 1.0 && tuv.y < 1.0) depth = (texture(uShoreTex, tuv).a - 0.5) * 60.0;
          if (depth < 29.0) {
            // fill out deep side smoothly
          } else depth = 200.0;

          float csh = cloudShadowAt(vWP);
          float NdotV = max(dot(N, V), 0.0);
          float F = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
          vec3 R = reflect(-V, N); R.y = abs(R.y) + 0.01;
          vec3 refl = sampleSky(normalize(R));
          // water body: absorption-tinted upwelling
          float sunUp = max(uSunDir.y, 0.0);
          vec3 deep = vec3(0.004, 0.017, 0.032);
          vec3 shallow = vec3(0.02, 0.11, 0.1);
          float shal = smoothstep(26.0, 2.0, depth);
          vec3 waterCol = mix(deep, shallow, shal);
          vec3 Ld = (uSunColor * sunUp * csh / PI + uSkyAmb * 0.6);
          vec3 body = waterCol * Ld;
          // subsurface scattering through crests when looking toward the sun
          float sss = pow(max(dot(V, -uSunDir) * 0.5 + 0.5, 0.0), 4.0) * max(crest + 0.35, 0.0) * 0.7;
          body += vec3(0.02, 0.12, 0.1) * sss * (uSunColor / PI) * csh * (1.0 - smoothstep(800.0, 4000.0, dist));
          vec3 col = mix(body, refl, F);
          // sun glints (Blinn-Phong, roughness grows with distance to make a glitter path)
          vec3 H = normalize(V + uSunDir);
          float rough = mix(0.035, 0.18, smoothstep(30.0, 12000.0, dist));
          float shin = 2.0 / (rough * rough) - 2.0;
          float spec = pow(max(dot(N, H), 0.0), shin) * (shin + 8.0) / (8.0 * PI);
          col += uSunColor * spec * F * 1.6 * csh * smoothstep(-0.02, 0.06, uSunDir.y);
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
            float t = 0.12 + 0.05 * F + foamAmt * 0.03 + spec * 0.0;
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
