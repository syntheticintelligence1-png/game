// Multi-pass HDR pipeline:
//  1. scene  -> sceneRT (RGBA16F + float log-depth texture)
//  2. clouds -> cloudRT (half res, depth aware raymarch)
//  3. composite: aerial perspective + clouds -> hdrRT
//  4. particles / trails / flames -> hdrRT (soft depth test against scene depth)
//  5. distortion (shockwaves) -> distRT
//  6. bloom (Karis-filtered down chain + tent up chain)
//  7. final: exposure, ACES, G-LOC grey/black/red-out, vignette, sensor modes (TV/FLIR/NVG), grain
import * as THREE from 'three';
import { GU, GLSL_COMMON, GLSL_ACES, FULLSCREEN_VS, fullscreenTriangle } from './glsl.js';
import { makeCloudMaterial } from './clouds.js';

const HALF = THREE.HalfFloatType;

export const SENSOR = { NORMAL: 0, TV: 1, WHOT: 2, BHOT: 3, NVG: 4 };

export class Pipeline {
  constructor(renderer, w, h, opts = {}) {
    this.r = renderer;
    this.quality = opts.quality || 'medium';
    this.cloudSteps = { low: 28, medium: 44, high: 64 }[this.quality] || 44;
    this.scale = opts.scale || 1;
    this.frame = 0;
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(fullscreenTriangle(), null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.cloudMat = makeCloudMaterial();
    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        ...pick(['uTime', 'uSunDir', 'uSunColor', 'uSkyAmb', 'uGroundAmb', 'uSkyTex', 'uFogDensity', 'uFogHeight', 'uThermal', 'uNight', 'uLogFar']),
        uScene: { value: null }, uDepth: { value: null }, uClouds: { value: null },
        uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPosC: { value: new THREE.Vector3() },
        uUnderwater: { value: 0 }, uCloudOn: { value: 1 },
      },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        uniform sampler2D uScene; uniform sampler2D uDepth; uniform sampler2D uClouds;
        uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform vec3 uCamPosC; uniform float uLogFar;
        uniform float uUnderwater; uniform float uCloudOn;
        varying vec2 vUv;
        void main() {
          vec3 col = texture(uScene, vUv).rgb;
          float d = texture(uDepth, vUv).r;
          vec4 vr = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
          vec3 vdir = normalize(vr.xyz / vr.w);
          vec3 rd = normalize(mat3(uCamWorld) * vdir);
          if (d < 0.999999) {
            float w = exp2(d * uLogFar) - 1.0;
            float dist = w / max(-vdir.z, 1e-4);
            if (uThermal > 0.5) {
              float T = fogTransmittance(uCamPosC, rd, dist * 0.6);
              col = col * T + vec3(0.1) * (1.0 - T);
            } else {
              col = aerialPerspective(col, uCamPosC, rd, dist);
            }
          }
          if (uCloudOn > 0.5) {
            vec4 cl = texture(uClouds, vUv);
            col = col * cl.a + cl.rgb;
          }
          if (uUnderwater > 0.5) col = col * vec3(0.05, 0.25, 0.3) + vec3(0.0, 0.03, 0.05);
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

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

    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        uHDR: { value: null }, uBloom: { value: null }, uDist: { value: null }, uExposure: { value: 0.35 }, uBloomStr: { value: 0.045 },
        uGrey: { value: 0 }, uRed: { value: 0 }, uMode: { value: 0 }, uTime: GU.uTime, uRes: { value: new THREE.Vector2(1, 1) },
        uFlash: { value: 0 }, uDamage: { value: 0 }, uNoise: { value: 0 }, uDegrade: { value: 0 }, uVignette: { value: 0.28 },
        uHurt: { value: 0 }, uFade: { value: 0 }, uInCloud: { value: 0 },
      },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: /* glsl */`
        #define PI 3.14159265359
        ${GLSL_ACES}
        uniform sampler2D uHDR; uniform sampler2D uBloom; uniform sampler2D uDist;
        uniform float uExposure; uniform float uBloomStr; uniform float uGrey; uniform float uRed; uniform float uMode;
        uniform float uTime; uniform vec2 uRes; uniform float uFlash; uniform float uDamage; uniform float uNoise; uniform float uDegrade;
        uniform float uVignette; uniform float uHurt; uniform float uFade; uniform float uInCloud;
        varying vec2 vUv;
        float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
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
            vec3 c = mix(hdr, bloom, uBloomStr) + bloom * uBloomStr * 0.6;
            c *= uExposure;
            c += uFlash * vec3(1.0, 0.95, 0.9);
            col = ACESFitted(c);
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

  setSize(w, h) {
    this.w = Math.max(2, Math.floor(w * this.scale)); this.h = Math.max(2, Math.floor(h * this.scale));
    const W = this.w, H = this.h;
    for (const rt of [this.sceneRT, this.cloudRT, this.hdrRT, this.distRT, ...(this.bloomRTs || [])]) if (rt) rt.dispose();
    const depthTex = new THREE.DepthTexture(W, H, THREE.FloatType);
    depthTex.minFilter = THREE.NearestFilter; depthTex.magFilter = THREE.NearestFilter;
    this.sceneRT = this.makeRT(W, H, { depthBuffer: true, depthTexture: depthTex });
    this.cloudDiv = this.quality === 'high' ? 1.5 : 2;
    this.cloudRT = this.makeRT(W / this.cloudDiv, H / this.cloudDiv);
    this.hdrRT = this.makeRT(W, H);
    this.distRT = this.makeRT(W / 2, H / 2);
    this.bloomRTs = [];
    let bw = W / 2, bh = H / 2;
    for (let i = 0; i < 6; i++) { this.bloomRTs.push(this.makeRT(bw, bh)); bw /= 2; bh /= 2; }
    this.finalMat.uniforms.uRes.value.set(W, H);
    this.depthTexture = depthTex;
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.quadScene, this.quadCam);
  }

  // fx: { mode, grey, red, exposure, flash, noise, degrade, hurt, fade, inCloud, cloudsOn }
  render(scene, fxScene, camera, fx) {
    const r = this.r;
    this.frame++;
    GU.uThermal.value = (fx.mode === SENSOR.WHOT || fx.mode === SENSOR.BHOT) ? 1 : 0;
    GU.uCamPos.value.copy(camera.position);
    r.autoClear = false;
    // 1. scene
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(scene, camera);

    // 2. clouds
    camera.updateMatrixWorld();
    const invProj = camera.projectionMatrixInverse, camWorld = camera.matrixWorld;
    const cu = this.cloudMat.uniforms;
    cu.uDepth.value = this.depthTexture; cu.uInvProj.value.copy(invProj); cu.uCamWorld.value.copy(camWorld);
    cu.uCamPosC.value.copy(camera.position); cu.uSteps.value = this.cloudSteps; cu.uFrame.value = this.frame;
    const cloudsOn = fx.cloudsOn !== false;
    if (cloudsOn) this.pass(this.cloudMat, this.cloudRT);

    // 3. composite
    const pu = this.compositeMat.uniforms;
    pu.uScene.value = this.sceneRT.texture; pu.uDepth.value = this.depthTexture; pu.uClouds.value = this.cloudRT.texture;
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
    // 7. final
    const fu = this.finalMat.uniforms;
    fu.uHDR.value = this.hdrRT.texture; fu.uBloom.value = this.bloomRTs[0].texture; fu.uDist.value = this.distRT.texture;
    fu.uExposure.value = fx.exposure; fu.uGrey.value = fx.grey || 0; fu.uRed.value = fx.red || 0; fu.uMode.value = fx.mode || 0;
    fu.uFlash.value = fx.flash || 0; fu.uNoise.value = fx.noise || 0; fu.uDegrade.value = fx.degrade || 0;
    fu.uHurt.value = fx.hurt || 0; fu.uFade.value = fx.fade || 0; fu.uInCloud.value = fx.inCloud || 0;
    fu.uBloomStr.value = fx.bloom != null ? fx.bloom : 0.045;
    if (fx.target !== undefined) this.pass(this.finalMat, fx.target); else this.pass(this.finalMat, null);
    r.setRenderTarget(null);
  }
}

function pick(names) { const o = {}; for (const n of names) o[n] = GU[n]; return o; }
