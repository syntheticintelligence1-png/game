// Player fighter: twin-engine carrier strike fighter (Super Hornet–like) built procedurally.
// Faces -Z, origin at the center of gravity. Moving parts are pivot groups.
import * as THREE from 'three';
import { Parts, meshes, loft, wing, box, cyl, cylZ, sphere, cone, xform, prep, merge, col, canvasTex, slab } from './kit.js';

// Gear contact points (body frame, meters) used by the physics
export const JET_GEOM = {
  noseGear: new THREE.Vector3(0, -2.22, -5.75),
  mainL: new THREE.Vector3(-1.58, -2.24, 0.75),
  mainR: new THREE.Vector3(1.58, -2.24, 0.75),
  hookPivot: new THREE.Vector3(0, -0.62, 5.9),
  hookLen: 2.35,
  launchBar: new THREE.Vector3(0, -2.05, -6.25),
  eye: new THREE.Vector3(0, 1.06, -4.9), // design eye: ~12° of view over the glare shield, enough to see the deck on approach
  gun: new THREE.Vector3(0, 0.42, -8.4),
  nozzleL: new THREE.Vector3(-0.56, -0.1, 8.65),
  nozzleR: new THREE.Vector3(0.56, -0.1, 8.65),
  wingtipL: new THREE.Vector3(-6.35, -0.25, 3.6),
  wingtipR: new THREE.Vector3(6.35, -0.25, 3.6),
  lexL: new THREE.Vector3(-1.4, 0.2, -2.4),
  lexR: new THREE.Vector3(1.4, 0.2, -2.4),
  tgp: new THREE.Vector3(-1.05, -0.95, -1.9),
};

// weapon stations: id, position, kind of rail
export const STATIONS = [
  { id: 'L1', pos: [-6.38, -0.32, 2.2], rail: 'tip' }, { id: 'R1', pos: [6.38, -0.32, 2.2], rail: 'tip' },
  { id: 'L2', pos: [-4.7, -0.62, 1.0], rail: 'pylon' }, { id: 'R2', pos: [4.7, -0.62, 1.0], rail: 'pylon' },
  { id: 'L3', pos: [-3.35, -0.66, 0.7], rail: 'pylon' }, { id: 'R3', pos: [3.35, -0.66, 0.7], rail: 'pylon' },
  { id: 'L4', pos: [-2.1, -0.7, 0.4], rail: 'pylon' }, { id: 'R4', pos: [2.1, -0.7, 0.4], rail: 'pylon' },
  { id: 'C5', pos: [0, -0.88, 0.6], rail: 'center' },
  { id: 'R6', pos: [1.08, -0.86, -1.7], rail: 'cheek' },
];

function panelTexture() {
  return canvasTex(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    // subtle weathering
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = Math.random() * 18 + 2;
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '80,85,90' : '255,255,255'},${Math.random() * 0.035})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // streaks (exhaust/oil)
    for (let i = 0; i < 140; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const g = ctx.createLinearGradient(x, y, x, y + 120);
      g.addColorStop(0, 'rgba(60,60,60,0.06)'); g.addColorStop(1, 'rgba(60,60,60,0)');
      ctx.fillStyle = g; ctx.fillRect(x, y, 2 + Math.random() * 6, 120);
    }
    // panel lines
    ctx.strokeStyle = 'rgba(40,44,48,0.55)'; ctx.lineWidth = 1.5;
    const rows = 16;
    for (let r = 0; r < rows; r++) {
      const y0 = r * h / rows;
      ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke();
      let x = 0;
      while (x < w) { const pw = 40 + Math.random() * 160; x += pw; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h / rows); ctx.stroke(); }
    }
    // rivet rows
    ctx.fillStyle = 'rgba(50,55,60,0.4)';
    for (let r = 0; r < rows; r++) for (let x = 0; x < w; x += 9) ctx.fillRect(x, r * h / rows + 5, 1.2, 1.2);
    // access panels
    ctx.strokeStyle = 'rgba(30,34,38,0.6)';
    for (let i = 0; i < 60; i++) { const x = Math.random() * w, y = Math.random() * h; ctx.strokeRect(x, y, 14 + Math.random() * 40, 10 + Math.random() * 24); }
  });
}

function decalTex(draw, w = 512, h = 256) {
  const t = canvasTex(w, h, (ctx) => { ctx.clearRect(0, 0, w, h); draw(ctx, w, h); });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

let _panelTex = null;
export function jetMaterials(scheme = 'navy') {
  if (!_panelTex) _panelTex = panelTexture();
  const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.28, map: _panelTex, bumpMap: _panelTex, bumpScale: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.75, metalness: 0.4, side: THREE.DoubleSide });
  const metal = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ color: 0xc8b070, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false, envMapIntensity: 2.2, side: THREE.DoubleSide });
  const light = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 2, vertexColors: true });
  return { paint, dark, metal, glass, light };
}

const C = {
  top: col('#8b9298'), bot: col('#a7adb2'), radome: col('#73787c'), dark: col('#2c2f33'), black: col('#151618'), tire: col('#141414'),
  nozzle: col('#4a4440'), nozzleIn: col('#2a221c'), white: col('#e8e8e4'), gear: col('#d8d8d2'), red: col('#b02020'), green: col('#1f9f3a'),
  edge: col('#7e8489'), intake: col('#0c0d0e'), store: col('#d9d9d4'), olive: col('#535b3f'), bomb: col('#5c6248'), glassFrame: col('#3a3e42'),
};

export function buildFighter(opts = {}) {
  const lowDetail = !!opts.lowDetail;
  const mats = jetMaterials();
  const root = new THREE.Group(); root.name = 'fighter';
  const P = new Parts();
  const seg = lowDetail ? 14 : 28;
  // --- fuselage ---
  const fus = [
    { z: -9.62, w: 0.04, h: 0.04, y: 0.02 },
    { z: -9.35, w: 0.3, h: 0.28, y: 0.02 },
    { z: -8.9, w: 0.56, h: 0.54, y: 0.03 },
    { z: -8.2, w: 0.82, h: 0.78, y: 0.05 },
    { z: -7.4, w: 1.0, h: 0.94, y: 0.08 },
  ];
  P.add('paint', loft(fus, seg, C.radome));
  const fus2 = [
    { z: -7.4, w: 1.0, h: 0.94, y: 0.08, n: 2.1 },
    { z: -6.6, w: 1.14, h: 1.06, y: 0.12, n: 2.3, wb: 0.85 },
    { z: -5.6, w: 1.28, h: 1.14, y: 0.12, n: 2.5, wb: 0.8 },
    { z: -4.4, w: 1.42, h: 1.18, y: 0.1, n: 2.6, wb: 0.85 },
    { z: -3.2, w: 1.95, h: 1.2, y: 0.05, n: 2.8, wb: 0.9 },
    { z: -2.0, w: 2.45, h: 1.24, y: 0.02, n: 3.0 },
    { z: -0.8, w: 2.75, h: 1.24, y: 0.0, n: 3.2 },
    { z: 0.6, w: 2.85, h: 1.2, y: 0.0, n: 3.2 },
    { z: 2.2, w: 2.78, h: 1.14, y: -0.02, n: 3.0 },
    { z: 3.8, w: 2.6, h: 1.06, y: -0.04, n: 2.8 },
    { z: 5.3, w: 2.36, h: 0.98, y: -0.06, n: 2.6 },
    { z: 6.6, w: 2.12, h: 0.9, y: -0.08, n: 2.5 },
    { z: 7.6, w: 1.98, h: 0.8, y: -0.1, n: 2.4 },
  ];
  P.add('paint', loft(fus2, seg, C.top));
  // underside belly (lighter) slightly inset
  P.add('paint', loft(fus2.slice(3).map(s => ({ ...s, w: s.w * 0.9, h: s.h * 0.55, y: s.y - s.h * 0.24 })), seg, C.bot));
  // dorsal spine behind canopy
  P.add('paint', loft([
    { z: -3.3, w: 0.5, h: 0.2, y: 0.72 }, { z: -2.2, w: 0.72, h: 0.42, y: 0.62 }, { z: 0.0, w: 0.86, h: 0.5, y: 0.6 },
    { z: 2.5, w: 0.8, h: 0.42, y: 0.55 }, { z: 5.0, w: 0.6, h: 0.3, y: 0.46 }, { z: 6.8, w: 0.3, h: 0.16, y: 0.38 },
  ], seg / 2, C.top));
  // engine nacelles + nozzles
  for (const sx of [-1, 1]) {
    P.add('paint', loft([
      { z: 5.0, w: 1.12, h: 0.98, y: -0.1, x: sx * 0.56 }, { z: 6.8, w: 1.02, h: 0.98, y: -0.1, x: sx * 0.56 },
      { z: 7.9, w: 0.98, h: 0.96, y: -0.1, x: sx * 0.56 },
    ], seg / 2, C.top));
  }
  // LEX (leading edge extensions) — thin slabs
  for (const sx of [-1, 1]) {
    const pts = [[0.55, -6.9], [0.8, -5.6], [1.2, -3.9], [1.62, -2.3], [1.95, -0.9], [2.1, 0.0], [1.0, 0.0], [0.6, -3.0]].map(([x, z]) => [x * sx, z]);
    if (sx < 0) pts.reverse();
    P.add('paint', slab(pts, 0.12, 0.08, C.top));
  }
  // intakes (caret) under the LEX
  for (const sx of [-1, 1]) {
    P.add('paint', loft([
      { z: -3.3, w: 0.78, h: 0.82, y: -0.52, x: sx * 1.18, n: 3 }, { z: -2.0, w: 0.82, h: 0.86, y: -0.5, x: sx * 1.2, n: 3 },
      { z: -0.4, w: 0.8, h: 0.82, y: -0.46, x: sx * 1.18, n: 3 }, { z: 1.4, w: 0.6, h: 0.6, y: -0.38, x: sx * 1.05, n: 3 },
    ], 12, C.bot));
    P.add('dark', box(0.62, 0.66, 0.05, sx * 1.18, -0.52, -3.29, C.intake));
  }
  // --- wings (main box 0-78% chord) ---
  const wingRoot = { le: [1.3, 0.0, -0.9], chord: 4.75, tc: 0.055 };
  const wingTip = { le: [6.25, -0.26, 2.05], chord: 1.65, tc: 0.045 };
  for (const sx of [-1, 1]) {
    const r = { le: [wingRoot.le[0] * sx, wingRoot.le[1], wingRoot.le[2]], chord: wingRoot.chord * 0.78, tc: 0.07 };
    const t = { le: [wingTip.le[0] * sx, wingTip.le[1], wingTip.le[2]], chord: wingTip.chord * 0.78, tc: 0.058 };
    P.add('paint', wing(r, t, C.top, 0, { n: lowDetail ? 6 : 10 }));
    // wingtip launcher rail
    P.add('paint', box(0.12, 0.14, 2.6, sx * 6.33, -0.3, 3.0, C.top));
  }
  const pivots = {};
  const makeTE = (name, sx, s0, s1) => {
    // trailing-edge surface spanning fraction s0..s1 of the semi-span
    const lerp = (a, b, t) => a + (b - a) * t;
    const rootX = lerp(wingRoot.le[0], wingTip.le[0], s0), tipX = lerp(wingRoot.le[0], wingTip.le[0], s1);
    const rootY = lerp(wingRoot.le[1], wingTip.le[1], s0), tipY = lerp(wingRoot.le[1], wingTip.le[1], s1);
    const rootLE = lerp(wingRoot.le[2], wingTip.le[2], s0), tipLE = lerp(wingRoot.le[2], wingTip.le[2], s1);
    const rootC = lerp(wingRoot.chord, wingTip.chord, s0), tipC = lerp(wingRoot.chord, wingTip.chord, s1);
    const hingeR = new THREE.Vector3(rootX * sx, rootY, rootLE + rootC * 0.78);
    const hingeT = new THREE.Vector3(tipX * sx, tipY, tipLE + tipC * 0.78);
    const g = new THREE.Group(); g.position.copy(hingeR);
    const axis = hingeT.clone().sub(hingeR).normalize();
    // orient group so its local X is the hinge axis
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis.clone().multiplyScalar(sx));
    g.quaternion.copy(q);
    const inv = q.clone().invert();
    const toLocal = (v) => v.clone().sub(hingeR).applyQuaternion(inv);
    const r = toLocal(hingeR), t = toLocal(hingeT);
    const geo = wing({ le: [r.x, r.y, r.z], chord: rootC * 0.22, tc: 0.03 }, { le: [t.x, t.y, t.z], chord: tipC * 0.22, tc: 0.03 }, C.edge, 0, { n: 6 });
    const m = new THREE.Mesh(merge([geo]), mats.paint); m.castShadow = true; m.receiveShadow = true;
    const holder = new THREE.Group(); holder.add(m); g.add(holder);
    root.add(g); pivots[name] = holder;
  };
  makeTE('flapL', -1, 0.0, 0.48); makeTE('flapR', 1, 0.0, 0.48);
  makeTE('ailL', -1, 0.48, 0.97); makeTE('ailR', 1, 0.48, 0.97);
  // --- stabilators ---
  for (const sx of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(sx * 1.55, -0.12, 6.75);
    const geo = wing({ le: [sx * 0.0, 0, -1.2], chord: 2.65, tc: 0.045 }, { le: [sx * 1.95, -0.22, 0.65], chord: 1.05, tc: 0.04 }, C.top, 0, { n: 8 });
    const m = new THREE.Mesh(merge([geo]), mats.paint); m.castShadow = true; m.receiveShadow = true; g.add(m);
    root.add(g); pivots[sx < 0 ? 'stabL' : 'stabR'] = g;
  }
  // --- vertical tails (canted 20 deg outboard) with rudders ---
  for (const sx of [-1, 1]) {
    const tail = new THREE.Group(); tail.position.set(sx * 1.02, 0.42, 0); tail.rotation.z = -sx * THREE.MathUtils.degToRad(20);
    const fin = wing({ le: [0, 0, 3.55], chord: 3.25, tc: 0.05 }, { le: [0, 2.95, 5.75], chord: 1.25, tc: 0.04 }, C.top, 0, { up: [1, 0, 0], n: 8 });
    const finM = new THREE.Mesh(merge([fin]), mats.paint); finM.castShadow = true; tail.add(finM);
    // squadron marking decal
    if (!lowDetail) {
      const tex = decalTex((ctx, w, h) => {
        ctx.fillStyle = 'rgba(20,20,22,0.85)';
        ctx.beginPath(); ctx.moveTo(40, 220); ctx.lineTo(470, 40); ctx.lineTo(380, 150); ctx.lineTo(500, 180); ctx.lineTo(60, 236); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(214,170,40,0.95)';
        ctx.beginPath(); ctx.moveTo(70, 205); ctx.lineTo(440, 58); ctx.lineTo(360, 148); ctx.lineTo(450, 172); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(25,25,25,0.9)'; ctx.font = 'bold 44px Arial'; ctx.fillText('AJ', 60, 120);
      });
      for (const side of [-1, 1]) {
        const dm = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, metalness: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
        dm.position.set(side * 0.09, 1.25, 5.0); dm.rotation.y = side * Math.PI / 2; dm.rotation.x = 0;
        dm.rotateX(-0.2);
        tail.add(dm);
      }
    }
    const rud = new THREE.Group(); rud.position.set(0, 0.25, 6.35);
    rud.rotation.x = 0.068;
    const rg = wing({ le: [0, 0, 0], chord: 0.5, tc: 0.03 }, { le: [0, 1.85, 0.0], chord: 0.42, tc: 0.03 }, C.edge, 0, { up: [1, 0, 0], n: 5 });
    const rm = new THREE.Mesh(merge([rg]), mats.paint); rm.castShadow = true;
    const rh = new THREE.Group(); rh.add(rm); rud.add(rh); tail.add(rud);
    root.add(tail); pivots[sx < 0 ? 'rudL' : 'rudR'] = rh;
  }
  // --- canopy & frame ---
  const canopyGeo = new THREE.SphereGeometry(1, lowDetail ? 12 : 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  canopyGeo.scale(0.52, 0.5, 1.7); canopyGeo.translate(0, 0.62, -4.75);
  const canopy = new THREE.Mesh(canopyGeo, mats.glass); canopy.renderOrder = 5; root.add(canopy);
  P.add('dark', xform(prep(new THREE.TorusGeometry(0.53, 0.035, 6, 24, Math.PI), C.glassFrame), 0, 0.62, -5.75, 0, 0, 0, 1, 0.98, 1));
  P.add('dark', xform(prep(new THREE.TorusGeometry(0.53, 0.03, 6, 24, Math.PI), C.glassFrame), 0, 0.62, -4.35, 0, 0, 0, 0.99, 0.95, 1));
  P.add('dark', box(0.05, 0.05, 3.3, -0.5, 0.64, -4.75, C.glassFrame)); P.add('dark', box(0.05, 0.05, 3.3, 0.5, 0.64, -4.75, C.glassFrame));
  // ejection seat headrest (visible through the canopy)
  P.add('dark', box(0.42, 0.62, 0.22, 0, 0.92, -4.28, C.dark));
  P.add('dark', sphere(0.17, 10, 8, 0, 1.0, -4.62, col('#5a5f40'))); // pilot helmet
  // gun port & antennas
  P.add('dark', cylZ(0.035, 0.035, 0.25, 6, 0, 0.44, -8.4, C.black));
  P.add('paint', box(0.03, 0.22, 0.25, 0, 0.75, 1.5, C.dark));
  // nav lights
  P.add('light', sphere(0.05, 6, 4, -6.34, -0.24, 1.75, C.red)); P.add('light', sphere(0.05, 6, 4, 6.34, -0.24, 1.75, C.green));
  // nozzles: petals ring (variable geometry handled by scaling pivot)
  const nozzles = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(sx * 0.56, -0.1, 7.9);
    const outer = merge([cyl(0.47, 0.5, 0.75, 20, 0, 0, 0.37, C.nozzle, 0.4, Math.PI / 2, 0, 0, true)]);
    const om = new THREE.Mesh(outer, mats.metal); om.castShadow = true; g.add(om);
    const inner = merge([cyl(0.43, 0.46, 0.7, 18, 0, 0, 0.36, C.nozzleIn, 1.0, -Math.PI / 2, 0, 0, true), cyl(0.36, 0.36, 0.05, 16, 0, 0, 0.0, C.nozzleIn, 1.0, Math.PI / 2, 0, 0)]);
    const im = new THREE.Mesh(inner, mats.dark); g.add(im);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.36, 18), new THREE.MeshBasicMaterial({ color: 0xff6a20 }));
    glow.position.set(0, 0, 0.05); glow.rotation.y = Math.PI; g.add(glow);
    root.add(g); nozzles.push({ group: g, glow, petals: om });
  }
  // --- airbrake (dorsal) ---
  const abG = new THREE.Group(); abG.position.set(0, 0.86, -0.9);
  const abM = new THREE.Mesh(merge([box(0.7, 0.04, 1.6, 0, 0, 0.8, C.top)]), mats.paint); abM.castShadow = true; abG.add(abM);
  root.add(abG); pivots.airbrake = abG;
  // --- landing gear ---
  const gear = {};
  {
    // nose gear: pivot at top of strut, retracts forward
    const g = new THREE.Group(); g.position.set(0, -0.55, -5.75);
    const parts = [cyl(0.07, 0.07, 1.42, 8, 0, -0.71, 0, C.gear), cyl(0.05, 0.05, 0.5, 6, 0, -1.1, 0.18, C.gear, 0, 0.5, 0, 0),
      cyl(0.27, 0.27, 0.16, 14, -0.18, -1.38, 0, C.tire, 0, 0, 0, Math.PI / 2), cyl(0.27, 0.27, 0.16, 14, 0.18, -1.38, 0, C.tire, 0, 0, 0, Math.PI / 2),
      cyl(0.13, 0.13, 0.17, 10, -0.18, -1.38, 0, C.gear, 0, 0, 0, Math.PI / 2), cyl(0.13, 0.13, 0.17, 10, 0.18, -1.38, 0, C.gear, 0, 0, 0, Math.PI / 2)];
    const m = new THREE.Mesh(merge(parts), mats.dark); m.castShadow = true; g.add(m);
    // launch bar
    const lb = new THREE.Group(); lb.position.set(0, -1.3, -0.05);
    const lbm = new THREE.Mesh(merge([box(0.08, 0.06, 0.75, 0, 0, -0.37, C.gear)]), mats.dark); lb.add(lbm);
    g.add(lb); gear.launchBar = lb;
    root.add(g); gear.nose = g; gear.noseStrut = m;
    // gear doors
  }
  for (const sx of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(sx * 1.25, -0.5, 0.75);
    const parts = [cyl(0.085, 0.085, 1.5, 8, sx * 0.15, -0.72, 0, C.gear, 0, 0, 0, -sx * 0.2), box(0.06, 0.06, 0.9, sx * 0.05, -0.4, -0.3, C.gear, 0, 0.6, 0, 0),
      cyl(0.36, 0.36, 0.26, 16, sx * 0.33, -1.38, 0, C.tire, 0, 0, 0, Math.PI / 2), cyl(0.18, 0.18, 0.27, 12, sx * 0.33, -1.38, 0, C.gear, 0, 0, 0, Math.PI / 2)];
    const m = new THREE.Mesh(merge(parts), mats.dark); m.castShadow = true; g.add(m);
    root.add(g); gear[sx < 0 ? 'mainL' : 'mainR'] = g;
  }
  // --- tailhook ---
  const hook = new THREE.Group(); hook.position.copy(JET_GEOM.hookPivot);
  const hm = new THREE.Mesh(merge([box(0.09, 0.09, JET_GEOM.hookLen, 0, 0, JET_GEOM.hookLen / 2, C.gear), box(0.12, 0.16, 0.22, 0, -0.06, JET_GEOM.hookLen, C.black)]), mats.dark);
  hm.castShadow = true; hook.add(hm); root.add(hook);
  // hook stripes
  // --- stations: pylons ---
  for (const st of STATIONS) {
    if (st.rail === 'pylon') P.add('paint', box(0.12, 0.42, 1.6, st.pos[0], st.pos[1] + 0.38, st.pos[2] - 0.1, C.bot));
    if (st.rail === 'center') P.add('paint', box(0.14, 0.2, 1.4, st.pos[0], st.pos[1] + 0.18, st.pos[2], C.bot));
  }
  // targeting pod on left cheek
  const tgpParts = [cylZ(0.17, 0.17, 2.0, 14, JET_GEOM.tgp.x, JET_GEOM.tgp.y, JET_GEOM.tgp.z + 0.3, C.bot), sphere(0.18, 12, 10, JET_GEOM.tgp.x, JET_GEOM.tgp.y, JET_GEOM.tgp.z - 0.75, C.dark),
    box(0.1, 0.18, 1.2, JET_GEOM.tgp.x, JET_GEOM.tgp.y + 0.2, JET_GEOM.tgp.z + 0.3, C.bot)];
  for (const g of tgpParts) P.add('paint', g);

  const built = meshes(P.p, mats, root);
  if (built.light) built.light.castShadow = false;

  // --- cockpit interior (only shown in cockpit view) ---
  const cockpit = buildCockpit(mats);
  cockpit.visible = false;
  root.add(cockpit.group);

  // --- afterburner flame anchors (flames themselves are FX) ---
  const flameAnchors = [JET_GEOM.nozzleL.clone(), JET_GEOM.nozzleR.clone()];

  const stores = {};
  return {
    root, mats, pivots, gear, hook, nozzles, cockpit, flameAnchors, stores,
    info: { length: 18.3, span: 13.6, radius: 10, hitSpheres: [{ c: new THREE.Vector3(0, 0, -3), r: 3 }, { c: new THREE.Vector3(0, 0, 3), r: 3.5 }, { c: new THREE.Vector3(-4, 0, 1.5), r: 2 }, { c: new THREE.Vector3(4, 0, 1.5), r: 2 }] },
  };
}

function buildCockpit(mats) {
  const group = new THREE.Group(); group.name = 'cockpit';
  const P = new Parts();
  const panel = col('#1b1d20'), console = col('#25282c'), frame = col('#303438'), black = col('#08090a');
  // instrument panel + glare shield (kept low enough that the pilot sees ~12° below the boresight, as in the real jet)
  P.add('dark', box(1.0, 0.44, 0.12, 0, 0.49, -5.98, panel, 0, -0.35, 0, 0));
  P.add('dark', box(1.06, 0.06, 0.42, 0, 0.75, -5.95, black, 0, 0.1, 0, 0));
  P.add('dark', box(0.9, 0.3, 0.6, 0, 0.29, -5.75, panel));
  // side consoles and cockpit walls
  for (const sx of [-1, 1]) {
    P.add('dark', box(0.2, 0.08, 1.5, sx * 0.42, 0.42, -4.6, console));
    P.add('dark', box(0.05, 0.42, 2.4, sx * 0.53, 0.42, -4.7, frame));
    // canopy rail
    P.add('dark', box(0.06, 0.06, 3.3, sx * 0.51, 0.66, -4.75, frame));
  }
  // stick & throttle
  P.add('dark', cyl(0.018, 0.022, 0.5, 6, 0, 0.32, -5.15, black, 0, 0.25, 0, 0));
  P.add('dark', box(0.05, 0.08, 0.05, 0, 0.56, -5.22, black));
  P.add('dark', box(0.05, 0.1, 0.16, -0.38, 0.55, -4.75, black));
  // HUD frame
  P.add('dark', box(0.04, 0.15, 0.04, -0.19, 0.85, -5.99, black)); P.add('dark', box(0.04, 0.15, 0.04, 0.19, 0.85, -5.99, black));
  // canopy bow (windscreen frame, seen from inside)
  P.add('dark', xform(prep(new THREE.TorusGeometry(0.56, 0.03, 6, 24, Math.PI), frame), 0, 0.66, -5.74));
  meshes(P.p, mats, group, { cast: false });
  // HUD combiner glass
  const hudGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.33), new THREE.MeshStandardMaterial({ color: 0x88ffaa, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.0, depthWrite: false }));
  hudGlass.position.set(0, 0.97, -5.965); hudGlass.rotation.x = -0.22; group.add(hudGlass);
  // MFD screens
  const mfdGeo = new THREE.PlaneGeometry(0.2, 0.2);
  const mfdL = new THREE.Mesh(mfdGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const mfdR = new THREE.Mesh(mfdGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  mfdL.position.set(-0.25, 0.48, -5.905); mfdR.position.set(0.25, 0.48, -5.905);
  mfdL.rotation.x = mfdR.rotation.x = -0.35;
  group.add(mfdL, mfdR);
  const mfdC = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.13), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  mfdC.position.set(0, 0.35, -5.86); mfdC.rotation.x = -0.6; group.add(mfdC);
  return { group, mfdL, mfdR, mfdC, hudGlass, hudCorners: [new THREE.Vector3(-0.17, 1.135, -6.0), new THREE.Vector3(0.17, 1.135, -6.0), new THREE.Vector3(0.17, 0.81, -5.93), new THREE.Vector3(-0.17, 0.81, -5.93)] };
}

// Static merged parked jet for carrier deck dressing (2-3 draw calls)
export function buildParkedJet() {
  const f = buildFighter({ lowDetail: true });
  f.root.updateMatrixWorld(true);
  const byMat = new Map();
  f.root.traverse((o) => {
    if (!o.isMesh || o.material === f.mats.glass || !o.visible) return;
    if (o.parent && o.parent.name === 'cockpit') return;
    let p = o.parent, inCockpit = false; while (p) { if (p.name === 'cockpit') inCockpit = true; p = p.parent; }
    if (inCockpit || !o.geometry.attributes.heat) return;
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    const key = o.material === f.mats.paint ? 'paint' : 'dark';
    if (!byMat.has(key)) byMat.set(key, []); byMat.get(key).push(g);
  });
  const root = new THREE.Group();
  const mats = jetMaterials();
  for (const [k, list] of byMat) { const m = new THREE.Mesh(merge(list), mats[k]); m.castShadow = true; m.receiveShadow = true; root.add(m); }
  // canopy
  const cg = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2); cg.scale(0.52, 0.5, 1.7); cg.translate(0, 0.62, -4.75);
  root.add(new THREE.Mesh(cg, mats.glass));
  return root;
}
