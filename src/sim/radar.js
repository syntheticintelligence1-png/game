// Pulse-Doppler radar model: RCS-scaled detection range, terrain masking with earth curvature (radar
// horizon), Doppler-notch clutter rejection (beaming targets in look-down geometry are filtered out),
// search/track (STT) state, chaff seduction, RWR aggregation for the player.
import * as THREE from 'three';

const D2R = Math.PI / 180;
export const NOTCH_V = 26; // m/s radial-velocity gate around mainlobe clutter
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

// Is there clutter behind the target as seen from the radar (look-down or grazing geometry)?
export function clutterBehind(terrain, rp, tp) {
  const dx = tp.x - rp.x, dz = tp.z - rp.z; const hd = Math.hypot(dx, dz);
  if (tp.y < rp.y - 40) return true; // look-down
  const elev = Math.atan2(tp.y - rp.y, Math.max(hd, 1));
  if (elev > 3.0 * D2R) return false;
  const agl = tp.y - Math.max(terrain.heightAt(tp.x, tp.z), 0);
  return agl < 600 + hd * 0.02;
}
// Doppler notch: target's ground-relative radial velocity near zero with clutter behind it
export function inNotch(terrain, rp, tgtPos, tgtVel, notchV = NOTCH_V) {
  if (!clutterBehind(terrain, rp, tgtPos)) return false;
  _v.copy(tgtPos).sub(rp).normalize();
  return Math.abs(tgtVel.dot(_v)) < notchV;
}
export function radialSpeed(rp, tgtPos, tgtVel) { _v.copy(tgtPos).sub(rp).normalize(); return tgtVel.dot(_v); }

export class Radar {
  constructor(owner, o) {
    this.owner = owner; this.type = o.type || 'search'; this.label = o.label || 'SR';
    this.range = o.range || 40000; this.rcsRef = o.rcsRef || 5;
    this.azHalf = o.azHalf != null ? o.azHalf : Math.PI; this.elMin = o.elMin != null ? o.elMin : -0.6; this.elMax = o.elMax != null ? o.elMax : 1.4;
    this.scanPeriod = o.scanPeriod || 6; this.phase = Math.random() * this.scanPeriod;
    this.on = true; this.stt = null; this.sttLost = 0; this.guiding = new Set(); this.notchV = o.notchV || NOTCH_V;
    this.emitterOffset = o.emitterOffset || new THREE.Vector3(0, 5, 0);
    this.lethal = o.lethal || 1; this.isAir = !!o.isAir;
    this.lastPing = 0; this.decoyed = null; this.minAlt = o.minAlt || 0; this.eccm = o.eccm || 0; // eccm: share of chaff it sees through
  }
  get pos() {
    const o = this.owner; if (o.root) { _v2.copy(this.emitterOffset).applyQuaternion(o.root.quaternion).add(o.root.position); return _v2; }
    return o.pos;
  }
  forward(out) { // boresight for airborne radars
    return out.set(0, 0, -1).applyQuaternion(this.owner.quat);
  }
  inCoverage(tp) {
    const rp = this.pos;
    if (this.isAir) {
      const f = this.forward(_v); const d = _v2.copy(tp).sub(rp).normalize();
      return f.dot(d) > Math.cos(this.azHalf);
    }
    const dx = tp.x - rp.x, dz = tp.z - rp.z; const hd = Math.hypot(dx, dz);
    const el = Math.atan2(tp.y - rp.y, hd);
    return el >= this.elMin && el <= this.elMax;
  }
  // two-way detection (radar sees target)
  canSee(world, tgt, rangeMul = 1) {
    if (!this.on || !this.owner.alive || !tgt.alive) return false;
    const rp = this.pos.clone();
    const R = rp.distanceTo(tgt.pos);
    const maxR = this.range * Math.pow(Math.max(tgt.rcs, 0.01) / this.rcsRef, 0.25) * rangeMul;
    if (R > maxR) return false;
    if (tgt.pos.y - Math.max(world.game.terrain.heightAt(tgt.pos.x, tgt.pos.z), 0) < this.minAlt) return false;
    if (!this.inCoverage(tgt.pos)) return false;
    // a target can carry its own (narrower) gate: drones are too slow for the usual one (see drones.js)
    if (inNotch(world.game.terrain, rp, tgt.pos, tgt.vel, Math.min(this.notchV, tgt.notchV ?? Infinity))) return false;
    if (!world.game.terrain.lineOfSight(rp, tgt.pos, true, 2)) return false;
    return true;
  }
  // one-way (RWR hears the emitter); ~1.6x further than two-way detection
  illuminates(world, tgt) {
    if (!this.on || !this.owner.alive) return false;
    const rp = this.pos;
    if (rp.distanceTo(tgt.pos) > this.range * 1.6) return false;
    if (!this.inCoverage(tgt.pos)) return false;
    return world.game.terrain.lineOfSight(rp, tgt.pos, true, 2);
  }
  // single-target track maintenance; returns true while locked
  updateTrack(world, dt) {
    const t = this.stt;
    if (!t) return false;
    if (!t.alive) { this.stt = null; return false; }
    // chaff: a fresh cloud close to a notching target can steal the track
    if (world.chaff.length && !this.decoyed) {
      for (const c of world.chaff) {
        if (c.age > 2.5 || c.used.has(this)) continue;
        if (c.pos.distanceTo(t.pos) < 400) {
          c.used.add(this);
          const vr = Math.abs(radialSpeed(this.pos, t.pos, t.vel));
          const p = (vr < this.notchV * 2.2 ? 0.8 : vr < 120 ? 0.35 : 0.12) * (1 - this.eccm);
          if (Math.random() < p) { this.decoyed = c; this.stt = null; this.sttLost = 0; this.reacqT = 3.5 + Math.random() * 2.5; return false; } // break-lock: seconds to re-acquire
        }
      }
    }
    if (this.canSee(world, t)) { this.sttLost = 0; return true; }
    this.sttLost += dt;
    if (this.sttLost > 1.2) { this.stt = null; this.sttLost = 0; this.reacqT = 2 + Math.random() * 1.5; return false; }
    return true;
  }
  beamAngle(time) { return (time / this.scanPeriod + this.phase) % 1 * Math.PI * 2; }
}

// Player RWR: list of emitters illuminating the player
export function computeRWR(world, player, time) {
  const out = [];
  const f = player.ac.forward(new THREE.Vector3());
  const hdg = Math.atan2(f.x, -f.z);
  for (const r of world.radars) {
    if (!r.on || !r.owner.alive || r.owner.team === player.team) continue;
    if (!r.illuminates(world, player)) continue;
    const rp = r.pos; const dx = rp.x - player.pos.x, dz = rp.z - player.pos.z;
    const brg = Math.atan2(dx, -dz) - hdg;
    let level = 'search';
    if (r.stt === player) level = 'lock';
    for (const m of r.guiding) if (!m.dead && m.target === player) level = 'launch';
    // search ping when the beam sweeps the player
    let ping = false;
    if (level === 'search') {
      const ang = Math.atan2(player.pos.x - rp.x, -(player.pos.z - rp.z));
      const beam = r.beamAngle(time);
      let d = Math.atan2(Math.sin(beam - ang), Math.cos(beam - ang));
      if (r.isAir) ping = (time - r.lastPing) > 2.2; else ping = Math.abs(d) < 0.12 && (time - r.lastPing) > r.scanPeriod * 0.6;
      if (ping) r.lastPing = time;
    }
    out.push({ brg, label: r.label, level, dist: Math.hypot(dx, dz), lethal: r.lethal, ping, radar: r });
  }
  // active-seeker missiles homing on us
  for (const m of world.missiles) {
    if (m.dead || m.team === player.team || m.target !== player) continue;
    if (!(m.def.seeker === 'arh' && m.active)) continue;
    const dx = m.pos.x - player.pos.x, dz = m.pos.z - player.pos.z;
    out.push({ brg: Math.atan2(dx, -dz) - hdg, label: 'M', level: 'launch', dist: Math.hypot(dx, dz), lethal: 3, ping: false, missile: m });
  }
  return out;
}

// Player's air-to-air radar (RWS search + STT)
export class PlayerRadar {
  constructor(game) {
    this.game = game; this.rangeIdx = 2; this.ranges = [20000, 40000, 80000, 160000];
    this.contacts = []; this.stt = null; this.sttLost = 0; this.scanT = 0; this.mode = 'RWS'; this.azHalf = 60 * D2R;
    this.pseudo = { owner: null, pos: null };
  }
  get range() { return this.ranges[this.rangeIdx]; }
  detect(world, p, e) {
    const R = p.pos.distanceTo(e.pos);
    const maxR = 95000 * Math.pow(Math.max(e.rcs, 0.01) / 5, 0.25);
    if (R > maxR) return false;
    const f = p.ac.forward(_v); const d = _v2.copy(e.pos).sub(p.pos).normalize();
    if (f.dot(d) < Math.cos(this.azHalf)) return false;
    if (inNotch(this.game.terrain, p.pos, e.pos, e.vel, e.notchV ?? NOTCH_V)) return false;
    return this.game.terrain.lineOfSight(p.pos, e.pos, true, 2);
  }
  update(world, p, dt) {
    this.scanT += dt;
    if (this.scanT > 1.0) {
      this.scanT = 0;
      this.contacts = [];
      for (const e of world.entities) {
        if (!e.alive || e.team === p.team || (e.kind !== 'air' && e.kind !== 'ship' && e.kind !== 'cruise')) continue;
        if (this.detect(world, p, e)) this.contacts.push({ e, pos: e.pos.clone(), vel: e.vel.clone(), t: this.game.time });
      }
    }
    if (this.stt) {
      const t = this.stt;
      if (!t.alive) { this.stt = null; }
      else if (this.detect(world, p, t)) { this.sttLost = 0; }
      else { this.sttLost += dt; if (this.sttLost > 1.5) { this.stt = null; this.sttLost = 0; this.game.msg('LOCK LOST', 1.5); } }
    }
  }
  lockNearest(world, p, dirHint) {
    let best = null, bestS = -1e9;
    const f = dirHint || p.ac.forward(new THREE.Vector3());
    for (const e of world.entities) {
      if (!e.alive || e.team === p.team || (e.kind !== 'air' && e.kind !== 'cruise')) continue;
      if (!this.detect(world, p, e)) continue;
      const d = e.pos.clone().sub(p.pos); const R = d.length(); d.normalize();
      const s = f.dot(d) * 3 - R / 60000;
      if (s > bestS && (e !== this.stt || bestS < -1e8)) { bestS = s; best = e; }
    }
    if (best && best === this.stt) {
      // cycle to the next candidate
      const others = world.entities.filter(e => e.alive && e.team !== p.team && e.kind === 'air' && e !== this.stt && this.detect(world, p, e));
      if (others.length) best = others[0];
    }
    this.stt = best; this.sttLost = 0;
    return best;
  }
}
