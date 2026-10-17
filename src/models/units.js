// Enemy & theater units (procedural): Flanker-style fighter, S-400-style SAM battery, armor, trucks,
// SPAAG, airbase/city structures and trees. Faces -Z; vehicles origin at ground contact.
import * as THREE from 'three';
import { Parts, meshes, loft, wing, box, cyl, cylZ, sphere, cone, xform, prep, merge, col, canvasTex, slab } from './kit.js';

let _camo = null;
function camoTex(colors) {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = colors[1 + (i % (colors.length - 1))];
      ctx.beginPath(); const x = Math.random() * w, y = Math.random() * h;
      ctx.moveTo(x, y); for (let k = 0; k < 5; k++) ctx.lineTo(x + (Math.random() - 0.5) * 260, y + (Math.random() - 0.5) * 160);
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(30,30,40,0.35)'; ctx.lineWidth = 1.2;
    for (let r = 0; r < 12; r++) { ctx.beginPath(); ctx.moveTo(0, r * h / 12); ctx.lineTo(w, r * h / 12); ctx.stroke(); }
    for (let i = 0; i < 80; i++) { const x = Math.random() * w, y = Math.random() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h / 12); ctx.stroke(); }
  });
}

const U = {
  belly: col('#b7c3cc'), dark: col('#26282b'), black: col('#111214'), glass: col('#24343f'), nozzle: col('#4b4038'),
  olive: col('#4d5235'), tan: col('#8e7c56'), green: col('#3c4a2c'), steel: col('#5c6064'), rubber: col('#1a1a1a'), red: col('#9b2a22'),
  concrete: col('#9a958a'), conc2: col('#7f7b72'), white: col('#d8d8d2'), rust: col('#7a4a32'), roof: col('#5a5d60'),
};

export function buildEnemyFighter(variant = 'fighter') {
  const tex = variant === 'striker' ? camoTex(['#8a7d5c', '#6b5e40', '#9c9070', '#5b5a44']) : camoTex(['#8fa6b8', '#5f7f9e', '#a9b8c2', '#6d8aa6']);
  const mats = {
    paint: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, vertexColors: true, roughness: 0.6, metalness: 0.25 }),
    dark: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x8090a0, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.4, depthWrite: false }),
  };
  const W = [1, 1, 1];
  const root = new THREE.Group(); root.name = 'flanker';
  const P = new Parts();
  // forward fuselage
  P.add('paint', loft([
    { z: -11.2, w: 0.05, h: 0.05, y: 0.25 }, { z: -10.6, w: 0.5, h: 0.5, y: 0.22 }, { z: -9.6, w: 0.95, h: 0.92, y: 0.2 },
    { z: -8.2, w: 1.3, h: 1.2, y: 0.22 }, { z: -6.6, w: 1.45, h: 1.35, y: 0.28, wb: 0.85 }, { z: -5.0, w: 1.7, h: 1.4, y: 0.25, n: 2.4 },
    { z: -3.4, w: 2.6, h: 1.25, y: 0.2, n: 2.8 }, { z: -1.5, w: 3.6, h: 1.0, y: 0.25, n: 3.4 }, { z: 1.0, w: 4.2, h: 0.85, y: 0.3, n: 3.6 },
    { z: 3.5, w: 3.9, h: 0.75, y: 0.32, n: 3.6 }, { z: 6.0, w: 2.2, h: 0.6, y: 0.3, n: 3 }, { z: 8.5, w: 1.0, h: 0.5, y: 0.35, n: 2.6 },
    { z: 10.6, w: 0.5, h: 0.4, y: 0.4 },
  ], 24, W));
  // engine nacelles (widely spaced) + intakes
  for (const sx of [-1, 1]) {
    P.add('paint', loft([
      { z: -3.6, w: 1.25, h: 1.25, y: -0.55, x: sx * 1.45, n: 3.5 }, { z: -1.0, w: 1.35, h: 1.35, y: -0.5, x: sx * 1.5, n: 3 },
      { z: 3.0, w: 1.35, h: 1.3, y: -0.4, x: sx * 1.5, n: 2.4 }, { z: 7.0, w: 1.2, h: 1.15, y: -0.3, x: sx * 1.45, n: 2.2 },
      { z: 9.3, w: 1.05, h: 1.05, y: -0.25, x: sx * 1.4 },
    ], 16, W));
    P.add('dark', box(1.15, 1.1, 0.05, sx * 1.45, -0.55, -3.58, U.black));
    // ventral fins
    P.add('paint', wing({ le: [sx * 1.6, -1.05, 5.5], chord: 1.6, tc: 0.04 }, { le: [sx * 1.75, -1.9, 6.4], chord: 0.7, tc: 0.04 }, W, 0, { up: [1, 0, 0], n: 5 }));
  }
  // LERX + wings
  for (const sx of [-1, 1]) {
    const pts = [[0.55, -7.8], [1.2, -5.0], [2.1, -2.6], [2.3, -1.4], [1.0, -1.4]].map(([x, z]) => [x * sx, z]);
    if (sx < 0) pts.reverse();
    P.add('paint', slab(pts, 0.2, 0.08, W));
    P.add('paint', wing({ le: [sx * 2.1, 0.22, -1.5], chord: 5.6, tc: 0.05 }, { le: [sx * 7.3, 0.05, 3.25], chord: 1.55, tc: 0.04 }, W, 0, { n: 8 }));
    P.add('paint', box(0.12, 0.12, 2.8, sx * 7.38, 0.0, 4.0, W));
  }
  // vertical fins
  for (const sx of [-1, 1]) {
    P.add('paint', wing({ le: [sx * 2.2, 0.35, 4.3], chord: 3.7, tc: 0.045 }, { le: [sx * 2.2, 3.75, 7.0], chord: 1.4, tc: 0.04 }, W, 0, { up: [1, 0, 0], n: 7 }));
  }
  // canopy, IRST, nose details
  const cg = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2); cg.scale(0.55, 0.62, 1.75); cg.translate(0, 0.78, -6.1);
  const canopy = new THREE.Mesh(cg, mats.glass); root.add(canopy);
  P.add('dark', sphere(0.17, 8, 6, 0.25, 0.92, -8.0, U.glass));
  P.add('dark', cylZ(0.04, 0.05, 1.2, 6, 0, 0.3, -11.6, U.black));
  // nozzles
  const nozzles = [];
  for (const sx of [-1, 1]) {
    P.add('dark', cyl(0.5, 0.56, 1.0, 16, sx * 1.4, -0.25, 9.8, U.nozzle, 0.6, Math.PI / 2, 0, 0, true));
    P.add('dark', cyl(0.38, 0.38, 0.1, 12, sx * 1.4, -0.25, 9.6, U.black, 1.0, Math.PI / 2));
    const n = new THREE.Object3D(); n.position.set(sx * 1.4, -0.25, 10.3); root.add(n); nozzles.push(n);
  }
  meshes(P.p, mats, root);
  // stabilators (moving)
  const pivots = {};
  for (const sx of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(sx * 2.4, -0.2, 7.8);
    const m = new THREE.Mesh(merge([wing({ le: [0, 0, -1.3], chord: 3.1, tc: 0.04 }, { le: [sx * 2.7, -0.1, 0.5], chord: 1.1, tc: 0.035 }, W, 0, { n: 6 })]), mats.paint);
    m.castShadow = true; g.add(m); root.add(g); pivots[sx < 0 ? 'stabL' : 'stabR'] = g;
  }
  const pylons = [];
  for (const [x, z] of [[-6.6, 2.6], [6.6, 2.6], [-5.2, 1.4], [5.2, 1.4], [-3.6, 0.6], [3.6, 0.6], [-1.45, 1.5], [1.45, 1.5]]) pylons.push(new THREE.Vector3(x, Math.abs(x) > 6 ? -0.05 : -0.45, z));
  return {
    root, mats, nozzles, pivots,
    info: {
      length: 21.9, span: 14.7, radius: 11, pylons, wingtipL: new THREE.Vector3(-7.38, 0, 4.0), wingtipR: new THREE.Vector3(7.38, 0, 4.0),
      hitSpheres: [{ c: new THREE.Vector3(0, 0, -5), r: 2.5 }, { c: new THREE.Vector3(0, 0, 1), r: 3.2 }, { c: new THREE.Vector3(0, 0, 7), r: 2.8 }, { c: new THREE.Vector3(-5, 0, 2.5), r: 2.2 }, { c: new THREE.Vector3(5, 0, 2.5), r: 2.2 }],
    },
  };
}

function vehicleMats(base) {
  return {
    paint: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0.15 }),
    dark: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.75, metalness: 0.3, side: THREE.DoubleSide }),
  };
}

function tracks(P, len, width, h, wheels, color) {
  for (const sx of [-1, 1]) {
    const x = sx * (width / 2 - 0.3);
    P.add('dark', box(0.6, h, len, x, h / 2, 0, U.rubber));
    for (let i = 0; i < wheels; i++) {
      const z = -len / 2 + 0.6 + i * (len - 1.2) / (wheels - 1);
      P.add('dark', cyl(0.36, 0.36, 0.62, 10, x, 0.38, z, U.steel, 0, 0, 0, Math.PI / 2));
    }
    P.add('paint', box(0.65, 0.08, len + 0.2, x, h + 0.08, 0, color));
  }
}

export function buildMBT(team = 'red') {
  const mats = vehicleMats();
  const root = new THREE.Group(); const P = new Parts();
  const c1 = team === 'red' ? U.olive : U.tan, c2 = team === 'red' ? col('#5e5a3a') : col('#a08c62');
  const L = team === 'red' ? 6.9 : 7.9, Wd = 3.7;
  tracks(P, L, Wd, 0.85, team === 'red' ? 6 : 7, c2);
  P.add('paint', loft([{ z: -L / 2, w: 2.6, h: 0.4, y: 1.0, n: 4 }, { z: -L / 2 + 0.6, w: 2.9, h: 1.0, y: 1.25, n: 5 }, { z: L / 2, w: 2.9, h: 1.0, y: 1.3, n: 5 }], 12, c1, 0, { capStart: true, capEnd: true }));
  // engine deck & exhaust (weak spot, hot)
  P.add('dark', box(2.2, 0.06, 1.6, 0, 1.82, L / 2 - 1.0, U.dark, 0.7));
  P.add('dark', box(1.2, 0.3, 0.12, team === 'red' ? -0.9 : 0, team === 'red' ? 1.5 : 1.65, L / 2 + 0.02, U.black, 1.0));
  if (team === 'red') { P.add('paint', cylZ(0.3, 0.3, 1.0, 10, -0.8, 1.9, L / 2 + 0.05, c2)); P.add('paint', cylZ(0.3, 0.3, 1.0, 10, 0.8, 1.9, L / 2 + 0.05, c2)); }
  meshes(P.p, mats, root);
  const turret = new THREE.Group(); turret.position.set(0, 1.8, team === 'red' ? -0.3 : 0.4);
  const T = new Parts();
  if (team === 'red') {
    T.add('paint', sphere(1.55, 16, 8, 0, 0.0, 0, c1, 0, 1.05, 0.38, 1.2));
    for (const sx of [-1, 1]) T.add('paint', box(0.9, 0.35, 1.0, sx * 0.85, 0.32, -1.05, c2, 0, 0, sx * 0.4, 0));
  } else {
    T.add('paint', loft([{ z: -2.2, w: 2.4, h: 0.9, y: 0.45, n: 4, wt: 0.85 }, { z: 0.5, w: 3.5, h: 0.95, y: 0.45, n: 5 }, { z: 2.6, w: 3.3, h: 0.9, y: 0.45, n: 5 }], 10, c1, 0, { capStart: true, capEnd: true }));
  }
  T.add('dark', cyl(0.35, 0.35, 0.3, 8, 0.6, 0.85, 0.4, U.dark));
  meshes(T.p, mats, turret);
  const gun = new THREE.Group(); gun.position.set(0, 0.4, -1.4);
  const G = new Parts(); G.add('paint', cylZ(0.09, 0.12, 5.4, 8, 0, 0, -2.7, c2, 0.15)); G.add('paint', box(0.6, 0.5, 0.7, 0, 0, 0.1, c1));
  meshes(G.p, mats, gun);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -5.45); gun.add(muzzle);
  turret.add(gun); root.add(turret);
  return { root, mats, nodes: { turret, gun, muzzle }, info: { length: L, width: Wd, height: 2.4, radius: 4.5, engineDeck: new THREE.Vector3(0, 1.8, L / 2 - 1.0), hitSpheres: [{ c: new THREE.Vector3(0, 1.3, 0), r: 3.2 }] } };
}

export function buildAPC(team = 'red') {
  const mats = vehicleMats(); const root = new THREE.Group(); const P = new Parts();
  const c1 = team === 'red' ? U.olive : U.tan, c2 = team === 'red' ? col('#5e5a3a') : col('#a08c62');
  const L = 6.7, Wd = 3.15;
  tracks(P, L, Wd, 0.7, 6, c2);
  P.add('paint', loft([{ z: -L / 2, w: 2.4, h: 0.3, y: 0.95, n: 4 }, { z: -L / 2 + 1.4, w: 2.8, h: 1.1, y: 1.25, n: 5, wt: 0.85 }, { z: L / 2, w: 2.8, h: 1.2, y: 1.3, n: 5, wt: 0.85 }], 12, c1, 0, { capStart: true, capEnd: true }));
  P.add('dark', box(0.5, 0.25, 0.4, 1.1, 1.6, -L / 2 + 1.0, U.black, 1.0));
  meshes(P.p, mats, root);
  const turret = new THREE.Group(); turret.position.set(0, 1.92, -0.2);
  const T = new Parts(); T.add('paint', cyl(0.75, 0.95, 0.5, 10, 0, 0.25, 0, c1)); meshes(T.p, mats, turret);
  const gun = new THREE.Group(); gun.position.set(0, 0.3, -0.5);
  const G = new Parts(); G.add('dark', cylZ(0.05, 0.06, 2.3, 6, 0, 0, -1.15, U.dark, 0.1)); meshes(G.p, mats, gun);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -2.35); gun.add(muzzle);
  turret.add(gun); root.add(turret);
  return { root, mats, nodes: { turret, gun, muzzle }, info: { length: L, width: Wd, height: 2.3, radius: 4, door: new THREE.Vector3(0, 1.0, L / 2), hitSpheres: [{ c: new THREE.Vector3(0, 1.2, 0), r: 3 }] } };
}

export function buildSPAAG() {
  const mats = vehicleMats(); const root = new THREE.Group(); const P = new Parts();
  const c1 = U.olive, c2 = col('#5e5a3a');
  tracks(P, 6.5, 3.1, 0.7, 6, c2);
  P.add('paint', loft([{ z: -3.25, w: 2.6, h: 0.9, y: 1.15, n: 5 }, { z: 3.25, w: 2.8, h: 1.0, y: 1.2, n: 5 }], 10, c1, 0, { capStart: true, capEnd: true }));
  P.add('dark', box(0.8, 0.2, 0.3, 0.8, 1.5, 3.2, U.black, 1.0));
  meshes(P.p, mats, root);
  const turret = new THREE.Group(); turret.position.set(0, 1.7, 0.2);
  const T = new Parts(); T.add('paint', loft([{ z: -1.6, w: 2.8, h: 1.0, y: 0.5, n: 4, wt: 0.8 }, { z: 1.6, w: 2.9, h: 1.1, y: 0.55, n: 4, wt: 0.85 }], 10, c1, 0, { capStart: true, capEnd: true }));
  T.add('paint', box(0.2, 1.1, 0.2, 0, 1.4, 1.2, c2));
  meshes(T.p, mats, turret);
  const radar = new THREE.Group(); radar.position.set(0, 2.0, 1.2);
  const R = new Parts(); R.add('dark', xform(prep(new THREE.CylinderGeometry(0.75, 0.55, 0.25, 14, 1, true), U.steel), 0, 0, -0.1, Math.PI / 2 - 0.2, 0, 0)); meshes(R.p, mats, radar); turret.add(radar);
  const gun = new THREE.Group(); gun.position.set(0, 0.7, -1.2);
  const G = new Parts(); const muzzles = [];
  for (const [x, y] of [[-0.95, 0.12], [-0.75, -0.12], [0.75, 0.12], [0.95, -0.12]]) { G.add('dark', cylZ(0.04, 0.05, 2.2, 6, x, y, -1.1, U.dark, 0.1)); const m = new THREE.Object3D(); m.position.set(x, y, -2.25); gun.add(m); muzzles.push(m); }
  meshes(G.p, mats, gun); turret.add(gun); root.add(turret);
  return { root, mats, nodes: { turret, gun, muzzles, radar }, info: { length: 6.5, width: 3.1, height: 3, radius: 4, hitSpheres: [{ c: new THREE.Vector3(0, 1.4, 0), r: 3 }] } };
}

export function buildSAMLauncher() {
  const mats = vehicleMats(); const root = new THREE.Group(); const P = new Parts();
  const c1 = col('#56603e'), c2 = col('#454c33');
  // 8x8 chassis
  P.add('paint', box(3.0, 1.1, 12.5, 0, 1.55, 0.5, c1));
  P.add('paint', loft([{ z: -6.6, w: 2.9, h: 2.0, y: 2.1, n: 5, wt: 0.85 }, { z: -4.3, w: 3.0, h: 2.2, y: 2.2, n: 5 }], 8, c1, 0, { capStart: true, capEnd: true }));
  P.add('dark', box(2.6, 0.7, 0.1, 0, 2.6, -6.62, U.glass));
  for (const z of [-4.8, -3.2, 2.0, 3.6]) for (const sx of [-1, 1]) P.add('dark', cyl(0.62, 0.62, 0.5, 12, sx * 1.35, 0.62, z, U.rubber, 0, 0, 0, Math.PI / 2));
  P.add('dark', box(0.4, 0.3, 0.3, 1.3, 2.3, -4.0, U.black, 1.0));
  meshes(P.p, mats, root);
  // erector at rear: canisters lie along the bed with mouths to the rear (+Z)
  const erector = new THREE.Group(); erector.position.set(0, 2.25, 6.6);
  const E = new Parts(); const tubes = [];
  for (const [x, y] of [[-0.62, 0.5], [0.62, 0.5], [-0.62, 1.5], [0.62, 1.5]]) {
    E.add('paint', cylZ(0.47, 0.47, 10.4, 14, x, y, -5.2, c2)); E.add('dark', cylZ(0.42, 0.42, 0.05, 12, x, y, 0.02, U.black));
    tubes.push(new THREE.Vector3(x, y, 0.4));
  }
  E.add('paint', box(2.4, 0.3, 10, 0, 0.0, -5, c1));
  meshes(E.p, mats, erector); root.add(erector);
  return { root, mats, nodes: { erector }, info: { length: 13, width: 3, height: 4, radius: 7.5, erectAngle: -Math.PI / 2, tubes, hitSpheres: [{ c: new THREE.Vector3(0, 2, -2), r: 4 }, { c: new THREE.Vector3(0, 2, 4), r: 4 }] } };
}

export function buildSAMRadar(kind = 'search') {
  const mats = vehicleMats(); const root = new THREE.Group(); const P = new Parts();
  const c1 = col('#56603e');
  P.add('paint', box(2.8, 1.2, 9, 0, 1.6, 0, c1)); P.add('paint', box(2.7, 2.0, 2.2, 0, 2.6, -3.6, c1));
  for (const z of [-3.4, -1.8, 2.0, 3.4]) for (const sx of [-1, 1]) P.add('dark', cyl(0.6, 0.6, 0.5, 10, sx * 1.3, 0.6, z, U.rubber, 0, 0, 0, Math.PI / 2));
  P.add('paint', cyl(0.35, 0.45, kind === 'search' ? 6 : 3.5, 8, 0, kind === 'search' ? 5.2 : 3.9, 1.5, c1));
  meshes(P.p, mats, root);
  const antenna = new THREE.Group(); antenna.position.set(0, kind === 'search' ? 8.3 : 5.8, 1.5);
  const A = new Parts();
  if (kind === 'search') {
    A.add('dark', box(8.5, 3.2, 0.3, 0, 1.4, 0, U.steel, 0, -0.3)); for (let i = 0; i < 9; i++) A.add('dark', box(0.08, 3.2, 0.5, -4 + i, 1.4, 0.15, U.dark, 0, -0.3));
  } else {
    A.add('paint', box(3.4, 3.4, 0.5, 0, 1.6, 0, c1, 0, -0.35)); A.add('dark', box(2.9, 2.9, 0.1, 0, 1.6, -0.27, U.dark, 0, -0.35));
  }
  meshes(A.p, mats, antenna); root.add(antenna);
  return { root, mats, nodes: { antenna }, info: { length: 9, width: 2.8, height: 10, radius: 6, emitter: antenna.position.clone().add(new THREE.Vector3(0, 1.5, 0)), hitSpheres: [{ c: new THREE.Vector3(0, 2.5, 0), r: 4.5 }] } };
}

export function buildTruck(kind = 'cargo') {
  const mats = vehicleMats(); const root = new THREE.Group(); const P = new Parts(); const c1 = col('#56603e');
  P.add('paint', box(2.5, 1.0, 7.5, 0, 1.4, 0, c1)); P.add('paint', box(2.4, 1.6, 1.9, 0, 2.3, -2.8, c1));
  P.add('dark', box(2.2, 0.6, 0.1, 0, 2.6, -3.76, U.glass));
  if (kind === 'fuel') P.add('paint', cylZ(1.05, 1.05, 5.0, 14, 0, 2.6, 0.9, col('#6b6f5a')));
  else P.add('paint', loft([{ z: -1.6, w: 2.5, h: 2.0, y: 2.8, n: 3, wt: 0.9 }, { z: 3.7, w: 2.5, h: 2.0, y: 2.8, n: 3, wt: 0.9 }], 10, col('#5d6447'), 0, { capStart: true, capEnd: true }));
  for (const z of [-2.8, 1.2, 2.6]) for (const sx of [-1, 1]) P.add('dark', cyl(0.55, 0.55, 0.4, 10, sx * 1.15, 0.55, z, U.rubber, 0, 0, 0, Math.PI / 2));
  P.add('dark', box(0.15, 1.0, 0.15, 1.3, 2.8, -1.9, U.black, 1.0));
  meshes(P.p, mats, root);
  return { root, mats, nodes: {}, info: { length: 7.5, width: 2.5, height: 3.6, radius: 4.5, hitSpheres: [{ c: new THREE.Vector3(0, 1.8, 0), r: 3.5 }] } };
}

// Navy helicopter (Seahawk style). Origin at the wheels; nodes.rotor spins about Y, nodes.tail about X.
export function buildHelo() {
  const mats = { ...vehicleMats(), glass: new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.1, metalness: 0.6 }) };
  const root = new THREE.Group(); root.name = 'helo'; const P = new Parts();
  const gray = col('#7b8188'), dark = col('#3b4045'), W = [1, 1, 1];
  P.add('paint', loft([
    { z: -7.4, w: 0.9, h: 0.9, y: 1.75, n: 2.4 }, { z: -6.6, w: 2.0, h: 1.9, y: 1.95, n: 2.6 }, { z: -5.2, w: 2.4, h: 2.4, y: 2.15, n: 3 },
    { z: -1.5, w: 2.5, h: 2.6, y: 2.25, n: 3.6 }, { z: 1.4, w: 2.3, h: 2.3, y: 2.4, n: 3.4 }, { z: 3.0, w: 1.2, h: 1.2, y: 3.0, n: 2.4 },
  ], 16, gray, 0, { capStart: true, capEnd: true }));
  P.add('paint', cylZ(0.28, 0.6, 7.2, 10, 0, 3.05, 6.5, gray));                          // tail boom
  P.add('paint', box(0.22, 2.6, 1.3, 0, 4.3, 10.0, gray, 0, 0.3, 0, 0));                   // tail pylon
  P.add('paint', box(3.4, 0.1, 0.8, 0, 3.15, 9.6, gray));                                  // stabilator
  for (const x of [-0.62, 0.62]) P.add('paint', cylZ(0.42, 0.46, 2.8, 10, x, 3.7, 0.4, gray, 0.6)); // engines
  P.add('dark', cyl(0.22, 0.3, 0.9, 8, 0, 4.15, -1.0, dark));                               // rotor mast
  P.add('glass', box(1.5, 1.0, 0.06, 0, 2.85, -6.35, W, 0, 1.08, 0, 0));
  for (const sx of [-1, 1]) P.add('glass', box(0.06, 0.7, 1.3, sx * 1.22, 2.5, -5.2, W));
  for (const sx of [-1, 1]) { P.add('dark', box(0.12, 0.9, 0.12, sx * 1.35, 0.8, -4.0, dark)); P.add('dark', cyl(0.38, 0.38, 0.25, 12, sx * 1.42, 0.38, -4.0, U.rubber, 0, 0, 0, Math.PI / 2)); }
  P.add('dark', box(0.1, 2.2, 0.1, 0, 1.4, 4.0, dark)); P.add('dark', cyl(0.25, 0.25, 0.18, 10, 0, 0.25, 4.0, U.rubber, 0, 0, 0, Math.PI / 2));
  meshes(P.p, mats, root);
  const rotor = new THREE.Group(); rotor.position.set(0, 4.65, -1.0); const rp = new Parts();
  rp.add('dark', cyl(0.42, 0.42, 0.35, 10, 0, 0, 0, dark));
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; rp.add('dark', box(7.8, 0.07, 0.53, 4.3 * Math.cos(a), 0, -4.3 * Math.sin(a), dark, 0, 0, a, 0)); }
  meshes(rp.p, mats, rotor); root.add(rotor);
  const tail = new THREE.Group(); tail.position.set(0.32, 4.9, 10.3); const tp = new Parts();
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; tp.add('dark', box(0.05, 1.6, 0.2, 0, 0.85 * Math.cos(a), 0.85 * Math.sin(a), dark, 0, a, 0, 0)); }
  meshes(tp.p, mats, tail); root.add(tail);
  return { root, mats, nodes: { rotor, tail }, info: { length: 19.8, width: 3.4, height: 5.2, radius: 9, hitSpheres: [{ c: new THREE.Vector3(0, 2.3, -3), r: 2.8 }, { c: new THREE.Vector3(0, 3.2, 5), r: 1.8 }] } };
}

// ---------------- instancing structures ----------------
function windowTextures(seed) {
  const map = canvasTex(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#b8b2a6'; ctx.fillRect(0, 0, w, h);
    for (let y = 8; y < h; y += 32) for (let x = 6; x < w; x += 24) { ctx.fillStyle = Math.random() < 0.5 ? '#2a3038' : '#3a4048'; ctx.fillRect(x, y, 14, 20); }
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < h; y += 32) ctx.fillRect(0, y, w, 3);
  });
  const emis = canvasTex(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    for (let y = 8; y < h; y += 32) for (let x = 6; x < w; x += 24) if (Math.random() < 0.33) { ctx.fillStyle = Math.random() < 0.7 ? '#ffcc88' : '#cfe6ff'; ctx.fillRect(x, y, 14, 20); }
  });
  void seed;
  return { map, emis };
}

// curtain-wall glass for downtown towers: tinted panes, mullions, floor bands; random lit offices at night
function glassTextures() {
  const map = canvasTex(256, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#5f7488'); g.addColorStop(0.5, '#3d5163'); g.addColorStop(1, '#6d8396');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) { ctx.fillStyle = 'rgba(210,220,228,0.55)'; ctx.fillRect(0, y, w, 4); }
    for (let x = 0; x < w; x += 16) { ctx.fillStyle = 'rgba(30,38,46,0.6)'; ctx.fillRect(x, 0, 2, h); }
    for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(${150 + Math.random() * 60},${170 + Math.random() * 50},${190 + Math.random() * 50},${0.08 + Math.random() * 0.12})`; ctx.fillRect(Math.floor(Math.random() * 16) * 16 + 2, Math.floor(Math.random() * 16) * 32 + 4, 14, 28); }
  });
  const emis = canvasTex(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 32) for (let x = 2; x < w; x += 16) if (Math.random() < 0.38) { ctx.fillStyle = Math.random() < 0.6 ? '#fff1d6' : '#d8ecff'; ctx.fillRect(x, y, 14, 26); }
  });
  return { map, emis };
}

let _bTex = null, _gTex = null;
export function buildBuildingGeometry(kind) {
  if (!_bTex) _bTex = windowTextures(1);
  if (!_gTex) _gTex = glassTextures();
  const glassMat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: _gTex.map, emissiveMap: _gTex.emis, emissive: 0x000000, roughness: 0.25, metalness: 0.55 });
  const plain = () => new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0.05 });
  let parts = [], mat;
  const uvBox = (w, h, d, x, y, z, color, heat = 0, uScale = 1, vScale = 1) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv; const n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const ny = Math.abs(n.getY(i)); const horiz = Math.abs(n.getX(i)) > 0.5 ? d : w;
      if (ny > 0.5) uv.setXY(i, 0.0, 0.0); else uv.setXY(i, uv.getX(i) * horiz / 24 * uScale, uv.getY(i) * h / 36 * vScale);
    }
    return xform(prep(g, color, heat), x, y, z);
  };
  switch (kind) {
    case 'apartment': parts = [uvBox(24, 30, 12, 0, 15, 0, [1, 1, 1]), box(24.4, 0.6, 12.4, 0, 30.3, 0, U.roof)]; mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: _bTex.map, emissiveMap: _bTex.emis, emissive: 0x000000, roughness: 0.85 }); break;
    case 'office': parts = [uvBox(20, 45, 20, 0, 22.5, 0, [0.85, 0.9, 1.0]), box(14, 3, 14, 0, 46.5, 0, U.roof)]; mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: _bTex.map, emissiveMap: _bTex.emis, emissive: 0x000000, roughness: 0.6, metalness: 0.2 }); break;
    case 'house': {
      parts = [box(10, 4.5, 8, 0, 2.25, 0, col('#c9b89a'))];
      const roof = new THREE.CylinderGeometry(0.01, 6.6, 3, 4, 1); roof.rotateY(Math.PI / 4); roof.scale(1.15, 1, 0.9);
      parts.push(xform(prep(roof, col('#8a3b2a')), 0, 6.0, 0));
      mat = plain(); break;
    }
    case 'industrial': {
      parts = [box(40, 10, 25, 0, 5, 0, col('#8d8f8a'))];
      for (let i = 0; i < 5; i++) parts.push(xform(prep(new THREE.BoxGeometry(8, 0.4, 25), col('#6f7276'), 0.3), -16 + i * 8, 11.6, 0, 0, 0, 0.45));
      mat = plain(); break;
    }
    case 'warehouse': parts = [box(50, 10, 30, 0, 5, 0, col('#9e9a8e')), box(50.5, 0.5, 30.5, 0, 10.2, 0, col('#5e6266'), 0.2)]; mat = plain(); break;
    case 'hangar': {
      const g = new THREE.CylinderGeometry(25, 25, 60, 20, 1, false, -Math.PI / 2, Math.PI); g.rotateZ(Math.PI / 2); g.rotateY(Math.PI / 2); g.scale(1, 0.72, 1);
      parts = [xform(prep(g, col('#8a8d86')), 0, 0, 0), box(48, 16, 0.5, 0, 8, -29.8, col('#3b3e40'))]; mat = plain(); break;
    }
    case 'shelter': {
      const g = new THREE.CylinderGeometry(12, 12, 30, 16, 1, false, -Math.PI / 2, Math.PI); g.rotateZ(Math.PI / 2); g.rotateY(Math.PI / 2); g.scale(1, 0.78, 1);
      parts = [xform(prep(g, U.concrete), 0, 0, 0), box(21, 8.5, 0.6, 0, 4.25, -14.8, U.conc2)]; mat = plain(); break;
    }
    case 'tower': parts = [box(6, 20, 6, 0, 10, 0, U.concrete), box(9, 4, 9, 0, 22, 0, col('#2e3a44')), box(9.6, 0.6, 9.6, 0, 24.3, 0, U.roof)]; mat = plain(); break;
    case 'tank': parts = [cyl(10, 10, 14, 24, 0, 7, 0, U.white), cyl(10.2, 10.2, 0.6, 24, 0, 14.2, 0, col('#c8c8c0'))]; mat = plain(); break;
    case 'chimney': parts = [cyl(1.6, 2.4, 50, 12, 0, 25, 0, col('#b04030'), 0.2), cyl(1.65, 1.65, 4, 12, 0, 46, 0, U.white, 0.8)]; mat = plain(); break;
    // downtown towers
    case 'highrise1': parts = [uvBox(26, 72, 22, 0, 36, 0, [0.9, 0.94, 1.0]), box(18, 4, 14, 0, 74, 0, U.roof), box(26.4, 0.8, 22.4, 0, 72.4, 0, U.conc2)]; mat = glassMat(); break;
    case 'highrise2': parts = [uvBox(30, 104, 30, 0, 52, 0, [0.88, 0.93, 1.0]), uvBox(22, 10, 22, 0, 109, 0, [0.8, 0.84, 0.9]), cyl(0.45, 0.2, 18, 6, 0, 123, 0, U.steel)]; mat = glassMat(); break;
    case 'highrise3': parts = [uvBox(42, 62, 42, 0, 31, 0, [0.92, 0.96, 1.0]), uvBox(31, 52, 31, 0, 88, 0, [0.92, 0.96, 1.0]), uvBox(20, 34, 20, 0, 131, 0, [0.92, 0.96, 1.0]), cyl(0.6, 0.25, 28, 6, 0, 162, 0, U.steel)]; mat = glassMat(); break;
    case 'midrise': parts = [uvBox(34, 40, 26, 0, 20, 0, [0.96, 0.92, 0.86]), box(34.6, 1, 26.6, 0, 40.4, 0, U.roof), box(10, 4, 8, 6, 42.5, 4, U.conc2)]; mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: _bTex.map, emissiveMap: _bTex.emis, emissive: 0x000000, roughness: 0.8 }); break;
    // the strike target: command HQ over a hardened bunker
    case 'hq': {
      const tone = [0.98, 0.95, 0.88];
      parts = [uvBox(72, 26, 44, 0, 13, 0, tone), uvBox(44, 18, 30, -58, 9, 6, tone), uvBox(44, 18, 30, 58, 9, 6, tone),
        box(73, 1.2, 45, 0, 26.6, 0, U.roof), box(45, 0.9, 31, -58, 18.45, 6, U.roof), box(45, 0.9, 31, 58, 18.45, 6, U.roof),
        box(18, 6, 12, -10, 30, -4, U.conc2), box(8, 4, 8, 16, 29, 8, U.steel),
        box(30, 8, 22, 0, 4, 38, U.concrete), box(16, 6.2, 1.2, 0, 3.1, 49.4, U.dark), box(32, 1.4, 24, 0, 8.7, 38, U.conc2),
        cyl(0.7, 0.35, 34, 6, 22, 44, -12, U.steel), box(6, 0.4, 0.4, 22, 56, -12, U.steel), box(0.4, 0.4, 6, 22, 52, -12, U.steel)];
      mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: _bTex.map, emissiveMap: _bTex.emis, emissive: 0x000000, roughness: 0.85 }); break;
    }
    case 'compound': { // perimeter wall + guard posts around the HQ
      const wc = col('#8f897d');
      parts = [box(240, 4, 1.2, 0, 2, -95, wc), box(240, 4, 1.2, 0, 2, 95, wc), box(1.2, 4, 190, -120, 2, 0, wc), box(1.2, 4, 190, 120, 2, 0, wc)];
      for (const [x, z] of [[-120, -95], [120, -95], [-120, 95], [120, 95]]) parts.push(box(5, 9, 5, x, 4.5, z, U.conc2), box(6, 0.6, 6, x, 9.3, z, U.roof));
      mat = plain(); break;
    }
    case 'rubble': {
      let sd = 7; const rr = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
      parts = [];
      for (let i = 0; i < 34; i++) { const w = 6 + rr() * 16, h = 1.5 + rr() * 6, d = 5 + rr() * 14; parts.push(xform(prep(new THREE.BoxGeometry(w, h, d), col(rr() < 0.5 ? '#3d3a37' : '#55504a'), 0.15), (rr() - 0.5) * 150, h * 0.35, (rr() - 0.5) * 70, (rr() - 0.5) * 0.6, rr() * 3, (rr() - 0.5) * 0.6)); }
      for (let i = 0; i < 6; i++) { const h = 6 + rr() * 12; parts.push(xform(prep(new THREE.BoxGeometry(1.6, h, 10 + rr() * 14), col('#4a4642'), 0.1), (rr() - 0.5) * 120, h / 2, (rr() - 0.5) * 50, 0, rr() * 3, (rr() - 0.5) * 0.3)); }
      parts.push(xform(prep(new THREE.CylinderGeometry(26, 34, 3, 12), col('#2a2826')), 0, -0.5, 0));
      mat = plain(); break;
    }
    default: parts = [box(10, 10, 10, 0, 5, 0, [1, 1, 1])]; mat = plain();
  }
  return { geometry: merge(parts), material: mat };
}

export function buildTreeGeometry(kind = 'pine') {
  const parts = [];
  if (kind === 'pine') {
    parts.push(cyl(0.18, 0.28, 3, 5, 0, 1.5, 0, col('#4a3523'), 0.1));
    parts.push(cone(2.6, 6, 7, 0, 5.2, 0, col('#1f3a1c'), 0.2)); parts.push(cone(2.0, 5, 7, 0, 8.2, 0, col('#244420'), 0.2)); parts.push(cone(1.3, 4, 7, 0, 10.8, 0, col('#2a4a24'), 0.2));
  } else {
    parts.push(cyl(0.22, 0.32, 3.5, 5, 0, 1.75, 0, col('#4a3523'), 0.1));
    const b = new THREE.IcosahedronGeometry(3.3, 1); const p = b.attributes.position;
    for (let i = 0; i < p.count; i++) { const s = 0.85 + Math.sin(p.getX(i) * 3.1 + p.getZ(i) * 2.3) * 0.15; p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.85, p.getZ(i) * s); }
    b.computeVertexNormals(); parts.push(xform(prep(b, col('#2d4a22'), 0.2), 0, 6.2, 0));
  }
  return { geometry: merge(parts), material: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 }) };
}
