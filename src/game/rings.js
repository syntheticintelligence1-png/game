// Ring course: free-flight practice against the clock, no enemies. Fourteen glowing rings lead from the sea up the
// west side of the island and back: low over the sea, down the airfield runway, over the western canyon and the
// mountains, down the central canyon, over the city towers and the port, and home over the sea. The next ring is
// green; fly past one outside it and it stays the next ring until you come back for it. Plugs into Missions as its
// stage control (ctl).
import * as THREE from 'three';
import { CS } from './radio.js';

// [x, z, clearance above the highest ground within 500 m (m)]
export const COURSE = [
  [2600, 24000, 220], [0, 19000, 160], [-3000, 14000, 120], [-3500, 8600, 140],
  [-5600, 6200, 90], [-9600, 6200, 90], // down the runway
  [-11500, 2500, 160], [-8200, 300, 150], [-4200, -1900, 160], // the western canyon and the mountains
  [-1500, 1000, 150], [-1800, 5800, 140], // down the central canyon
  [3400, 6900, 300], // over the city towers (the tallest is ~230 m)
  [6600, 8600, 120], [5000, 16000, 140], // the port, then home over the sea
];
export const RING_R = 70;
const START = new THREE.Vector3(3200, 420, 28200);
const COL = { next: [0.35, 6.5, 1.7], then: [3.2, 1.45, 0.25], later: [1.1, 0.5, 0.1] };
export const fmtRace = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const _v = new THREE.Vector3();
const TUBE = 4.2;
// A 4 m tube is under a pixel wide beyond a kilometre or two, so the vertex shader fattens it with distance (TorusGeometry
// normals point out from the tube's centre line): about 3 px on screen out to 7 km, true size up close.
function ringMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 rv = modelViewMatrix * vec4(position, 1.0); transformed += normal * ${TUBE.toFixed(2)} * (clamp(-rv.z / 700.0, 1.0, 10.0) - 1.0); }`);
  };
  m.customProgramCacheKey = () => 'ring-tube';
  return m;
}

function groundMax(T, x, z, r) {
  let m = Math.max(T.heightAt(x, z), 0);
  for (let a = 0; a < 8; a++) for (const k of [0.5, 1]) m = Math.max(m, T.heightAt(x + Math.cos(a * Math.PI / 4) * r * k, z + Math.sin(a * Math.PI / 4) * r * k));
  return m;
}
// ring centres, high enough that the straight line from each ring to the next clears the ground by 100 m
export function layoutCourse(T) {
  const P = COURSE.map(([x, z, c]) => new THREE.Vector3(x, groundMax(T, x, z, 500) + c + RING_R, z));
  for (let pass = 0; pass < 3; pass++) for (let i = -1; i < P.length - 1; i++) {
    const a = i < 0 ? START : P[i], b = P[i + 1]; let need = 0;
    for (let k = 1; k < 24; k++) {
      const t = k / 24, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      need = Math.max(need, groundMax(T, x, z, 250) + 100 - (a.y + (b.y - a.y) * t));
    }
    if (need > 0) { if (i >= 0) a.y += need; b.y += need; }
  }
  return P;
}

export class RingCourse {
  constructor(M) { this.M = M; this.g = M.g; this.id = 'rings'; this.rings = []; }
  begin() {
    const g = this.g;
    const P = layoutCourse(g.terrain);
    const geo = new THREE.TorusGeometry(RING_R, TUBE, 10, 72);
    this.rings = P.map((p, i) => {
      const prev = i ? P[i - 1] : START, next = P[i + 1];
      const n = p.clone().sub(prev).normalize();
      if (next) n.add(next.clone().sub(p).normalize()).normalize();
      const mesh = new THREE.Mesh(geo, ringMaterial());
      mesh.frustumCulled = false; // the fattened tube reaches outside the geometry's bounding sphere
      mesh.position.copy(p); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      g.scene.add(mesh);
      return { pos: p, n, mesh };
    });
    this.geo = geo;
    this.length = P.reduce((s, p, i) => s + p.distanceTo(i ? P[i - 1] : START), 0);
    this.par = Math.round(this.length / 240 / 5) * 5; // about 470 kt all the way round
    this.i = 0; this.prevD = null; this.misses = 0; this.missT = -10; this.splits = []; this.done = false;
    this.t0 = g.time; this.best = g.ringBest || 0;
    this.paint();
  }
  next() { return this.rings[this.i] || null; }
  elapsed() { return (this.done ? this.endT : this.g.time) - this.t0; }
  clock() { return fmtRace(this.elapsed()); }
  // next ring green, the one after it orange, the rest dim; flown rings disappear
  paint() {
    this.rings.forEach((r, k) => {
      r.mesh.visible = k >= this.i;
      const c = k === this.i ? COL.next : k === this.i + 1 ? COL.then : COL.later;
      r.mesh.material.color.setRGB(c[0], c[1], c[2]);
    });
  }
  // where the jet starts (and comes back after a crash in practice): before the first ring, or just past the last
  // one flown, pointing at the next
  startPoint() {
    this.prevD = null;
    const r = this.rings[this.i], last = this.rings[this.i - 1];
    // level with ring 1 at the start, so flying straight ahead goes through it
    const from = last ? last.pos.clone().addScaledVector(last.n, 250) : START.clone().setY(r ? r.pos.y : START.y);
    const to = r ? r.pos : from.clone().add(new THREE.Vector3(0, 0, -1000));
    const hdg = Math.atan2(to.x - from.x, -(to.z - from.z)) * 180 / Math.PI;
    return { pos: from, hdg, v: 215 };
  }
  opening() {
    const n = this.rings.length;
    this.g.comms.call('ship', `${CS}, Mother, the range is clear. ${n} rings, clock is running.`, `Fly through all ${n} rings in order, as fast as you can. The next ring is green and has a green circle on the HUD; the orange one is the ring after it. Enter starts over.`, { pri: 5, ttl: 12 });
  }
  update() {
    const g = this.g, P = g.player;
    if (this.done || !P.alive || !this.rings.length) return;
    const r = this.rings[this.i]; if (!r) return;
    const rel = _v.copy(P.pos).sub(r.pos), d = rel.dot(r.n);
    if (this.prevD !== null && this.prevD < 0 && d >= 0) {
      const lat = rel.addScaledVector(r.n, -d).length();
      if (lat <= RING_R + 6) this.pass();
      else if (lat < 1500) this.miss();
    }
    if (!this.done) this.prevD = d;
    // the next ring breathes so it stands out from the scenery
    const k = 1 + 0.25 * Math.sin(g.time * 5), c = COL.next, nr = this.rings[this.i];
    if (nr) nr.mesh.material.color.setRGB(c[0] * k, c[1] * k, c[2] * k);
  }
  pass() {
    const g = this.g, n = this.rings.length, t = g.time - this.t0;
    this.splits.push(t); this.i++; this.prevD = null;
    if (g.audio.uiConfirm) g.audio.uiConfirm();
    if (this.i >= n) {
      this.done = true; this.endT = g.time; this.paint();
      const best = !this.best || t < this.best;
      g.msg(`FINISH! ${fmtRace(t)}${best ? ' — NEW BEST TIME' : ''}`, 5, '#7dffb0');
      g.comms.call('ship', `${CS}, Mother, all ${n} rings, ${fmtRace(t)}.${best ? ' New range record.' : ''} Nice flying.`, `Course complete in ${fmtRace(t)}${best ? ', your best time yet' : ''}.`, { pri: 6, urgent: true, ttl: 8 });
      this.M.finish(true, `COURSE COMPLETE · ${fmtRace(t)}`);
      return;
    }
    this.paint();
    g.msg(`RING ${this.i}/${n} ✓  ${fmtRace(t)}`, 1.6, '#7dffb0');
    if (this.i === n - 1) g.comms.call('ship', `${CS}, last ring, bring it home.`, 'One ring to go: the finish is out over the sea.', { pri: 3, ttl: 6 });
  }
  miss() {
    const g = this.g;
    if (g.time - this.missT < 4) return;
    this.missT = g.time; this.misses++;
    g.msg(`MISSED RING ${this.i + 1} — TURN AROUND AND FLY THROUGH IT`, 3.5, '#ff9080');
    g.comms.call('ship', `${CS}, you missed ring ${this.i + 1}. Come back around.`, 'You flew past the ring, outside it. Turn around and fly through it: it stays green until you do.', { key: 'ringmiss', every: 8, pri: 3, ttl: 7 });
  }
  // HUD: a green circle on the next ring (with an edge arrow when it is off screen), a dim one on the ring after
  markers(out, p) {
    if (this.done) return;
    const r = this.rings[this.i], r2 = this.rings[this.i + 1];
    if (r) out.push({ pos: r.pos, kind: 'join', label: `RING ${this.i + 1}/${this.rings.length}`, d: r.pos.distanceTo(p), r: RING_R, arrow: true });
    if (r2) out.push({ pos: r2.pos, kind: 'ring2', label: 'THEN', d: r2.pos.distanceTo(p), r: RING_R });
  }
  objectiveText() { const n = this.rings.length; return `RING ${Math.min(this.i + 1, n)}/${n} · ${this.clock()}`; }
  targets() { }
  onDestroyed() { return false; }
  onDefensesDown() { return false; }
  grade() { const t = this.elapsed(); return t < this.par && !this.misses ? 'A — OUTSTANDING' : t < this.par * 1.3 ? 'B — SOLID WORK' : 'C — COURSE COMPLETE'; }
  reportItems() {
    const n = this.rings.length, t = this.elapsed(), out = [];
    out.push({ ok: this.done, text: this.done ? `ALL ${n} RINGS · ${fmtRace(t)}` : `RINGS ${this.i}/${n}`, big: true });
    out.push({ ok: !this.misses, text: this.misses ? `${this.misses} MISSED (AND FLOWN AGAIN)` : 'NO RINGS MISSED' });
    if (this.done) out.push({ ok: !this.best || t < this.best, text: !this.best || t < this.best ? `NEW BEST TIME${this.best ? ` (WAS ${fmtRace(this.best)})` : ''}` : `BEST TIME ${fmtRace(this.best)}` });
    out.push({ ok: t < this.par, text: `PAR ${fmtRace(this.par)} (A GRADE: UNDER PAR, NO MISSES)` });
    return out;
  }
  teardown() {
    for (const r of this.rings) { this.g.scene.remove(r.mesh); r.mesh.material.dispose(); }
    if (this.geo) this.geo.dispose();
    this.rings = [];
  }
}
