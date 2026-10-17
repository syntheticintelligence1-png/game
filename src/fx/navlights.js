// Aircraft & ship lighting: red (port) / green (starboard) navigation lights, white tail light, flashing white
// anti-collision strobes, red rotating beacons and dim green formation strips. Rendered as HDR points that keep
// a minimum on-screen size, so at night they read from kilometres away and bloom; by day they are small dots.
import * as THREE from 'three';
import { GU } from '../render/glsl.js';
import { DECK_Y, DECK_POLY, LANDING, landingPoint } from '../models/carrier.js';

export const LIGHT = { STEADY: 0, STROBE: 1, BEACON: 2, FORMATION: 3, GEAR: 4 };
const COL = {
  red: [14, 0.7, 0.35], green: [0.5, 12, 1.8], white: [11, 10.5, 9.5], strobe: [46, 46, 48], beacon: [30, 1.2, 0.6], formation: [0.35, 2.6, 0.7], landing: [30, 28, 24],
  deck: [6.5, 5.6, 3.9], blue: [0.5, 1.4, 8.5], drop: [12, 0.9, 0.3],
};

const VS = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 aColor; attribute float aPattern; attribute float aSize;
  uniform float uTime, uPhase, uViewportH, uNightK, uGear;
  varying vec3 vColor; varying float vOn;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float t = uTime + uPhase;
    float on = 1.0;
    if (aPattern > 0.5 && aPattern < 1.5) { float f = fract(t * 0.95); on = (f < 0.045 || (f > 0.16 && f < 0.205)) ? 1.0 : 0.0; }      // double-flash strobe
    else if (aPattern > 1.5 && aPattern < 2.5) { on = pow(max(0.0, sin(t * 7.2)), 6.0); }                                              // rotating beacon
    else if (aPattern > 2.5 && aPattern < 3.5) { on = uNightK; }                                                                       // formation strips: night only
    else if (aPattern > 3.5) { on = uGear; }                                                                                            // landing/taxi light, gear down
    vOn = on;
    vColor = aColor * mix(0.22, 1.0, uNightK);
    float px = aSize * projectionMatrix[1][1] * uViewportH * 0.5 / max(-mv.z, 0.1);
    gl_PointSize = on > 0.001 ? clamp(px, mix(1.6, 3.2, uNightK), 64.0) : 0.0;
    #include <logdepthbuf_vertex>
  }`;
const FS = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform float uThermal;
  varying vec3 vColor; varying float vOn;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d) * 4.0;
    if (r2 > 1.0 || vOn < 0.001) discard;
    float core = exp(-r2 * 7.0), halo = exp(-r2 * 2.2) * 0.35;
    vec3 c = vColor * vOn * (core + halo);
    if (uThermal > 0.5) c = vec3(dot(c, vec3(0.08)));
    gl_FragColor = vec4(c, 1.0);
  }`;

let _mat = null;
function material() {
  if (_mat) return _mat;
  _mat = new THREE.ShaderMaterial({
    uniforms: { uTime: GU.uTime, uPhase: { value: 0 }, uViewportH: { value: 900 }, uNightK: { value: 0 }, uGear: { value: 0 }, uThermal: GU.uThermal },
    vertexShader: VS, fragmentShader: FS, transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return _mat;
}

// lights: [{ p: [x,y,z], c: 'red'|..., pattern, size }]
export function attachLights(root, lights, o = {}) {
  const n = lights.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), pat = new Float32Array(n), size = new Float32Array(n);
  lights.forEach((L, i) => { pos.set(L.p, i * 3); col.set(COL[L.c] || COL.white, i * 3); pat[i] = L.pattern || 0; size[i] = L.size || 0.35; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPattern', new THREE.BufferAttribute(pat, 1)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  // each light set gets its own uniforms (flash phase, gear state) on a clone of the shared program
  const m = material().clone();
  m.uniforms.uTime = GU.uTime; m.uniforms.uThermal = material().uniforms.uThermal;
  m.uniforms.uNightK = material().uniforms.uNightK; m.uniforms.uViewportH = material().uniforms.uViewportH;
  m.uniforms.uPhase = { value: o.phase != null ? o.phase : Math.random() * 10 }; m.uniforms.uGear = { value: 0 };
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 5;
  root.add(pts);
  return { points: pts, setGear(v) { m.uniforms.uGear.value = v; } };
}
// call once per frame
export function updateLights(nightK, viewportH) { const m = material(); m.uniforms.uNightK.value = nightK; m.uniforms.uViewportH.value = viewportH; }

// light layouts
export const HORNET_LIGHTS = [
  { p: [-6.42, -0.22, 3.45], c: 'red' }, { p: [6.42, -0.22, 3.45], c: 'green' },            // wingtip navigation
  { p: [0, 0.42, 8.75], c: 'white' },                                                          // tail
  { p: [-2.16, 3.36, 6.6], c: 'strobe', pattern: LIGHT.STROBE, size: 0.5 }, { p: [2.16, 3.36, 6.6], c: 'strobe', pattern: LIGHT.STROBE, size: 0.5 },
  { p: [0, -0.95, -1.2], c: 'beacon', pattern: LIGHT.BEACON, size: 0.45 },                     // belly beacon
  { p: [-6.3, -0.2, 3.9], c: 'formation', pattern: LIGHT.FORMATION, size: 0.22 }, { p: [6.3, -0.2, 3.9], c: 'formation', pattern: LIGHT.FORMATION, size: 0.22 },
  { p: [-1.05, 0.15, -3.2], c: 'formation', pattern: LIGHT.FORMATION, size: 0.22 }, { p: [1.05, 0.15, -3.2], c: 'formation', pattern: LIGHT.FORMATION, size: 0.22 },
  { p: [-2.0, 2.2, 7.0], c: 'formation', pattern: LIGHT.FORMATION, size: 0.22 }, { p: [2.0, 2.2, 7.0], c: 'formation', pattern: LIGHT.FORMATION, size: 0.22 },
  { p: [0, -2.05, -5.6], c: 'landing', pattern: LIGHT.GEAR, size: 0.55 },                     // nose-gear landing/taxi light
];
export const FLANKER_LIGHTS = [
  { p: [-7.45, 0, 3.9], c: 'red' }, { p: [7.45, 0, 3.9], c: 'green' }, { p: [0, 0.6, 10.6], c: 'white' },
  { p: [0, 1.2, 1.5], c: 'beacon', pattern: LIGHT.BEACON, size: 0.5 }, { p: [0, -1.1, 0.5], c: 'beacon', pattern: LIGHT.BEACON, size: 0.5 },
  { p: [-7.4, 0, 4.2], c: 'strobe', pattern: LIGHT.STROBE, size: 0.45 }, { p: [7.4, 0, 4.2], c: 'strobe', pattern: LIGHT.STROBE, size: 0.45 },
];
// carrier flight deck at night: the angled landing area outlined and centerlined in white, blue lights around
// the deck edge, the red drop lights hanging under the stern on the landing centerline, and the island's mast lights
export function carrierLights() {
  const out = [], D = DECK_Y + 0.22, hw = LANDING.halfWidth;
  for (let s = 6; s <= 232; s += 11) for (const off of [-hw, hw]) { const p = landingPoint(s, off); out.push({ p: [p.x, D, p.y], c: 'deck', size: 0.3 }); }
  for (let s = 3; s <= 232; s += 8) { const p = landingPoint(s, 0); out.push({ p: [p.x, D, p.y], c: 'deck', size: 0.26 }); }
  for (let k = 0; k < 9; k++) out.push({ p: [LANDING.ramp.x, DECK_Y - 1.2 - k * 1.5, LANDING.ramp.y + 0.6], c: 'drop', size: 0.4 });
  for (let i = 0; i < DECK_POLY.length; i++) {
    const [x0, z0] = DECK_POLY[i], [x1, z1] = DECK_POLY[(i + 1) % DECK_POLY.length], n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 15));
    for (let k = 0; k < n; k++) { const t = k / n; out.push({ p: [x0 + (x1 - x0) * t, DECK_Y + 0.3, z0 + (z1 - z0) * t], c: 'blue', size: 0.3 }); }
  }
  out.push({ p: [27, 57.2, 12], c: 'beacon', pattern: LIGHT.BEACON, size: 0.9 }, { p: [27, 53.5, 6], c: 'white', size: 0.8 }, { p: [27, 50, 20], c: 'white', size: 0.8 });
  out.push({ p: [33.2, 31, -4], c: 'green', size: 0.9 }, { p: [-48, 21, -36], c: 'red', size: 0.9 }, { p: [0, 21.5, 168], c: 'white', size: 0.8 });
  return out;
}
export function shipLights(L, B, mastH) {
  return [
    { p: [0, mastH, -L * 0.15], c: 'white', size: 0.9 }, { p: [0, mastH * 0.8, L * 0.25], c: 'white', size: 0.9 },   // masthead lights
    { p: [-B * 0.5, mastH * 0.35, -L * 0.1], c: 'red', size: 0.8 }, { p: [B * 0.5, mastH * 0.35, -L * 0.1], c: 'green', size: 0.8 }, // sidelights
    { p: [0, 6, L * 0.49], c: 'white', size: 0.7 },                                                                 // stern light
    { p: [0, mastH + 2, 0], c: 'beacon', pattern: LIGHT.BEACON, size: 0.9 },
  ];
}
