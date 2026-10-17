// Nimitz-class–like nuclear carrier and Arleigh Burke–like destroyer (procedural).
// Ship-local frame: origin at the waterline amidships, bow toward -Z, +X starboard.
import * as THREE from 'three';
import { Parts, meshes, loft, wing, box, cyl, cylZ, sphere, cone, xform, prep, merge, col, canvasTex, slab } from './kit.js';
import { buildParkedJet } from './fighter.js';

export const DECK_Y = 19.5;
export const DECK_POLY = [
  [0, -167], [9, -165], [17, -160], [22, -150], [26, -130], [29, -100], [31, -70], [32.5, -40], [33, 0], [33, 60], [32, 100], [30, 130], [27, 150], [22, 163], [14, 167],
  [-16, 167], [-22, 160], [-29, 135], [-35, 100], [-40, 60], [-44, 20], [-47, -15], [-48.5, -38], [-45, -48], [-35, -55], [-26, -75], [-20, -105], [-16, -135], [-12, -155], [-6, -164],
];
const ANG = THREE.MathUtils.degToRad(9.0);
export const LANDING = {
  ramp: new THREE.Vector2(-2, 167),
  dir: new THREE.Vector2(-Math.sin(ANG), -Math.cos(ANG)), // toward the bow-port
  perp: new THREE.Vector2(Math.cos(ANG), -Math.sin(ANG)), // to starboard
  halfWidth: 13.5,
  wireS: [52, 64, 76, 88],
  targetS: 70,
  glide: 3.5,
  lensS: 138, lensOff: -19.5,
};
export const CATS = [
  { name: 'CAT 1', x: 7.5, z0: -60, z1: -166 },
  { name: 'CAT 2', x: -9.5, z0: -58, z1: -164 },
];
export function landingPoint(s, off = 0) {
  const L = LANDING; return new THREE.Vector2(L.ramp.x + L.dir.x * s + L.perp.x * off, L.ramp.y + L.dir.y * s + L.perp.y * off);
}
export function pointInDeck(x, z) {
  let inside = false; const P = DECK_POLY;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i][0], zi = P[i][1], xj = P[j][0], zj = P[j][1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

function deckTexture() {
  const W = 512, H = 2048; const X0 = -50, X1 = 35, Z0 = -168, Z1 = 168;
  const tx = (x) => (x - X0) / (X1 - X0) * W, tz = (z) => (z - Z0) / (Z1 - Z0) * H;
  return canvasTex(W, H, (ctx) => {
    ctx.fillStyle = '#3d3f41'; ctx.fillRect(0, 0, W, H);
    // non-skid speckle + wear
    const img = ctx.getImageData(0, 0, W, H); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    ctx.putImageData(img, 0, 0);
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = `rgba(20,20,20,${Math.random() * 0.06})`;
      const x = Math.random() * W, y = Math.random() * H; ctx.fillRect(x, y, 4 + Math.random() * 30, 4 + Math.random() * 30);
    }
    const L = LANDING;
    const lp = (s, off) => { const p = landingPoint(s, off); return [tx(p.x), tz(p.y)]; };
    // tire marks in the landing area
    ctx.strokeStyle = 'rgba(10,10,10,0.18)';
    for (let i = 0; i < 160; i++) {
      const s = 40 + Math.random() * 120, off = (Math.random() - 0.5) * 12, len = 15 + Math.random() * 40;
      const [ax, az] = lp(s, off), [bx, bz] = lp(s + len, off + (Math.random() - 0.5) * 2);
      ctx.lineWidth = 1 + Math.random() * 2; ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
    }
    // landing area edge lines (white) & centerline (dashed white)
    ctx.strokeStyle = '#e8e8e2'; ctx.lineWidth = 3;
    for (const off of [-L.halfWidth, L.halfWidth]) { const [ax, az] = lp(0, off), [bx, bz] = lp(205, off); ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke(); }
    ctx.setLineDash([22, 18]); ctx.lineWidth = 2.5;
    { const [ax, az] = lp(0, 0), [bx, bz] = lp(205, 0); ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke(); }
    ctx.setLineDash([]);
    // foul line (red/white dashes) on the starboard side of landing area
    ctx.strokeStyle = '#c92a2a'; ctx.lineWidth = 2.5; ctx.setLineDash([10, 10]);
    { const [ax, az] = lp(0, L.halfWidth + 4), [bx, bz] = lp(205, L.halfWidth + 4); ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke(); }
    ctx.setLineDash([]);
    // wire locations
    ctx.strokeStyle = 'rgba(200,200,190,0.5)'; ctx.lineWidth = 1.5;
    for (const s of L.wireS) { const [ax, az] = lp(s, -L.halfWidth), [bx, bz] = lp(s, L.halfWidth); ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke(); }
    // ramp stripes at the stern
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 ? '#e0e0d8' : '#c43030';
      ctx.fillRect(tx(-16 + i * 2.5), tz(164.5), (2.5 / 85) * W, (2.5 / 336) * H);
    }
    // catapult tracks + yellow guide lines
    for (const c of [...CATS, { x: -22, z0: -40, z1: -140, waist: true }, { x: -34, z0: -20, z1: -120, waist: true }]) {
      const ang = c.waist ? -ANG * 0.6 : 0;
      ctx.save(); ctx.translate(tx(c.x), tz(c.z0)); ctx.rotate(-ang);
      const len = (c.z1 - c.z0) / (Z1 - Z0) * H;
      ctx.fillStyle = '#1b1b1c'; ctx.fillRect(-1.5, len, 3, -len);
      ctx.strokeStyle = '#d8b030'; ctx.lineWidth = 2; ctx.setLineDash([14, 8]);
      ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(-8, len); ctx.moveTo(8, 0); ctx.lineTo(8, len); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
    // yellow taxi lines
    ctx.strokeStyle = '#d4ad2c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(tx(24), tz(30)); ctx.bezierCurveTo(tx(15), tz(-20), tx(8), tz(-40), tx(7.5), tz(-58)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx(20), tz(-30)); ctx.bezierCurveTo(tx(5), tz(-40), tx(-9), tz(-45), tx(-9.5), tz(-56)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx(18), tz(140)); ctx.bezierCurveTo(tx(20), tz(90), tx(22), tz(60), tx(24), tz(30)); ctx.stroke();
    // elevator outlines
    ctx.strokeStyle = 'rgba(230,200,60,0.8)'; ctx.lineWidth = 2;
    for (const [x0, z0, x1, z1] of [[24, -60, 33, -38], [24, -20, 33, 2], [24, 66, 33, 88], [-48, 0, -40, 25]]) ctx.strokeRect(tx(x0), tz(z0), tx(x1) - tx(x0), tz(z1) - tz(z0));
    // big hull numbers
    ctx.fillStyle = '#e4e4de'; ctx.font = 'bold 150px Arial'; ctx.textAlign = 'center';
    ctx.save(); ctx.translate(tx(1), tz(-122)); ctx.fillText('90', 0, 0); ctx.restore();
    ctx.save(); ctx.translate(tx(-14), tz(140)); ctx.rotate(Math.PI - ANG); ctx.font = 'bold 110px Arial'; ctx.fillText('90', 0, 0); ctx.restore();
    // safe walk lines (white) along deck edge
    ctx.strokeStyle = 'rgba(230,230,225,0.55)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
    ctx.beginPath(); DECK_POLY.forEach(([x, z], i) => { const sx = x * 0.96, sz = z * 0.985; if (i === 0) ctx.moveTo(tx(sx), tz(sz)); else ctx.lineTo(tx(sx), tz(sz)); }); ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);
  });
}

function shipMaterials(hullHex) {
  return {
    hull: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.72, metalness: 0.25 }),
    deck: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.5 }),
    light: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 3, vertexColors: true }),
  };
}

const SC = {
  haze: col('#878e94'), hazeD: col('#6d7479'), hazeL: col('#9aa1a6'), boot: col('#2a1a18'), red: col('#5a1e1a'), black: col('#151617'),
  white: col('#dedede'), deckEdge: col('#55595c'), window: col('#1a222b'), radome: col('#e4e4e0'), yellow: col('#c9a227'), dark: col('#2c2f31'),
};

export function buildPhalanx(P, x, y, z, matKey = 'hull') {
  // static base; the moving parts are returned as groups
  const base = new THREE.Group(); base.position.set(x, y, z);
  const gun = new THREE.Group(); gun.position.set(0, 1.55, 0);
  const bp = new Parts();
  bp.add('hull', cyl(0.95, 1.1, 1.2, 14, 0, 0.6, 0, SC.white));
  bp.add('hull', cyl(0.62, 0.62, 1.1, 14, 0, 2.0, 0.3, SC.radome)); // radar cylinder
  bp.add('hull', sphere(0.62, 14, 10, 0, 2.55, 0.3, SC.radome, 0, 1, 0.75, 1)); // radome dome
  const gp = new Parts();
  gp.add('dark', cylZ(0.14, 0.14, 2.1, 8, 0, 0, -1.2, SC.black, 0.25));
  gp.add('dark', cylZ(0.22, 0.22, 0.6, 10, 0, 0, -0.3, SC.dark));
  gp.add('hull', box(0.9, 0.7, 1.2, 0, 0.0, 0.5, SC.white));
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -2.3); gun.add(muzzle);
  return { base, gun, muzzle, bp, gp };
}

export function buildCarrier() {
  const mats = shipMaterials();
  mats.deck.map = deckTexture();
  const root = new THREE.Group(); root.name = 'carrier';
  const P = new Parts();
  // hull below the flight deck
  const hullSecs = [
    { z: -167, w: 3, h: 26, y: 5.0, n: 3, wb: 0.15 },
    { z: -160, w: 16, h: 28.5, y: 4.0, n: 3.2, wb: 0.28 },
    { z: -145, w: 27, h: 29.5, y: 3.6, n: 3.6, wb: 0.42 },
    { z: -120, w: 36, h: 29.8, y: 3.6, n: 4, wb: 0.58 },
    { z: -85, w: 40.5, h: 29.8, y: 3.6, n: 4.2, wb: 0.76 },
    { z: -40, w: 41.5, h: 29.8, y: 3.6, n: 4.4, wb: 0.86 },
    { z: 40, w: 41.5, h: 29.8, y: 3.6, n: 4.4, wb: 0.86 },
    { z: 110, w: 41, h: 29.8, y: 3.6, n: 4.2, wb: 0.8 },
    { z: 150, w: 39, h: 29.4, y: 3.8, n: 4, wb: 0.72 },
    { z: 166, w: 37, h: 28, y: 4.5, n: 3.8, wb: 0.7 },
  ];
  P.add('hull', loft(hullSecs, 40, SC.haze, 0, { capEnd: true }));
  // boot topping band at the waterline
  P.add('hull', loft(hullSecs.map(s => ({ ...s, w: s.w * (s.wb + (1 - s.wb) * 0.62) + 0.25, h: 2.0, y: -0.2, n: s.n })), 40, SC.boot));
  // sponson structure under the angled deck (port) and fwd starboard
  const spon = [[-21, 166], [-29, 135], [-35, 100], [-40, 60], [-44, 20], [-47, -15], [-48.5, -38], [-45, -48], [-35, -55], [-26, -75], [-21, -75], [-21, 166]];
  P.add('hull', slab(spon, 12.5, 6.0, SC.hazeD));
  P.add('hull', slab([[20, -150], [26, -130], [29, -100], [31, -70], [32.5, -40], [33, 0], [33, 60], [32, 100], [30, 130], [27, 150], [21, 160], [20, 160]], 12.5, 6.0, SC.hazeD));
  // hangar openings & elevator wells (dark)
  for (const [x, z0, z1] of [[21.0, -60, -38], [21.0, -20, 2], [21.0, 66, 88]]) P.add('dark', box(0.4, 6.5, z1 - z0, x + 0.3, 12.0, (z0 + z1) / 2, SC.black));
  P.add('dark', box(0.4, 6.5, 25, -21.3, 12.0, 12.5, SC.black));
  // flight deck slab edges
  P.add('hull', slab(DECK_POLY, 18.0, 1.45, SC.deckEdge));
  // island
  const isl = new Parts();
  P.add('hull', loft([{ z: -6, w: 9.5, h: 13, y: 26, n: 6, x: 27 }, { z: 36, w: 9.5, h: 13, y: 26, n: 6, x: 27 }], 12, SC.haze, 0, { capStart: true, capEnd: true }));
  P.add('hull', loft([{ z: -2, w: 8.8, h: 6, y: 35.5, n: 6, x: 27 }, { z: 28, w: 8.8, h: 6, y: 35.5, n: 6, x: 27 }], 12, SC.hazeL, 0, { capStart: true, capEnd: true }));
  P.add('hull', loft([{ z: 2, w: 8.0, h: 4, y: 40.5, n: 6, x: 27 }, { z: 22, w: 8.0, h: 4, y: 40.5, n: 6, x: 27 }], 12, SC.haze, 0, { capStart: true, capEnd: true }));
  // bridge windows (pri-fly faces aft/port)
  for (const [y, z0, z1] of [[36.5, -2.1, 28.1], [41.5, 1.9, 22.1]]) {
    P.add('glass', box(0.2, 1.3, z1 - z0, 22.45 + (y > 40 ? 0.6 : 0.2), y, (z0 + z1) / 2, SC.window));
    P.add('glass', box(8.4, 1.3, 0.2, 27, y, z0 + 0.05, SC.window));
  }
  // island hull number
  // mast
  P.add('hull', box(1.6, 14, 1.6, 27, 49, 12, SC.hazeD));
  P.add('hull', box(9, 0.5, 0.6, 27, 52, 12, SC.hazeD));
  P.add('hull', box(6, 0.4, 0.5, 27, 55.5, 12, SC.hazeD));
  P.add('dark', cyl(0.12, 0.12, 6, 6, 27, 59, 12, SC.black));
  // radars (rotating)
  const radar1 = new THREE.Group(); radar1.position.set(27, 43.4, 5);
  const r1p = new Parts(); r1p.add('hull', box(6.5, 4.2, 0.35, 0, 2.3, 0, SC.hazeL, 0, -0.25)); r1p.add('dark', cyl(0.4, 0.4, 0.8, 8, 0, 0.3, 0, SC.dark));
  meshes(r1p.p, mats, radar1); root.add(radar1);
  const radar2 = new THREE.Group(); radar2.position.set(27, 56.8, 12);
  const r2p = new Parts(); r2p.add('dark', box(7.5, 1.8, 0.25, 0, 0.9, -0.4, SC.dark, 0, -0.35)); r2p.add('dark', cyl(0.25, 0.25, 0.6, 6, 0, 0.2, 0, SC.dark));
  meshes(r2p.p, mats, radar2); root.add(radar2);
  // CIWS mounts on sponsons
  const ciws = [];
  for (const [x, y, z] of [[-24, 18.0, -150], [26.5, 18.0, 152], [-27, 18.0, 148]]) {
    P.add('hull', box(5, 1.2, 5, x, y - 0.6, z, SC.hazeD));
    const c = buildPhalanx(P, x, y, z);
    meshes(c.bp.p, mats, c.base); meshes(c.gp.p, mats, c.gun); c.base.add(c.gun); root.add(c.base);
    ciws.push({ base: c.base, gun: c.gun, muzzle: c.muzzle });
  }
  // RAM / Sea Sparrow launchers (boxes)
  for (const [x, y, z] of [[-22, 18.3, 160], [24, 18.3, -140]]) { P.add('hull', box(2.4, 1.6, 3.0, x, y + 0.6, z, SC.white)); }
  // antennas along deck edge
  for (let i = 0; i < 8; i++) P.add('dark', cyl(0.08, 0.08, 7, 5, 33.5, 19, -120 + i * 30, SC.black, 0, 0, 0, -0.5));
  meshes(P.p, mats, root);
  // deck surface with markings
  const deckShape = new THREE.Shape(DECK_POLY.map(([x, z]) => new THREE.Vector2(x, -z)));
  const dg = new THREE.ShapeGeometry(deckShape); dg.rotateX(-Math.PI / 2); dg.translate(0, DECK_Y + 0.01, 0);
  const uvs = dg.attributes.uv; const pos = dg.attributes.position;
  for (let i = 0; i < pos.count; i++) uvs.setXY(i, (pos.getX(i) + 50) / 85, 1 - (pos.getZ(i) + 168) / 336);
  mats.deck.map.wrapS = mats.deck.map.wrapT = THREE.ClampToEdgeWrapping;
  mats.deck.map.flipY = true;
  const deck = new THREE.Mesh(dg, mats.deck); deck.receiveShadow = true; root.add(deck);

  // arresting wires (static lines, replaced dynamically when engaged)
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.8 });
  const wires = [];
  for (const s of LANDING.wireS) {
    const a = landingPoint(s, -LANDING.halfWidth), b = landingPoint(s, LANDING.halfWidth);
    const wg = new THREE.CylinderGeometry(0.035, 0.035, 1, 5); wg.rotateZ(Math.PI / 2); wg.translate(0.5, 0, 0);
    const wm = new THREE.Mesh(wg, wireMat);
    const wm2 = new THREE.Mesh(wg, wireMat);
    root.add(wm); root.add(wm2);
    const w = { s, a: new THREE.Vector3(a.x, DECK_Y + 0.12, a.y), b: new THREE.Vector3(b.x, DECK_Y + 0.12, b.y), meshA: wm, meshB: wm2, hook: null };
    setWire(w, null);
    wires.push(w);
    // deck sheaves
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 8), wireMat);
    sh.position.copy(w.a); root.add(sh); const sh2 = sh.clone(); sh2.position.copy(w.b); root.add(sh2);
  }
  // IFLOLS lens box on the port deck edge
  const lensPos2 = landingPoint(LANDING.lensS, LANDING.lensOff);
  const lens = new THREE.Group(); lens.position.set(lensPos2.x, DECK_Y + 1.4, lensPos2.y);
  lens.rotation.y = Math.atan2(-LANDING.dir.x, -LANDING.dir.y); // face aft along the glide path
  const lp = new Parts();
  lp.add('dark', box(1.2, 3.4, 0.8, 0, 0, 0, SC.black));
  lp.add('dark', box(9, 0.3, 0.4, 0, -0.1, 0, SC.dark));
  lp.add('dark', box(0.25, 2.2, 0.25, 0, -1.8, 0, SC.dark));
  meshes(lp.p, mats, lens);
  const cellMat = []; const cells = [];
  for (let i = 0; i < 12; i++) {
    const m = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const c = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.22), m); c.position.set(0, -1.4 + i * 0.25, 0.42); lens.add(c); cells.push(c); cellMat.push(m);
  }
  const datum = [];
  for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 2.5, 0.4) });
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.18), m); d.position.set(sx * (1.0 + k * 0.7), -0.1, 0.22); lens.add(d); datum.push(d);
  }
  const waveoff = [];
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
    const m = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), m); d.position.set(sx * 0.82, -1.0 + k * 0.9, 0.42); lens.add(d); waveoff.push(m);
  }
  root.add(lens);

  // jet blast deflectors behind the bow catapults
  const jbds = [];
  for (const c of CATS) {
    const g = new THREE.Group(); g.position.set(c.x, DECK_Y + 0.05, c.z0 + 14);
    const m = new THREE.Mesh(merge([box(11, 0.25, 4.2, 0, 0, 2.1, SC.deckEdge)]), mats.hull); m.castShadow = true; m.receiveShadow = true; g.add(m);
    root.add(g); jbds.push(g);
  }
  // catapult shuttles
  const shuttles = [];
  for (const c of CATS) {
    const s = new THREE.Mesh(merge([box(0.5, 0.25, 1.0, 0, 0.12, 0, SC.dark)]), mats.dark);
    s.position.set(c.x, DECK_Y, c.z0); root.add(s); shuttles.push(s);
  }
  // parked aircraft
  const parkedSpots = [[22, -115, -0.6], [22, -100, -0.6], [22, -85, -0.6], [20, 52, -2.3], [18, 70, -2.3], [21, 105, -2.0], [24, 125, -2.0]];
  const parkedProto = buildParkedJet();
  for (const [x, z, h] of parkedSpots) {
    const p = parkedProto.clone(); p.position.set(x, DECK_Y + 2.24, z); p.rotation.y = h; root.add(p);
  }
  // E-2 style AEW aircraft (simple)
  {
    const g = new THREE.Group(); const ap = new Parts();
    ap.add('hull', loft([{ z: -8.5, w: 0.3, h: 0.4, y: 0 }, { z: -7, w: 1.8, h: 1.9, y: 0 }, { z: 2, w: 2.0, h: 2.2, y: 0.1 }, { z: 7, w: 0.9, h: 1.0, y: 0.5 }], 16, SC.white));
    ap.add('hull', wing({ le: [0, 1.0, -2.0], chord: 3.0, tc: 0.12 }, { le: [12.3, 1.0, -1.2], chord: 1.6, tc: 0.1 }, SC.white));
    ap.add('hull', wing({ le: [0, 1.0, -2.0], chord: 3.0, tc: 0.12 }, { le: [-12.3, 1.0, -1.2], chord: 1.6, tc: 0.1 }, SC.white));
    ap.add('hull', cyl(3.6, 3.6, 0.6, 24, 0, 3.0, 0.5, SC.white)); ap.add('hull', cyl(0.3, 0.3, 1.6, 6, 0, 2.0, 0.5, SC.hazeD));
    ap.add('hull', box(7.8, 0.15, 1.6, 0, 1.2, 7.0, SC.white));
    for (const x of [-3.9, -1.3, 1.3, 3.9]) ap.add('hull', box(0.12, 2.6, 1.4, x, 2.2, 7.2, SC.white));
    for (const x of [-4.2, 4.2]) ap.add('hull', cylZ(0.6, 0.55, 4, 10, x, 0.6, -1.8, SC.white));
    meshes(ap.p, mats, g);
    g.position.set(-24, DECK_Y + 2.0, 110); g.rotation.y = 2.6; root.add(g);
  }
  return {
    root, mats, wires, lens: { group: lens, cells, cellMat, datum, waveoff }, jbds, shuttles, ciws, radars: [radar1, radar2],
    info: {
      length: 333, beam: 41, draft: 11.3, deckY: DECK_Y,
      hitSpheres: [-130, -80, -30, 20, 70, 120, 155].map(z => ({ c: new THREE.Vector3(0, 6, z), r: 26 })).concat([{ c: new THREE.Vector3(27, 34, 15), r: 18 }]),
    },
  };
}

export function setWire(w, hookLocal) {
  // w.a, w.b: wire anchors in ship-local; hookLocal: engaged hook point or null
  const place = (mesh, p0, p1) => {
    const d = new THREE.Vector3().subVectors(p1, p0); const L = d.length();
    mesh.position.copy(p0); mesh.scale.set(L, 1, 1);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize());
  };
  if (!hookLocal) {
    const mid = w.a.clone().lerp(w.b, 0.5);
    place(w.meshA, w.a, mid); place(w.meshB, mid, w.b);
  } else {
    place(w.meshA, w.a, hookLocal); place(w.meshB, hookLocal, w.b);
  }
}

export function buildDestroyer() {
  const mats = shipMaterials();
  const root = new THREE.Group(); root.name = 'destroyer';
  const P = new Parts();
  const L = 155;
  const secs = [
    { z: -77.5, w: 1.2, h: 17.5, y: 0.6, n: 2.5, wb: 0.1 },
    { z: -70, w: 9, h: 17.8, y: 0.2, n: 2.8, wb: 0.25 },
    { z: -55, w: 15.5, h: 17.4, y: -0.3, n: 3.2, wb: 0.45 },
    { z: -30, w: 19.5, h: 16.6, y: -0.9, n: 3.6, wb: 0.65 },
    { z: 10, w: 20, h: 16.0, y: -1.4, n: 3.8, wb: 0.72 },
    { z: 50, w: 19.4, h: 15.6, y: -1.6, n: 3.8, wb: 0.72 },
    { z: 77.5, w: 17.5, h: 15.2, y: -1.8, n: 3.6, wb: 0.7 },
  ];
  P.add('hull', loft(secs, 32, SC.haze, 0, { capEnd: true }));
  P.add('hull', loft(secs.map(s => ({ ...s, w: s.w * (s.wb + (1 - s.wb) * 0.55) + 0.2, h: 1.6, y: -0.1 })), 32, SC.boot));
  // main deck plate (follows sheer approx)
  const deckPts = []; for (const s of secs) deckPts.push([s.w / 2 - 0.2, s.z]); for (const s of [...secs].reverse()) deckPts.push([-s.w / 2 + 0.2, s.z]);
  P.add('dark', slab(deckPts.filter((p, i) => i !== 0 && i !== deckPts.length - 1), 6.4, 0.3, SC.dark));
  // forward superstructure with tumblehome
  P.add('hull', loft([{ z: -26, w: 15, h: 9, y: 11.2, n: 5, wt: 0.82 }, { z: 6, w: 16, h: 9, y: 11.2, n: 5, wt: 0.82 }], 16, SC.hazeL, 0, { capStart: true, capEnd: true }));
  P.add('hull', loft([{ z: -22, w: 11, h: 5, y: 18, n: 5, wt: 0.8 }, { z: -6, w: 11, h: 5, y: 18, n: 5, wt: 0.8 }], 16, SC.hazeL, 0, { capStart: true, capEnd: true }));
  P.add('glass', box(10.5, 1.0, 0.2, 0, 19.2, -22.1, SC.window));
  // SPY-1 octagonal faces
  for (const [x, z, ry] of [[-6.4, -20, -0.6], [6.4, -20, 0.6], [-6.4, 4, Math.PI + 0.6], [6.4, 4, Math.PI - 0.6]]) {
    P.add('dark', xform(prep(new THREE.CylinderGeometry(2.0, 2.0, 0.25, 8), SC.hazeD), x, 14.2, z, Math.PI / 2, ry, 0));
  }
  // mast + radar
  P.add('hull', box(1.2, 14, 1.2, 0, 27, -8, SC.hazeD)); P.add('hull', box(7, 0.4, 0.5, 0, 30, -8, SC.hazeD));
  const radar = new THREE.Group(); radar.position.set(0, 34.3, -8);
  const rp = new Parts(); rp.add('dark', box(3.5, 0.9, 0.2, 0, 0.4, 0, SC.dark)); meshes(rp.p, mats, radar); root.add(radar);
  // funnels
  for (const z of [10, 28]) {
    P.add('hull', loft([{ z: z - 4, w: 5.5, h: 8, y: 10.5, n: 4, wt: 0.85 }, { z: z + 4, w: 5.5, h: 8, y: 10.5, n: 4, wt: 0.85 }], 12, SC.haze, 0, { capStart: true, capEnd: true }));
    P.add('dark', box(5.0, 0.6, 7.2, 0, 14.8, z, SC.black, 1.0));
  }
  // aft superstructure + hangar
  P.add('hull', loft([{ z: 32, w: 14, h: 8, y: 10.2, n: 5, wt: 0.85 }, { z: 52, w: 15, h: 8, y: 10.2, n: 5, wt: 0.85 }], 14, SC.hazeL, 0, { capStart: true, capEnd: true }));
  // VLS fore & aft
  P.add('dark', box(6, 0.2, 8, 0, 6.65, -38, SC.dark)); P.add('dark', box(8, 0.2, 9, 0, 6.65, 60, SC.dark));
  // helo deck markings
  P.add('dark', box(0.4, 0.05, 14, 0, 6.66, 69, SC.white));
  // gun
  const gunTurret = new THREE.Group(); gunTurret.position.set(0, 6.8, -52);
  const gp = new Parts(); gp.add('hull', loft([{ z: -2.2, w: 3.6, h: 2.2, y: 1.1, n: 3, wt: 0.6 }, { z: 2.6, w: 3.8, h: 2.4, y: 1.2, n: 3, wt: 0.7 }], 10, SC.hazeL, 0, { capStart: true, capEnd: true }));
  meshes(gp.p, mats, gunTurret);
  const gunBarrel = new THREE.Group(); gunBarrel.position.set(0, 1.2, -1.6);
  const bp = new Parts(); bp.add('dark', cylZ(0.12, 0.17, 6.5, 8, 0, 0, -3.2, SC.hazeD)); meshes(bp.p, mats, gunBarrel);
  gunTurret.add(gunBarrel); root.add(gunTurret);
  const ciws = [];
  for (const [x, y, z] of [[0, 20.6, -15], [0, 14.4, 47]]) {
    const c = buildPhalanx(P, x, y, z);
    meshes(c.bp.p, mats, c.base); meshes(c.gp.p, mats, c.gun); c.base.add(c.gun); root.add(c.base);
    ciws.push({ base: c.base, gun: c.gun, muzzle: c.muzzle });
  }
  meshes(P.p, mats, root);
  return { root, mats, radar, gunTurret, gunBarrel, ciws, info: { length: L, beam: 20, draft: 9.4, deckY: 6.5, hitSpheres: [-55, -20, 15, 50].map(z => ({ c: new THREE.Vector3(0, 4, z), r: 14 })) } };
}
