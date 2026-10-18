// Multi-pass HDR pipeline:
//  0. reflection: the world above the sea seen by a camera mirrored in the surface (scene + clouds + haze, low
//     res, mipmapped) -> reflRT; the ocean shader samples it
//  1. scene  -> sceneRT (RGBA16F + float log-depth texture)
//  2. clouds -> CloudRenderer (reduced res raymarch + temporal reprojection)
//  3. composite: aerial perspective + depth-aware upsampled clouds -> hdrRT
//  4. particles / trails / flames -> hdrRT (soft depth test against scene depth)
//  5. distortion (shockwaves) -> distRT
//  6. bloom (Karis-filtered down chain + tent up chain)
//  6b. sun shafts: quarter-res mask of the sun glow the clouds and terrain leave visible, blurred radially (2 passes)
//  7. final: exposure, ACES, colour grade, lens flare, G-LOC grey/black/red-out, vignette, sensor modes, grain
import * as THREE from 'three';
import { GU, GLSL_COMMON, GLSL_ACES, FULLSCREEN_VS, fullscreenTriangle } from './glsl.js';
import { CloudRenderer } from './clouds.js';

const HALF = THREE.HalfFloatType;

export const SENSOR = { NORMAL: 0, TV: 1, WHOT: 2, BHOT: 3, NVG: 4 };

// per quality: cloud raymarch resolution divisor, steps, sun-light steps; reflection resolution divisor (0 = none)
const QUALITY = {
  low: { cloudDiv: 2.5, steps: 32, light: 4, refl: 0 },
  medium: { cloudDiv: 2, steps: 44, light: 5, refl: 3 },
  high: { cloudDiv: 2, steps: 64, light: 6, refl: 2 },
};

function makeCompositeMaterial(mirror) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...pick(['uTime', 'uSunDir', 'uSunColor', 'uSkyAmb', 'uGroundAmb', 'uSkyTex', 'uFogDensity', 'uFogHeight', 'uThermal', 'uNight', 'uLogFar']),
      uScene: { value: null }, uDepth: { value: null }, uClouds: { value: null }, uCloudRes: { value: new THREE.Vector2(1, 1) },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPosC: { value: new THREE.Vector3() },
      uUnderwater: { value: 0 }, uCloudOn: { value: 1 }, uMirror: { value: mirror ? 1 : 0 },
    },
    vertexShader: FULLSCREEN_VS,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      uniform sampler2D uScene; uniform sampler2D uDepth; uniform sampler2D uClouds; uniform vec2 uCloudRes;
      uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform vec3 uCamPosC; uniform float uLogFar;
      uniform float uUnderwater; uniform float uCloudOn; uniform float uMirror;
      varying vec2 vUv;
      // the clouds were marched at low resolution: weigh the four nearest texels by how well the depth their rays
      // stopped at matches this pixel's, so a jet in front of a cloud keeps a clean outline
      vec4 cloudsAt(vec2 uv, float d) {
        vec2 p = uv * uCloudRes - 0.5; vec2 i = floor(p); vec2 f = p - i;
        vec4 acc = vec4(0.0); float ws = 0.0;
        for (int k = 0; k < 4; k++) {
          vec2 o = vec2(float(k & 1), float(k >> 1));
          vec2 cuv = (i + o + 0.5) / uCloudRes;
          float bw = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y);
          float w = bw * (exp(-abs(texture(uDepth, cuv).r - d) * 400.0) + 1e-4);
          acc += texture(uClouds, cuv) * w; ws += w;
        }
        return acc / max(ws, 1e-6);
      }
      void main() {
        vec3 col = texture(uScene, vUv).rgb;
        float d = texture(uDepth, vUv).r;
        vec4 vr = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 vdir = normalize(vr.xyz / vr.w);
        vec3 rd = normalize(mat3(uCamWorld) * vdir);
        if (d < 0.999999) {
          float w = exp2(d * uLogFar) - 1.0;
          float dist = w / max(-vdir.z, 1e-4);
          vec3 ro = uCamPosC;
          // mirror view: the haze only counts from the sea surface up
          if (uMirror > 0.5) { float tw = rd.y > 1e-4 ? max(-ro.y / rd.y, 0.0) : 0.0; ro += rd * tw; dist = max(dist - tw, 0.0); }
          if (uThermal > 0.5) {
            float T = fogTransmittance(ro, rd, dist * 0.6);
            col = col * T + vec3(0.1) * (1.0 - T);
          } else {
            col = aerialPerspective(col, ro, rd, dist);
          }
        }
        if (uCloudOn > 0.5) {
          vec4 cl = cloudsAt(vUv, d);
          col = col * cl.a + cl.rgb;
        }
        if (uUnderwater > 0.5) col = col * vec3(0.05, 0.25, 0.3) + vec3(0.0, 0.03, 0.05);
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
}

export class Pipeline {
  constructor(renderer, w, h, opts = {}) {
    this.r = renderer;
    this.quality = opts.quality || 'medium';
    this.scale = opts.scale || 1;
    this.flare = opts.flare !== false;
    this.allowRefl = opts.reflect !== false;
    this.frame = 0;
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(fullscreenTriangle(), null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this._pass = (m, t) => this.pass(m, t);

    this.clouds = new CloudRenderer(renderer, { temporal: opts.temporal !== false });
    this.cloudMat = this.clouds.march; // game.js lights the clouds with a tracked missile's plume through this
    this.compositeMat = makeCompositeMaterial(false);
    // what the reflection pass leaves out (the sea itself, the cockpit...), set by the game
    this.refl = { hide: [], dome: null, terrain: null };
    this.reflCam = new THREE.PerspectiveCamera();
    this._hid = [];
    this.applyQuality();

    this.bloomDownMat = new THREE.ShaderMaterial({
      uniforms: { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThreshold: { value: 1.0 } },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: /* glsl */`
        uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uFirst; uniform float uThreshold;
        varying vec2 vUv;
        vec3 s(vec2 o) { return texture(uSrc, vUv + o * uTexel).rgb; }
        float karis(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)) * 0.25); }
        void main() {
          vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
          vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
          vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
          vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
          vec3 col;
          if (uFirst > 0.5) {
            vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
            float w0 = karis(g0) * 0.125, w1 = karis(g1) * 0.125, w2 = karis(g2) * 0.125, w3 = karis(g3) * 0.125, w4 = karis(g4) * 0.5;
            col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
            float br = max(col.r, max(col.g, col.b));
            float soft = clamp(br - uThreshold * 0.5, 0.0, uThreshold);
            soft = soft * soft / (4.0 * uThreshold + 1e-4);
            col *= max(soft, br - uThreshold) / max(br, 1e-4);
          } else {
            col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
          }
          gl_FragColor = vec4(min(col, vec3(4000.0)), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.bloomUpMat = new THREE.ShaderMaterial({
      uniforms: { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 } },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: /* glsl */`
        uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
        void main() {
          vec2 o = uTexel * uRadius;
          vec3 c = texture(uSrc, vUv + vec2(-o.x, o.y)).rgb + texture(uSrc, vUv + vec2(0.0, o.y)).rgb * 2.0 + texture(uSrc, vUv + o).rgb
                 + texture(uSrc, vUv + vec2(-o.x, 0.0)).rgb * 2.0 + texture(uSrc, vUv).rgb * 4.0 + texture(uSrc, vUv + vec2(o.x, 0.0)).rgb * 2.0
                 + texture(uSrc, vUv - o).rgb + texture(uSrc, vUv + vec2(0.0, -o.y)).rgb * 2.0 + texture(uSrc, vUv + vec2(o.x, -o.y)).rgb;
          gl_FragColor = vec4(c / 16.0, 1.0);
        }`,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    });

    // rgb: sun glow where open sky shows (through cloud transmittance); a: open sky, for the flare's sun visibility
    this.shaftMaskMat = new THREE.ShaderMaterial({
      uniforms: {
        ...pick(['uSunDir', 'uSunColor']),
        uDepth: { value: null }, uClouds: { value: null }, uCloudOn: { value: 1 },
        uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir; uniform vec3 uSunColor;
        uniform sampler2D uDepth; uniform sampler2D uClouds; uniform float uCloudOn;
        uniform mat4 uInvProj; uniform mat4 uCamWorld;
        varying vec2 vUv;
        void main() {
          float sky = texture(uDepth, vUv).r < 0.999999 ? 0.0 : 1.0;
          float T = uCloudOn > 0.5 ? texture(uClouds, vUv).a : 1.0;
          vec4 vr = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
          vec3 rd = normalize(mat3(uCamWorld) * normalize(vr.xyz / vr.w));
          float mu = max(dot(rd, uSunDir), 0.0);
          float glow = pow(mu, 900.0) * 4.0 + pow(mu, 60.0) * 0.4 + pow(mu, 8.0) * 0.05;
          float v = sky * T;
          gl_FragColor = vec4(uSunColor * v * glow * smoothstep(-0.02, 0.03, rd.y), v);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.shaftBlurMat = new THREE.ShaderMaterial({
      uniforms: { uSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uLen: { value: 1 }, uDecay: { value: 0.97 }, uTime: GU.uTime },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: /* glsl */`
        uniform sampler2D uSrc; uniform vec2 uSun; uniform float uLen; uniform float uDecay; uniform float uTime;
        varying vec2 vUv;
        float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        #define N 28
        void main() {
          vec2 st = (uSun - vUv) * uLen / float(N);
          vec2 p = vUv + st * h12(gl_FragCoord.xy + fract(uTime * 3.7) * 61.0);
          vec3 acc = vec3(0.0); float w = 1.0, ws = 0.0;
          for (int i = 0; i < N; i++) { acc += texture(uSrc, p).rgb * w; ws += w; w *= uDecay; p += st; }
          gl_FragColor = vec4(acc / ws, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        uHDR: { value: null }, uBloom: { value: null }, uDist: { value: null }, uExposure: { value: 0.35 }, uBloomStr: { value: 0.045 },
        uGrey: { value: 0 }, uRed: { value: 0 }, uMode: { value: 0 }, uTime: GU.uTime, uRes: { value: new THREE.Vector2(1, 1) },
        uFlash: { value: 0 }, uDamage: { value: 0 }, uNoise: { value: 0 }, uDegrade: { value: 0 }, uVignette: { value: 0.28 },
        uHurt: { value: 0 }, uFade: { value: 0 }, uInCloud: { value: 0 },
        uShafts: { value: null }, uShaftMask: { value: null }, uShaftStr: { value: 0 }, uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
        uSunK: { value: 0 }, uSunTint: { value: new THREE.Vector3(1, 1, 1) }, uFlareStr: { value: 1 }, uCA: { value: 0.0018 },
      },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: /* glsl */`
        #define PI 3.14159265359
        ${GLSL_ACES}
        uniform sampler2D uHDR; uniform sampler2D uBloom; uniform sampler2D uDist;
        uniform float uExposure; uniform float uBloomStr; uniform float uGrey; uniform float uRed; uniform float uMode;
        uniform float uTime; uniform vec2 uRes; uniform float uFlash; uniform float uDamage; uniform float uNoise; uniform float uDegrade;
        uniform float uVignette; uniform float uHurt; uniform float uFade; uniform float uInCloud;
        uniform sampler2D uShafts; uniform sampler2D uShaftMask; uniform float uShaftStr; uniform vec2 uSunUV; uniform float uSunK;
        uniform vec3 uSunTint; uniform float uFlareStr; uniform float uCA;
        varying vec2 vUv;
        float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float ghost(vec2 p, vec2 c, float r) { float d = length(p - c); return smoothstep(r, r * 0.7, d) * (0.55 + 0.45 * smoothstep(r * 0.2, r * 0.85, d)); }
        // camera-lens flare off the sun: ghosts mirrored through the middle of the screen, a halo, a streak and a starburst
        vec3 lensFlare(vec2 uv) {
          vec2 tx = vec2(0.008, 0.012);
          float vis = texture(uShaftMask, uSunUV).a * 0.36
            + (texture(uShaftMask, uSunUV + vec2(tx.x, 0.0)).a + texture(uShaftMask, uSunUV - vec2(tx.x, 0.0)).a
             + texture(uShaftMask, uSunUV + vec2(0.0, tx.y)).a + texture(uShaftMask, uSunUV - vec2(0.0, tx.y)).a) * 0.16;
          vis *= uSunK;
          if (vis < 0.002) return vec3(0.0);
          vec2 A = vec2(uRes.x / uRes.y, 1.0);
          vec2 p = (uv - 0.5) * A, s = (uSunUV - 0.5) * A;
          vec3 f = vec3(0.0);
          f += ghost(p, -s * 0.30, 0.025) * vec3(0.55, 0.65, 1.0) * 0.21;
          f += ghost(p, -s * 0.62, 0.065) * vec3(0.35, 0.9, 0.55) * 0.09;
          f += ghost(p, -s * 1.05, 0.11) * vec3(1.0, 0.55, 0.3) * 0.055;
          f += ghost(p, -s * 1.45, 0.045) * vec3(0.6, 0.5, 1.0) * 0.12;
          f += ghost(p, s * 0.42, 0.035) * vec3(1.0, 0.85, 0.55) * 0.09;
          vec2 q = p - s; float d = length(q);
          f += smoothstep(0.035, 0.0, abs(d - 0.32)) * vec3(0.9, 0.7, 1.0) * 0.025;
          f += exp(-abs(q.y) * 260.0) * exp(-abs(q.x) * 2.2) * vec3(0.55, 0.7, 1.0) * 0.14;
          f += pow(abs(cos(atan(q.y, q.x) * 3.0 + 0.3)), 60.0) * exp(-d * 9.0) * 0.11;
          f += exp(-d * 7.0) * 0.05 + exp(-d * 28.0) * 0.15;
          return f * uSunTint * vis * uFlareStr;
        }
        void main() {
          vec2 uv = vUv;
          vec2 dist = texture(uDist, uv).rg;
          uv += dist;
          float mode = uMode;
          if (mode > 0.5 && uDegrade > 0.0) {
            // sensor signal degradation: line tearing and jitter
            float line = floor(uv.y * uRes.y / 3.0);
            float tear = (h12(vec2(line, floor(uTime * 30.0))) - 0.5) * 0.02 * uDegrade * step(0.75, h12(vec2(line * 0.37, floor(uTime * 12.0))));
            uv.x += tear;
          }
          vec3 hdr = texture(uHDR, uv).rgb;
          vec3 bloom = texture(uBloom, uv).rgb;
          vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
          float r = length(p);
          vec3 col;
          float n = h12(gl_FragCoord.xy + fract(uTime * 7.31) * 513.0);
          if (mode < 0.5) {
            // a little lateral chromatic aberration toward the edges of the screen
            vec2 cav = (uv - 0.5) * uCA;
            hdr.r = texture(uHDR, uv + cav).r; hdr.b = texture(uHDR, uv - cav).b;
            vec3 c = mix(hdr, bloom, uBloomStr) + bloom * uBloomStr * 0.6;
            if (uShaftStr > 0.0) c += texture(uShafts, vUv).rgb * uShaftStr;
            c *= uExposure;
            c += uFlash * vec3(1.0, 0.95, 0.9);
            col = ACESFitted(c);
            // grade: a touch more saturation, cool shadows, warm highlights
            float gl = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col = max(mix(vec3(gl), col, 1.08), 0.0);
            col *= mix(vec3(0.96, 0.99, 1.06), vec3(1.035, 1.0, 0.955), smoothstep(0.0, 0.55, gl));
            if (uSunK > 0.0) col += lensFlare(vUv);
            // in-cloud whiteout / condensation on canopy
            col = mix(col, vec3(dot(col, vec3(0.33))) * 1.05, uInCloud * 0.35);
            // G-LOC: desaturate, tunnel vision, blackout
            float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col = mix(col, vec3(lum), smoothstep(0.05, 0.55, uGrey));
            float tunnel = 1.0 - smoothstep(mix(1.6, 0.06, uGrey), mix(2.2, 0.42, uGrey), r);
            col *= mix(1.0, tunnel, smoothstep(0.25, 0.7, uGrey));
            col *= 1.0 - smoothstep(0.82, 1.0, uGrey);
            // red-out
            col = mix(col, vec3(lum * 0.9 + 0.25, lum * 0.08, lum * 0.06), uRed * 0.85);
            // damage pulse
            col = mix(col, col * vec3(1.0, 0.35, 0.3) + vec3(0.18, 0.0, 0.0), uHurt * (0.6 + 0.4 * sin(uTime * 12.0)) * smoothstep(0.3, 1.2, r));
            col *= 1.0 - uVignette * smoothstep(0.45, 1.25, r);
            col = linearToSRGB(col);
            col += (n - 0.5) / 255.0;
          } else if (mode < 1.5) {
            // TV (CCD) seeker: high-contrast monochrome
            vec3 c = (hdr + bloom * 0.15) * uExposure;
            float l = dot(ACESFitted(c), vec3(0.3, 0.59, 0.11));
            l = pow(clamp(l, 0.0, 1.0), 0.85);
            l = smoothstep(0.02, 0.95, l);
            l += (n - 0.5) * (0.06 + uNoise * 0.5 + uDegrade * 0.4);
            l *= 0.88 + 0.12 * sin(gl_FragCoord.y * PI * 0.5);
            l *= 1.0 - 0.35 * smoothstep(0.55, 1.1, r);
            col = vec3(l);
          } else if (mode < 3.5) {
            // FLIR: scene is rendered in thermal mode; hdr.r holds apparent temperature
            float t = hdr.r + bloom.r * 0.35;
            float l = clamp((t - 0.05) / 1.1, 0.0, 1.0);
            l = pow(l, 0.75);
            if (mode > 2.5) l = 1.0 - l;
            l += (n - 0.5) * (0.07 + uNoise * 0.6 + uDegrade * 0.5);
            l *= 0.9 + 0.1 * sin(gl_FragCoord.y * PI * 0.5);
            l *= 1.0 - 0.3 * smoothstep(0.55, 1.1, r);
            col = vec3(l) * vec3(0.96, 1.0, 0.98);
          } else {
            // NVG: photon amplification, green phosphor, halos around point lights
            vec3 c = (hdr + bloom * 2.5) * uExposure * 6.0;
            float l = dot(c, vec3(0.3, 0.59, 0.11));
            l = 1.0 - exp(-l * 1.8);
            l += (n - 0.5) * 0.22;
            l *= 1.0 - 0.75 * smoothstep(0.42, 0.62, r);
            col = vec3(0.1, 1.0, 0.32) * l * 0.95 + vec3(0.0, 0.03, 0.01);
          }
          col = mix(col, vec3(0.0), uFade);
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.distScene = new THREE.Scene();
    this.setSize(w, h);
  }

  makeRT(w, h, opts = {}) {
    return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
      type: HALF, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false, ...opts,
    });
  }

  // quality: cloud steps and resolution, and whether the sea gets a real reflection
  applyQuality() {
    const Q = QUALITY[this.quality] || QUALITY.medium;
    this.cloudDiv = Q.cloudDiv; this.clouds.steps = Q.steps; this.clouds.lightSteps = Q.light;
    this.reflDiv = this.allowRefl ? Q.refl : 0;
    if (this.reflDiv && !this.reflClouds) {
      this.reflClouds = new CloudRenderer(this.r, { steps: 26, lightSteps: 4, mirror: true });
      this.reflCompMat = makeCompositeMaterial(true);
    }
    if (!this.reflDiv) GU.uReflOn.value = 0;
  }
  // the render targets depend on the quality: call setSize afterwards
  setQuality(q) { this.quality = q; this.applyQuality(); }

  setSize(w, h) {
    this.w = Math.max(2, Math.floor(w * this.scale)); this.h = Math.max(2, Math.floor(h * this.scale));
    const W = this.w, H = this.h;
    for (const rt of [this.sceneRT, this.hdrRT, this.distRT, this.reflSceneRT, this.reflRT, ...(this.bloomRTs || []), ...(this.shaftRTs || [])]) if (rt) rt.dispose();
    const depthTex = new THREE.DepthTexture(W, H, THREE.FloatType);
    depthTex.minFilter = THREE.NearestFilter; depthTex.magFilter = THREE.NearestFilter;
    this.sceneRT = this.makeRT(W, H, { depthBuffer: true, depthTexture: depthTex });
    this.clouds.setSize(W / this.cloudDiv, H / this.cloudDiv);
    this.reflSceneRT = this.reflRT = null;
    if (this.reflDiv) {
      const rw = Math.max(2, Math.round(W / this.reflDiv)), rh = Math.max(2, Math.round(H / this.reflDiv));
      const rd = new THREE.DepthTexture(rw, rh, THREE.FloatType); rd.minFilter = rd.magFilter = THREE.NearestFilter;
      this.reflDepth = rd;
      this.reflSceneRT = this.makeRT(rw, rh, { depthBuffer: true, depthTexture: rd });
      this.reflRT = this.makeRT(rw, rh, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, anisotropy: 8 });
      this.reflClouds.setSize(rw / 2, rh / 2);
    }
    this.hdrRT = this.makeRT(W, H);
    this.distRT = this.makeRT(W / 2, H / 2);
    this.bloomRTs = [];
    let bw = W / 2, bh = H / 2;
    for (let i = 0; i < 6; i++) { this.bloomRTs.push(this.makeRT(bw, bh)); bw /= 2; bh /= 2; }
    this.shaftRTs = this.flare ? [0, 1, 2].map(() => this.makeRT(W / 4, H / 4)) : [];
    this.finalMat.uniforms.uRes.value.set(W, H);
    this.depthTexture = depthTex;
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.quadScene, this.quadCam);
  }

  // the world above the sea, seen by the main camera mirrored in the surface (y = 0). The ocean shader projects its
  // reflected rays into this picture through uReflMat.
  renderReflection(scene, camera, cloudsOn) {
    const r = this.r, vc = this.reflCam, R = this.refl;
    _p.setFromMatrixPosition(camera.matrixWorld);
    if (_p.y < 0.3 || !seesWater(camera)) { GU.uReflOn.value = 0; return; }
    _f.set(0, 0, -1).transformDirection(camera.matrixWorld); _u.set(0, 1, 0).transformDirection(camera.matrixWorld);
    vc.position.set(_p.x, -_p.y, _p.z); vc.up.set(_u.x, -_u.y, _u.z);
    vc.lookAt(_p.x + _f.x, -_p.y - _f.y, _p.z + _f.z);
    // a little wider than the eye's view: ripples tilt the rays near the screen edges outward
    vc.fov = Math.min(camera.fov * 1.08 + 1, 150); vc.zoom = camera.zoom; vc.aspect = camera.aspect; vc.near = camera.near; vc.far = camera.far;
    vc.updateProjectionMatrix(); vc.updateMatrixWorld();
    GU.uReflMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    const hid = this._hid; hid.length = 0;
    for (const o of R.hide) if (o && o.visible) { o.visible = false; hid.push(o); }
    const sm = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
    const sun = R.dome && R.dome.material.uniforms.uSunDisk; if (sun) sun.value = 0; // the sea draws its own sun glitter
    // Everything below the sea (hulls under the waterline, the sea floor) would sit between the mirrored camera and
    // the surface: an oblique near plane on the water clips it for every material. The clouds and the composite
    // below need the plain projection back (the oblique one bends the far plane behind the camera for flat rays).
    _proj.copy(vc.projectionMatrix); obliqueNearPlane(vc);
    if (R.terrain) R.terrain.updateLOD(vc);
    r.setRenderTarget(this.reflSceneRT); r.setClearColor(0x000000, 1); r.clear(true, true, false);
    r.render(scene, vc);
    vc.projectionMatrix.copy(_proj);
    if (R.terrain) R.terrain.updateLOD(camera);
    if (sun) sun.value = 1; r.shadowMap.autoUpdate = sm;
    for (const o of hid) o.visible = true;
    if (cloudsOn) this.reflClouds.render(vc, this.reflDepth, this._pass);
    const cu = this.reflCompMat.uniforms;
    cu.uScene.value = this.reflSceneRT.texture; cu.uDepth.value = this.reflDepth;
    cu.uClouds.value = this.reflClouds.texture; cu.uCloudRes.value.set(this.reflClouds.w, this.reflClouds.h);
    cu.uInvProj.value.copy(vc.projectionMatrixInverse); cu.uCamWorld.value.copy(vc.matrixWorld); cu.uCamPosC.value.copy(vc.position);
    cu.uCloudOn.value = cloudsOn ? 1 : 0;
    this.pass(this.reflCompMat, this.reflRT);
    GU.uReflTex.value = this.reflRT.texture; GU.uReflOn.value = 1;
  }

  // fx: { mode, grey, red, exposure, flash, noise, degrade, hurt, fade, inCloud, cloudsOn }
  render(scene, fxScene, camera, fx) {
    const r = this.r;
    this.frame++;
    GU.uThermal.value = (fx.mode === SENSOR.WHOT || fx.mode === SENSOR.BHOT) ? 1 : 0;
    GU.uCamPos.value.copy(camera.position);
    r.autoClear = false;
    camera.updateMatrixWorld();
    const cloudsOn = fx.cloudsOn !== false;
    // 0. what the sea reflects
    if (this.reflDiv && !GU.uThermal.value && !fx.underwater) this.renderReflection(scene, camera, cloudsOn);
    else GU.uReflOn.value = 0;
    // 1. scene
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(scene, camera);

    // 2. clouds
    const invProj = camera.projectionMatrixInverse, camWorld = camera.matrixWorld;
    if (cloudsOn) this.clouds.render(camera, this.depthTexture, this._pass);

    // 3. composite
    const pu = this.compositeMat.uniforms;
    pu.uScene.value = this.sceneRT.texture; pu.uDepth.value = this.depthTexture;
    pu.uClouds.value = this.clouds.texture; pu.uCloudRes.value.set(this.clouds.w, this.clouds.h);
    pu.uInvProj.value.copy(invProj); pu.uCamWorld.value.copy(camWorld); pu.uCamPosC.value.copy(camera.position);
    pu.uCloudOn.value = cloudsOn ? 1 : 0; pu.uUnderwater.value = fx.underwater ? 1 : 0;
    this.pass(this.compositeMat, this.hdrRT);

    // 4. particles & transparent fx (soft depth)
    if (fxScene) {
      r.setRenderTarget(this.hdrRT);
      r.render(fxScene, camera);
    }
    // 5. distortion
    r.setRenderTarget(this.distRT); r.setClearColor(0x000000, 0); r.clear(true, false, false);
    if (this.distScene.children.length) r.render(this.distScene, camera);

    // 6. bloom
    const bd = this.bloomDownMat.uniforms;
    let src = this.hdrRT;
    for (let i = 0; i < this.bloomRTs.length; i++) {
      bd.uSrc.value = src.texture; bd.uTexel.value.set(1 / src.width, 1 / src.height); bd.uFirst.value = i === 0 ? 1 : 0;
      bd.uThreshold.value = fx.mode === SENSOR.NVG ? 0.3 : 1.2 / Math.max(fx.exposure, 0.05);
      this.pass(this.bloomDownMat, this.bloomRTs[i]);
      src = this.bloomRTs[i];
    }
    const bu = this.bloomUpMat.uniforms;
    for (let i = this.bloomRTs.length - 1; i > 0; i--) {
      const s = this.bloomRTs[i], dst = this.bloomRTs[i - 1];
      bu.uSrc.value = s.texture; bu.uTexel.value.set(1 / s.width, 1 / s.height);
      this.pass(this.bloomUpMat, dst);
    }
    // 6b. sun shafts and the flare's view of the sun
    const fu = this.finalMat.uniforms;
    const sun = this.flare && !fx.mode && !fx.underwater ? this.sunScreen(camera) : null;
    if (sun && sun.k > 0.001) {
      const mu = this.shaftMaskMat.uniforms, S = this.shaftRTs;
      mu.uDepth.value = this.depthTexture; mu.uClouds.value = this.clouds.texture; mu.uCloudOn.value = cloudsOn ? 1 : 0;
      mu.uInvProj.value.copy(invProj); mu.uCamWorld.value.copy(camWorld);
      this.pass(this.shaftMaskMat, S[0]);
      // long jittered steps all the way to the sun, then a short pass that fills the gaps between them
      const b = this.shaftBlurMat.uniforms; b.uSun.value.set(sun.x, sun.y);
      b.uSrc.value = S[0].texture; b.uLen.value = 1; b.uDecay.value = 0.965; this.pass(this.shaftBlurMat, S[1]);
      b.uSrc.value = S[1].texture; b.uLen.value = 1 / 26; b.uDecay.value = 1; this.pass(this.shaftBlurMat, S[2]);
      fu.uShafts.value = S[2].texture; fu.uShaftMask.value = S[0].texture; fu.uSunUV.value.set(sun.x, sun.y);
      fu.uShaftStr.value = (fx.shafts != null ? fx.shafts : 0.035) * sun.k; fu.uSunK.value = sun.k;
      const sc = GU.uSunColor.value; fu.uSunTint.value.set(sc.x, sc.y, sc.z).multiplyScalar(1 / 18);
      fu.uFlareStr.value = fx.flare != null ? fx.flare : 1;
    } else { fu.uShaftStr.value = 0; fu.uSunK.value = 0; }
    // 7. final
    fu.uHDR.value = this.hdrRT.texture; fu.uBloom.value = this.bloomRTs[0].texture; fu.uDist.value = this.distRT.texture;
    fu.uExposure.value = fx.exposure; fu.uGrey.value = fx.grey || 0; fu.uRed.value = fx.red || 0; fu.uMode.value = fx.mode || 0;
    fu.uFlash.value = fx.flash || 0; fu.uNoise.value = fx.noise || 0; fu.uDegrade.value = fx.degrade || 0;
    fu.uHurt.value = fx.hurt || 0; fu.uFade.value = fx.fade || 0; fu.uInCloud.value = fx.inCloud || 0;
    fu.uBloomStr.value = fx.bloom != null ? fx.bloom : 0.045;
    if (fx.target !== undefined) this.pass(this.finalMat, fx.target); else this.pass(this.finalMat, null);
    r.setRenderTarget(null);
  }

  // where the sun sits on screen (uv) and how much it counts: k fades as it slides off screen, goes behind the
  // camera or sets
  sunScreen(camera) {
    const sd = GU.uSunDir.value;
    const facing = camera.getWorldDirection(_fwd).dot(sd);
    if (facing < 0.05 || sd.y < -0.03) return { x: 0.5, y: 0.5, k: 0 };
    _sp.copy(sd).multiplyScalar(1e4).add(camera.position).project(camera);
    const off = Math.max(Math.abs(_sp.x), Math.abs(_sp.y)), S = THREE.MathUtils.smoothstep;
    return { x: _sp.x * 0.5 + 0.5, y: _sp.y * 0.5 + 0.5, k: S(facing, 0.05, 0.3) * (1 - S(off, 1.0, 1.8)) * S(sd.y, -0.03, 0.05) };
  }
}
const _fwd = new THREE.Vector3(), _sp = new THREE.Vector3(), _p = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3();
const _proj = new THREE.Matrix4(), _plane = new THREE.Plane(), _q4 = new THREE.Vector4(), _c4 = new THREE.Vector4(), _corner = new THREE.Vector3(), _up = new THREE.Vector3();

// does any of the view reach below the horizon? (the reflection is skipped when the camera only sees sky)
function seesWater(camera) {
  for (let i = 0; i < 4; i++) {
    _corner.set(i & 1 ? 1 : -1, i & 2 ? 1 : -1, 1).unproject(camera).sub(camera.position);
    if (_corner.y < 0) return true;
  }
  return false;
}

// Lengyel's oblique near plane: the camera's near clipping plane becomes the sea surface (three's Reflector does
// the same). Only the depth row changes, so the log depth and the reflection lookup are unaffected.
function obliqueNearPlane(cam) {
  _plane.set(_up.set(0, 1, 0), 0).applyMatrix4(cam.matrixWorldInverse);
  _c4.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
  const e = cam.projectionMatrix.elements;
  _q4.set((Math.sign(_c4.x) + e[8]) / e[0], (Math.sign(_c4.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
  _c4.multiplyScalar(2 / _c4.dot(_q4));
  e[2] = _c4.x; e[6] = _c4.y; e[10] = _c4.z + 1; e[14] = _c4.w;
}

function pick(names) { const o = {}; for (const n of names) o[n] = GU[n]; return o; }
