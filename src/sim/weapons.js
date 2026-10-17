// Weapons: missiles/bombs (kinematics + seekers + guidance + fuzes), 20mm ballistics, countermeasures,
// and fire-control solutions (CCIP, CCRP, LCOS lead, gun funnel, launch zones).
import * as THREE from 'three';
import { rhoAt, soundAt, G0 } from './atmo.js';
import { buildMunition, setFins } from '../models/munitions.js';
import { inNotch, radialSpeed } from './radar.js';

const D2R = Math.PI / 180;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

// cd0 vs Mach for missile bodies
function cdM(M, base) {
  if (M < 0.8) return base;
  if (M < 1.15) return base + (base * 0.9) * ((M - 0.8) / 0.35);
  return base * 1.9 - Math.min(0.6, (M - 1.15) * 0.25) * base;
}

export const DEFS = {
  aim9x: { name: 'AIM-9X', short: 'SRM', model: 'aim9x', seeker: 'ir', mass: 85, prop: 30, burn1: 5.2, thrust1: 12500, burn2: 0, thrust2: 0, d: 0.127, cd0: 0.34, maxG: 40, cnMax: 7, nav: 4, gimbal: 90, fov: 4.5, flareResist: 0.82, fuzeR: 8, killR: 6, dmgR: 18, dmg: 120, life: 24, smoke: 0.35 },
  aim120: { name: 'AIM-120D', short: 'MRM', model: 'aim120', seeker: 'arh', eccm: 0.65, mass: 152, prop: 50, burn1: 2.6, thrust1: 30000, burn2: 5.0, thrust2: 6500, d: 0.178, cd0: 0.3, maxG: 35, cnMax: 6, nav: 4, gimbal: 60, seekerCone: 30, seekerRange: 19000, pitbull: 16000, loft: true, fuzeR: 12, killR: 9, dmgR: 26, dmg: 110, life: 85, smoke: 0.25 },
  agm65: { name: 'AGM-65', short: 'MAV', model: 'agm65', seeker: 'tv', mass: 210, prop: 45, burn1: 4.0, thrust1: 15000, burn2: 0, thrust2: 0, d: 0.305, cd0: 0.32, maxG: 15, cnMax: 5, nav: 3.5, gimbal: 60, fuzeR: 2.5, killR: 5, dmgR: 16, dmg: 320, life: 70, smoke: 0.5, ground: true },
  agm84: { name: 'AGM-84', short: 'HPN', model: 'agm84', seeker: 'arh', eccm: 0.5, mass: 690, prop: 90, burn1: 2.8, thrust1: 52000, burn2: 600, thrust2: -1, cruise: 245, d: 0.343, cd0: 0.28, maxG: 9, cnMax: 4, nav: 3, gimbal: 45, seekerCone: 35, seekerRange: 18000, pitbull: 15000, seaSkim: 10, popup: true, fuzeR: 4, killR: 10, dmgR: 25, dmg: 1400, life: 420, smoke: 0.6, ship: true },
  agm88: { name: 'AGM-88', short: 'ARM', model: 'agm88', seeker: 'arm', mass: 360, prop: 100, burn1: 2.6, thrust1: 42000, burn2: 6, thrust2: 8000, d: 0.254, cd0: 0.3, maxG: 25, cnMax: 6, nav: 4, gimbal: 60, loft: true, fuzeR: 9, killR: 8, dmgR: 22, dmg: 260, life: 90, smoke: 0.3, ground: true },
  gbu12: { name: 'GBU-12', short: 'LGB', model: 'gbu12', seeker: 'laser', mass: 230, prop: 0, burn1: 0, thrust1: 0, d: 0.273, cd0: 0.24, maxG: 3, cnMax: 2.0, nav: 3, gimbal: 30, fuzeR: 0, killR: 9, dmgR: 32, dmg: 520, life: 120, bomb: true },
  gbu39: { name: 'GBU-39', short: 'SDB', model: 'gbu39', seeker: 'gps', mass: 130, prop: 0, burn1: 0, thrust1: 0, burn2: 0, thrust2: 0, d: 0.19, cd0: 0.15, maxG: 4, cnMax: 3.6, nav: 3, gimbal: 180, fuzeR: 0, killR: 7, dmgR: 18, dmg: 420, life: 220, bomb: true, sdb: true },
  gbu31: { name: 'GBU-31', short: 'JDAM', model: 'gbu31', seeker: 'gps', mass: 960, prop: 0, burn1: 0, thrust1: 0, burn2: 0, thrust2: 0, d: 0.37, cd0: 0.21, maxG: 3.5, cnMax: 2.4, nav: 3, gimbal: 180, fuzeR: 0, killR: 10, dmgR: 34, dmg: 2600, life: 160, bomb: true, big: true, penetrator: true },
  mk84: { name: 'MK-84', short: 'BOMB', model: 'mk84', seeker: 'none', mass: 900, prop: 0, burn1: 0, thrust1: 0, d: 0.457, cd0: 0.22, maxG: 0, cnMax: 0, fuzeR: 0, killR: 16, dmgR: 65, dmg: 1600, life: 120, bomb: true, big: true },
  cbu: { name: 'CBU-97', short: 'CBU', model: 'cbu', seeker: 'none', mass: 420, prop: 0, burn1: 0, thrust1: 0, d: 0.4, cd0: 0.3, maxG: 0, cnMax: 0, fuzeR: 0, killR: 6, dmgR: 15, dmg: 200, life: 120, bomb: true, cluster: 10 },
  // red / other
  r77: { name: 'R-77', short: 'AA12', model: 'r77', seeker: 'arh', eccm: 0.3, mass: 175, prop: 55, burn1: 3.0, thrust1: 28000, burn2: 4, thrust2: 6000, d: 0.2, cd0: 0.34, maxG: 30, cnMax: 6, nav: 3.5, gimbal: 50, seekerCone: 25, seekerRange: 16000, pitbull: 14000, loft: true, fuzeR: 12, killR: 8, dmgR: 24, dmg: 100, life: 75, smoke: 0.4 },
  r73: { name: 'R-73', short: 'AA11', model: 'r73', seeker: 'ir', mass: 105, prop: 35, burn1: 4.5, thrust1: 13000, burn2: 0, thrust2: 0, d: 0.17, cd0: 0.36, maxG: 35, cnMax: 7, nav: 3.5, gimbal: 60, fov: 5, flareResist: 0.5, fuzeR: 7, killR: 5, dmgR: 16, dmg: 100, life: 22, smoke: 0.6 },
  s400: { name: '48N6', short: 'SA21', model: 'sam_big', seeker: 'cmd', mass: 1800, prop: 700, burn1: 8, thrust1: 150000, burn2: 0, thrust2: 0, d: 0.52, cd0: 0.42, maxG: 22, cnMax: 5, nav: 3.5, gimbal: 60, loft: true, fuzeR: 14, killR: 8, dmgR: 24, dmg: 120, life: 60, smoke: 1.0, vertical: true },
  tor: { name: '9M330', short: 'SA15', model: 'sam_small', seeker: 'cmd', mass: 165, prop: 55, burn1: 3.0, thrust1: 30000, burn2: 0, thrust2: 0, d: 0.235, cd0: 0.34, maxG: 30, cnMax: 7, nav: 4, gimbal: 70, fuzeR: 9, killR: 6, dmgR: 18, dmg: 90, life: 20, smoke: 0.9, vertical: true, antiMissile: true },
  igla: { name: 'IGLA', short: 'SA18', model: 'igla', seeker: 'ir', mass: 10.8, prop: 3, burn1: 2.2, thrust1: 1500, burn2: 0, thrust2: 0, d: 0.072, cd0: 0.4, maxG: 18, cnMax: 7, nav: 3.5, gimbal: 40, fov: 3, flareResist: 0.35, fuzeR: 3, killR: 3, dmgR: 8, dmg: 70, life: 15, smoke: 1.0 },
};

// ------------------------------------------------------------------------------------------
export class Missile {
  constructor(game, defKey, o) {
    this.game = game; this.def = DEFS[defKey]; this.key = defKey;
    const d = this.def;
    this.team = o.team; this.shooter = o.shooter; this.target = o.target || null; this.targetPoint = o.targetPoint ? o.targetPoint.clone() : null;
    this.radar = o.radar || null; // guiding radar (cmd / datalink)
    this.pos = o.pos.clone(); this.vel = o.vel.clone(); this.t = 0; this.dead = false; this.alive = true;
    this.mass = d.mass; this.motorOn = d.burn1 > 0;
    this.quat = o.quat ? o.quat.clone() : new THREE.Quaternion();
    this.seekerDir = o.seekerDir ? o.seekerDir.clone() : (this.target ? this.target.pos.clone().sub(this.pos).normalize() : this.vel.clone().normalize());
    this.track = this.target; // object currently tracked by the seeker (target / flare / chaff)
    this.lastKnown = this.target ? this.target.pos.clone() : (this.targetPoint ? this.targetPoint.clone() : this.pos.clone().addScaledVector(this.vel, 20));
    this.lastKnownVel = this.target ? this.target.vel.clone() : new THREE.Vector3();
    this.active = false; this.lostT = 0; this.manual = false; this.manualCmd = new THREE.Vector2();
    this.aCmd = new THREE.Vector3(); this.kind = 'missile'; this.rcs = 0.1; this.radius = 1.5;
    this.closing = 0; this.tti = 0; this.signal = 1; this.decoyed = false; this.popState = 0;
    this.ir = 12; this.label = d.short;
    // visuals
    const mdl = buildMunition(d.model); this.model = mdl; game.scene.add(mdl.root);
    this.syncModel();
    this.trail = d.smoke ? game.fx.trails.create({ kind: 'missile', width: 1.2 + d.d * 3, opacity: d.smoke, color: d.smoke > 0.8 ? [0.95, 0.95, 0.95] : [0.85, 0.85, 0.85] }) : null;
    if (this.radar) this.radar.guiding.add(this);
    this.boosterAudio = game.audio.createSource('rocket');
    this.isMissile = true; this.cluster = d.cluster || 0; this.id = Math.random();
    game.audio.missileLaunch(this.pos, d.vertical ? 'bigsam' : (defKey === 'igla' ? 'manpads' : 'aam'));
  }

  get rho() { return rhoAt(this.pos.y); }

  syncModel() {
    const v = this.vel; const sp = v.length();
    if (sp > 1) {
      const dir = _v.copy(v).multiplyScalar(1 / sp);
      // nose points along velocity, slightly toward commanded acceleration (angle of attack)
      const aoa = Math.min(this.aCmd.length() / 2500, 0.12);
      if (aoa > 0.001) dir.addScaledVector(_v2.copy(this.aCmd).normalize(), aoa).normalize();
      const up = Math.abs(dir.y) > 0.98 ? _v2.set(1, 0, 0) : _v2.set(0, 1, 0);
      _m.lookAt(_v3.set(0, 0, 0), dir, up); // object -Z faces dir
      this.quat.setFromRotationMatrix(_m);
    }
    this.model.root.position.copy(this.pos); this.model.root.quaternion.copy(this.quat);
  }

  thrust() {
    const d = this.def, t = this.t;
    if (t < d.burn1) return d.thrust1;
    if (t < d.burn1 + d.burn2) {
      if (d.thrust2 < 0) { // turbojet holding cruise speed
        const sp = this.vel.length(); const q = 0.5 * this.rho * sp * sp; const S = Math.PI * d.d * d.d / 4;
        return Math.max(0, q * S * cdM(sp / soundAt(this.pos.y), d.cd0) * 1.1 + (d.cruise - sp) * this.mass * 0.6);
      }
      return d.thrust2;
    }
    return 0;
  }

  // ---------------- seekers ----------------
  irSeeker(dt) {
    const d = this.def; const g = this.game;
    // candidate sources inside the instantaneous FOV around the seeker line of sight
    const fov = Math.cos(d.fov * D2R);
    let best = null, bestW = 0;
    const consider = (obj, intensity, isFlare) => {
      _v.copy(obj.pos).sub(this.pos); const R = _v.length(); if (R < 1) return; _v.multiplyScalar(1 / R);
      const c = _v.dot(this.seekerDir); if (c < fov) return;
      const atten = Math.exp(-R / 14000) * g.cloudTransmittance(this.pos, obj.pos);
      let w = intensity * atten * (0.4 + 0.6 * (c - fov) / (1 - fov));
      if (isFlare) w *= 1 - d.flareResist * 0.85;
      if (w > bestW) { bestW = w; best = obj; }
    };
    const tgt = this.target;
    if (tgt && tgt.alive) consider(tgt, tgt.irIntensity(this.pos), false);
    for (const f of g.world.flares) if (f.age < f.life) consider(f, f.intensity, true);
    // other hot aircraft
    for (const e of g.world.entities) if (e.alive && e.kind === 'air' && e !== tgt && e.team !== this.team) consider(e, e.irIntensity(this.pos), false);
    // the sun can capture IR seekers looking near it
    const sd = g.sunDir; if (sd.y > -0.05 && sd.dot(this.seekerDir) > Math.cos(3.5 * D2R)) { const s = 60 * (1 - d.flareResist); if (s > bestW) { bestW = s; best = { pos: this.pos.clone().addScaledVector(sd, 50000), vel: new THREE.Vector3(), sun: true }; } }
    if (best && bestW > 0.02) {
      this.track = best; this.lostT = 0;
      this.decoyed = best !== tgt && !best.isAirEntity;
      this.lastKnown.copy(best.pos); this.lastKnownVel.copy(best.vel || _v.set(0, 0, 0));
      // slew seeker toward tracked object (rate limited)
      _v.copy(best.pos).sub(this.pos).normalize();
      const ang = Math.acos(THREE.MathUtils.clamp(_v.dot(this.seekerDir), -1, 1));
      const maxStep = 60 * D2R * dt;
      if (ang > 1e-5) this.seekerDir.lerp(_v, Math.min(1, maxStep / ang)).normalize();
      this.signal = Math.min(1, bestW / 2);
    } else {
      this.lostT += dt; this.signal = 0;
      this.track = null;
    }
    // gimbal limit
    const fwd = _v2.copy(this.vel).normalize();
    if (fwd.dot(this.seekerDir) < Math.cos(d.gimbal * D2R)) { this.track = null; this.lostT = 99; }
  }

  radarSeeker(dt) {
    const d = this.def; const g = this.game; const tgt = this.target;
    if (!tgt) return;
    const R = this.pos.distanceTo(tgt.alive ? tgt.pos : this.lastKnown);
    // midcourse: datalink from the launching radar's track if still held
    if (!this.active) {
      let link = false;
      if (this.shooter && this.shooter.isPlayer) link = g.player.radar.stt === tgt && tgt.alive;
      else if (this.radar) link = this.radar.stt === tgt && tgt.alive;
      if (link) { this.lastKnown.copy(tgt.pos); this.lastKnownVel.copy(tgt.vel); this.datalink = true; }
      else { this.datalink = false; this.lastKnown.addScaledVector(this.lastKnownVel, dt); }
      this.track = null;
      if (R < d.pitbull) {
        this.active = true;
        if (this.shooter && this.shooter.isPlayer) { g.msg('MISSILE TRACKING ON ITS OWN', 1.5); g.audio.speak('Pitbull', { voice: 'radio' }); }
        if (tgt.onMissileActive) tgt.onMissileActive(this);
      }
      return;
    }
    // active seeker: own radar with Doppler notch & chaff. A ship is always slow enough to sit in the notch, so an
    // anti-ship seeker doesn't use one, and it looks at the superstructure (a ship's position is on the waterline,
    // which a line of sight with clearance never reaches)
    const ship = tgt.kind === 'ship';
    const seen = tgt.alive && this.pos.distanceTo(tgt.pos) < d.seekerRange &&
      _v.copy(tgt.pos).sub(this.pos).normalize().dot(_v2.copy(this.vel).normalize()) > Math.cos(d.seekerCone * D2R) &&
      (ship || !inNotch(g.terrain, this.pos, tgt.pos, tgt.vel, 24)) && g.terrain.lineOfSight(this.pos, ship ? _v3.copy(tgt.pos).setY(tgt.pos.y + 15) : tgt.pos, true, 1);
    if (this.track && this.track.isChaff) {
      // already seduced: follow chaff until it fades, then try to reacquire
      if (this.track.age > 5) this.track = null; else { this.lastKnown.copy(this.track.pos); this.lastKnownVel.copy(this.track.vel); return; }
    }
    if (seen) {
      // chaff dispensed near a notching target can steal the track
      for (const c of g.world.chaff) {
        if (c.age > 2.0 || c.used.has(this)) continue;
        if (c.pos.distanceTo(tgt.pos) < 300) {
          c.used.add(this);
          const vr = Math.abs(radialSpeed(this.pos, tgt.pos, tgt.vel));
          const p = (vr < 55 ? 0.7 : vr < 150 ? 0.22 : 0.06) * (1 - (this.def.eccm || 0));
          if (Math.random() < p) { this.track = c; this.decoyed = true; return; }
        }
      }
      this.track = tgt; this.lostT = 0; this.decoyed = false;
      this.lastKnown.copy(tgt.pos); this.lastKnownVel.copy(tgt.vel);
    } else {
      this.track = null; this.lostT += dt;
      let link = false;
      if (this.shooter && this.shooter.isPlayer) link = g.player.radar.stt === tgt && tgt.alive;
      else if (this.radar) link = this.radar.stt === tgt && tgt.alive;
      this.datalink = link;
      if (link) { this.lastKnown.copy(tgt.pos); this.lastKnownVel.copy(tgt.vel); }
      else this.lastKnown.addScaledVector(this.lastKnownVel, dt);
    }
  }

  cmdSeeker(dt) {
    // command guidance: needs the ground radar's continuous track
    const r = this.radar; const tgt = this.target;
    if (r && r.owner.alive && r.stt === tgt && tgt && tgt.alive) {
      this.track = tgt; this.lostT = 0; this.lastKnown.copy(tgt.pos); this.lastKnownVel.copy(tgt.vel);
    } else if (r && r.decoyed && r.decoyed.age < 5) {
      this.track = r.decoyed; this.lastKnown.copy(r.decoyed.pos); this.lastKnownVel.copy(r.decoyed.vel);
    } else { this.track = null; this.lostT += dt; this.lastKnown.addScaledVector(this.lastKnownVel, dt); }
  }

  tvSeeker(dt) {
    const tgt = this.target; const g = this.game;
    const tp = tgt && tgt.alive ? tgt.pos : this.targetPoint;
    if (!tp) return;
    const visible = g.terrain.lineOfSight(this.pos, _v4.copy(tp).add(_v5.set(0, 2, 0)), false, 0) && g.cloudTransmittance(this.pos, tp) > 0.3;
    if (visible) { this.lastKnown.copy(tp); if (tgt && tgt.alive) this.lastKnownVel.copy(tgt.vel); this.lostT = 0; this.track = tgt || { pos: tp, vel: _v.set(0, 0, 0) }; }
    else { this.lostT += dt; this.track = null; }
  }

  laserSeeker(dt) {
    const g = this.game; let best = null, bestD = 1e9;
    const fwd = _v2.copy(this.vel).normalize();
    for (const s of g.world.laserSpots) {
      if (!s.on) continue;
      _v.copy(s.pos).sub(this.pos); const R = _v.length(); _v.multiplyScalar(1 / R);
      if (_v.dot(fwd) < Math.cos(this.def.gimbal * D2R)) continue;
      if (!g.terrain.lineOfSight(this.pos, _v4.copy(s.pos).add(_v5.set(0, 1.5, 0)), false, 0)) continue;
      if (R < bestD) { bestD = R; best = s; }
    }
    if (best) { this.lastKnown.copy(best.pos); this.lastKnownVel.copy(best.vel || _v.set(0, 0, 0)); this.track = best; this.lostT = 0; }
    else { this.track = null; this.lostT += dt; }
  }

  armSeeker(dt) {
    const tgt = this.target;
    if (tgt && tgt.alive && tgt.radar && tgt.radar.on) { this.lastKnown.copy(tgt.radar.pos); this.lastKnownVel.copy(tgt.vel); this.track = tgt; this.lostT = 0; }
    else { this.track = null; this.lostT += dt; }
  }

  // ---------------- guidance ----------------
  proNav(tp, tv, N, out) {
    // a_c = N * Vc * (Omega x u_m)
    const r = _v.copy(tp).sub(this.pos);
    const vr = _v2.copy(tv).sub(this.vel);
    const R2 = Math.max(r.lengthSq(), 1);
    const Om = _v3.copy(r).cross(vr).multiplyScalar(1 / R2);
    const R = Math.sqrt(R2);
    const Vc = -r.dot(vr) / R;
    this.closing = Vc;
    const um = _v4.copy(this.vel).normalize();
    out.copy(Om).cross(um).multiplyScalar(N * Math.max(Vc, 150));
    this.tti = Vc > 1 ? R / Vc : 99;
    return out;
  }

  guidance(dt, out) {
    out.set(0, 0, 0);
    const d = this.def; const g = this.game;
    if (this.t < 0.25 && !d.vertical) return out; // safe separation
    if (d.vertical && this.t < 1.2) { // vertical launch kick-over
      const goal = _v.copy(this.lastKnown).sub(this.pos); goal.y = Math.max(goal.y, goal.length() * 0.35); goal.normalize();
      const vh = _v2.copy(this.vel).normalize();
      return out.copy(goal).sub(vh.multiplyScalar(goal.dot(vh))).multiplyScalar(this.vel.length() * 2.5);
    }
    if (this.manual) {
      const sp = this.vel.length(); const fwd = _v.copy(this.vel).normalize();
      const right = _v2.copy(fwd).cross(_v3.set(0, 1, 0)).normalize(); const up = _v3.copy(right).cross(fwd).normalize();
      out.copy(right).multiplyScalar(this.manualCmd.x * sp * 0.9).addScaledVector(up, this.manualCmd.y * sp * 0.9);
      out.addScaledVector(up, G0 * up.y); // gravity compensation: neutral stick flies straight
      return out;
    }
    if (d.seeker === 'none' || (d.seeker === 'gps' && !this.targetPoint)) return out;
    const tp = _v5.copy(this.lastKnown); const tv = this.lastKnownVel;
    // GPS bomb: glide on the line of sight, then bunt into a steep terminal dive so the penetrator goes in nose-first
    if (d.seeker === 'gps') {
      const flat = Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z), above = this.pos.y - tp.y;
      if (flat > above * 0.9 && flat > 900) tp.y += Math.min(flat * (d.sdb ? 0.2 : 0.12), d.sdb ? 1600 : 600) * Math.min(1, (flat - 900) / 1500);
    }
    const R = this.pos.distanceTo(tp);
    // sea-skimming profile: down to the waves, a pop-up near the ship, then a dive onto it
    if (d.seaSkim) {
      if (d.popup && R <= 1200 && g.terrain.lineOfSight(this.pos, _v3.copy(tp).setY(tp.y + 15), false, 0)) { // the dive (once clear of any hill): plain proportional navigation onto the target
        this.proNav(tp, tv, 4, out);
        const vh = _v.copy(this.vel).normalize(), gc = _v2.set(0, G0, 0); gc.addScaledVector(vh, -gc.dot(vh));
        return out.add(gc);
      }
      // near a coast it climbs over the land ahead
      const H = g.terrain, p = this.pos, v = this.vel;
      const floor = Math.max(g.ocean.heightAt(p.x, p.z, g.time), H.heightAt(p.x, p.z), H.heightAt(p.x + v.x * 2.5, p.z + v.z * 2.5), H.heightAt(p.x + v.x * 5, p.z + v.z * 5));
      const hT = floor + (d.popup && R < 4500 ? 180 : d.seaSkim);
      const flat = _v.copy(tp).sub(this.pos); flat.y = 0;
      const aim = _v4.copy(this.pos).addScaledVector(flat.normalize(), Math.max(400, this.vel.length() * 3));
      this.proNav(aim, _v2.set(0, 0, 0), 3, out);
      // the navigation only steers sideways; the height is held through a climb/sink rate the small wings can manage
      // (fast descent from high up, gentle near the waves), plus gravity. Before, it sagged into the waves, and a launch
      // from a jet's height dived straight into the sea
      const h = this.pos.y - hT;
      out.y = (THREE.MathUtils.clamp(-h * 0.25, -(30 + Math.max(0, h) * 0.05), 40) - this.vel.y) * 1.5 + G0;
      this.tti = R / Math.max(this.vel.length(), 1);
      return out;
    }
    // loft (long range shots climb into thin air)
    if (d.loft && R > 18000 && !this.active) tp.y += Math.min(R * 0.16, 7000);
    this.proNav(tp, tv, d.nav || 4, out);
    // gravity compensation
    const vh = _v.copy(this.vel).normalize();
    const gc = _v2.set(0, G0, 0); gc.addScaledVector(vh, -gc.dot(vh));
    out.add(gc);
    return out;
  }

  // ---------------- step ----------------
  update(dt) {
    if (this.dead) return;
    const d = this.def, g = this.game;
    this.t += dt;
    if (this.t > d.life) return this.destroy('timeout');
    // propulsion
    const T = this.thrust();
    this.motorOn = T > 0;
    if (T > 0 && d.prop) { const burnTotal = d.burn1 + (d.thrust2 > 0 ? d.burn2 : 0); if (this.t < burnTotal) this.mass -= d.prop / burnTotal * dt; }
    // seeker
    switch (d.seeker) {
      case 'ir': this.irSeeker(dt); break;
      case 'arh': this.radarSeeker(dt); break;
      case 'cmd': this.cmdSeeker(dt); break;
      case 'tv': this.tvSeeker(dt); break;
      case 'laser': this.laserSeeker(dt); break;
      case 'arm': this.armSeeker(dt); break;
      case 'gps': if (this.targetPoint && this.target && this.target.alive) this.targetPoint.copy(this.target.pos);
        if (this.targetPoint) { this.lastKnown.copy(this.targetPoint); this.lastKnownVel.set(0, 0, 0); this.track = this.target && this.target.alive ? this.target : null; this.lostT = 0; } break;
    }
    // command-guided missiles without a track self-destruct
    if (d.seeker === 'cmd' && this.lostT > 4) return this.destroy('selfdestruct');
    if (d.seeker === 'ir' && this.lostT > 3 && !this.manual) { /* ballistic, keeps flying */ }
    const sp = this.vel.length();
    const rho = this.rho; const a = soundAt(this.pos.y); const M = sp / a;
    const q = 0.5 * rho * sp * sp; const S = Math.PI * d.d * d.d / 4;
    // guidance command, limited by aerodynamic and structural load
    const lost = (d.seeker === 'ir' && !this.track && this.lostT > 0.3) || (d.seeker === 'laser' && !this.track);
    if (lost && !this.manual) this.aCmd.set(0, 0, 0); else this.guidance(dt, this.aCmd);
    const aMax = Math.min(d.maxG * G0, d.cnMax * q * S / this.mass);
    const ac = this.aCmd.length();
    if (ac > aMax) this.aCmd.multiplyScalar(aMax / ac);
    const aLat = Math.min(ac, aMax);
    // drag: parasite + induced (lift-dependent) -> energy bleed in hard turns
    const qS = Math.max(q * S, 1);
    const drag = (qS * cdM(M, d.cd0) + 0.07 * Math.pow(this.mass * aLat, 2) / qS) / this.mass;
    const vhat = _v.copy(this.vel).multiplyScalar(1 / Math.max(sp, 1));
    const acc = _v2.copy(vhat).multiplyScalar(T / this.mass - drag).add(this.aCmd);
    acc.y -= G0;
    const p0 = _v3.copy(this.pos);
    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);
    // cluster bomb: dispense submunitions above the target area
    if (this.cluster && this.t > 1.0) {
      const agl = this.pos.y - Math.max(g.terrain.heightAt(this.pos.x, this.pos.z), 0);
      if (agl < 350) { g.dispenseCluster(this); return this.destroy('dispensed', true); }
    }
    // proximity fuze vs target / any enemy aircraft or missile nearby
    if (d.fuzeR > 0 && this.t > 0.6) {
      const check = (obj) => {
        if (!obj || !obj.alive && !obj.isMissile) return false;
        const r0 = _v4.copy(obj.pos).sub(p0); const rv = _v5.copy(obj.vel).sub(this.vel);
        const vv = rv.lengthSq(); let tau = vv > 1e-6 ? -r0.dot(rv) / vv : 0; tau = Math.max(0, Math.min(dt, tau));
        const dmin = r0.addScaledVector(rv, tau).length();
        const fr = obj.hitDistance ? d.fuzeR + (obj.radius || 5) * 0.4 : d.fuzeR;
        if (dmin < fr) { this.pos.copy(p0).addScaledVector(this.vel, tau); return true; }
        return false;
      };
      if (this.target && (this.target.alive || this.target.isMissile) && !this.target.dead && check(this.target)) return this.detonate();
      if (!d.ground && !d.ship) {
        for (const e of g.world.entities) {
          if (e.kind !== 'air' || e.team === this.team || !e.alive || e === this.target) continue;
          if (e.pos.distanceToSquared(this.pos) < 2500 && check(e)) return this.detonate();
        }
      }
    }
    // impact with ships (hit spheres), ground targets, terrain, water
    if (this.t > 0.3) {
      for (const e of g.world.entities) {
        if (!e.alive || e.team === this.team || (e.kind !== 'ship' && e.kind !== 'ground' && e.kind !== 'sam' && e.kind !== 'structure')) continue;
        if (e.pos.distanceToSquared(this.pos) > (e.radius + 40) ** 2) continue;
        if (e.hitDistance(this.pos) < 0.5) return this.detonate(e);
      }
      const th = g.terrain.heightAt(this.pos.x, this.pos.z);
      if (this.pos.y < th) { this.pos.y = th; return this.detonate(null, 'ground'); }
      if (th < 0.5) { const wh = g.ocean.heightAt(this.pos.x, this.pos.z, g.time); if (this.pos.y < wh) { this.pos.y = wh; return this.detonate(null, 'water'); } }
    }
    // energy depleted
    if (!this.motorOn && sp < 140 && !d.bomb && this.t > 5) return this.destroy('energy');
    this.syncModel();
    // fins follow commanded acceleration in body frame
    if (this.model.fins.length) {
      _q.copy(this.quat).invert(); const ab = _v4.copy(this.aCmd).applyQuaternion(_q);
      setFins(this.model.fins, ab.x, ab.y, 0);
    }
    if (this.trail) { if (this.motorOn || (d.smoke > 0.9 && this.t < d.burn1 + 3)) this.trail.add(this.pos); else this.trail.stop(); }
    if (this.boosterAudio) this.boosterAudio.update(this.pos, this.vel, { intensity: this.motorOn ? 1 : 0.15 });
    this.ir = this.motorOn ? 25 : 2;
  }

  detonate(hitEntity, surface) {
    if (this.dead) return;
    const d = this.def, g = this.game;
    const p = this.pos.clone();
    const size = d.big ? 9 : d.ship ? 8 : d.bomb ? 7 : d.ground ? 5 : d.vertical ? 4 : 3;
    g.fx.explosion(p, size, { surface: surface || (hitEntity ? 'target' : 'air'), water: surface === 'water' });
    g.world.blast = { penetrator: !!d.penetrator, weapon: this.key };
    g.world.damageArea(p, d.killR, d.dmgR, d.dmg, this.shooter, { killsMissiles: true, ignoreMissile: this, shipMul: d.ship ? 1 : 0.4 });
    if (hitEntity && hitEntity.alive) hitEntity.damage(d.dmg * 0.5, this.shooter, p);
    g.world.blast = null;
    if (g.mission && g.mission.onWeaponImpact && this.team === 'blue') g.mission.onWeaponImpact(this, p);
    if (d.penetrator) { // delayed-fuze secondary blast bursting out of the structure
      setTimeout(() => g.fx.explosion(p.clone().add(new THREE.Vector3(0, 6, 0)), 8, { surface: 'target' }), 120);
    }
    if (surface === 'ground' && (d.bomb || d.ground)) g.terrain.addCrater(p.x, p.z, d.big ? 14 : 7);
    if (surface === 'water') g.ocean.addSplash(p.x, p.z, d.big ? 12 : 6);
    this.destroy('detonated', true);
  }

  destroy(reason, silent) {
    if (this.dead) return;
    this.dead = true; this.alive = false; this.reason = reason;
    if (!silent && reason !== 'timeout') this.game.fx.explosion(this.pos.clone(), 2, { surface: 'air' });
    if (!silent && reason === 'timeout') this.game.fx.explosion(this.pos.clone(), 1.5, { surface: 'air' });
    this.game.scene.remove(this.model.root);
    if (this.trail) this.trail.stop();
    if (this.radar) this.radar.guiding.delete(this);
    if (this.boosterAudio) this.boosterAudio.stop();
    this.game.onMissileGone(this);
  }
}

// ------------------------------------------------------------------------------------------
// Countermeasures
export class Flare {
  constructor(game, pos, vel) {
    this.game = game; this.pos = pos.clone(); this.vel = vel.clone(); this.age = 0; this.life = 4.2; this.intensity = 22; this.isFlare = true;
  }
  update(dt) {
    this.age += dt;
    const sp = this.vel.length();
    this.vel.multiplyScalar(Math.max(0, 1 - dt * (0.9 + sp * 0.004)));
    this.vel.y -= G0 * dt * 0.6;
    this.pos.addScaledVector(this.vel, dt);
    this.intensity = 26 * Math.pow(Math.max(0, 1 - this.age / this.life), 0.5);
  }
}
export class Chaff {
  constructor(game, pos, vel) { this.game = game; this.pos = pos.clone(); this.vel = vel.clone(); this.age = 0; this.life = 7; this.used = new Set(); this.isChaff = true; this.rcs = 60; }
  update(dt) {
    this.age += dt;
    const w = this.game.wind;
    this.vel.lerp(w, Math.min(1, dt * 2.2)); this.vel.y -= 0.8 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.rcs = 60 * Math.exp(-this.age / 3);
  }
}

// ------------------------------------------------------------------------------------------
// 20 mm ballistics (struct-of-arrays pool)
export class Bullets {
  constructor(game, max = 4000) {
    this.game = game; this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.life = new Float32Array(max);
    this.team = new Uint8Array(max); this.dmg = new Float32Array(max); this.tracer = new Uint8Array(max); this.k = new Float32Array(max);
    this.owner = new Array(max); this.antiMissile = new Uint8Array(max);
  }
  spawn(pos, vel, team, dmg, tracer, owner, k = 5.7e-4, antiMissile = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.p[i * 3] = pos.x; this.p[i * 3 + 1] = pos.y; this.p[i * 3 + 2] = pos.z;
    this.v[i * 3] = vel.x; this.v[i * 3 + 1] = vel.y; this.v[i * 3 + 2] = vel.z;
    this.life[i] = 3.2; this.team[i] = team === 'blue' ? 0 : 1; this.dmg[i] = dmg; this.tracer[i] = tracer ? 1 : 0; this.owner[i] = owner; this.k[i] = k; this.antiMissile[i] = antiMissile;
  }
  kill(i) {
    const j = --this.n;
    if (i !== j) {
      for (let c = 0; c < 3; c++) { this.p[i * 3 + c] = this.p[j * 3 + c]; this.v[i * 3 + c] = this.v[j * 3 + c]; }
      this.life[i] = this.life[j]; this.team[i] = this.team[j]; this.dmg[i] = this.dmg[j]; this.tracer[i] = this.tracer[j]; this.owner[i] = this.owner[j]; this.k[i] = this.k[j]; this.antiMissile[i] = this.antiMissile[j];
    }
  }
  update(dt) {
    const g = this.game, P = this.p, V = this.v; const w = g.wind;
    const ents = g.world.entities; const mis = g.world.missiles;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); i--; continue; }
      const x0 = P[i * 3], y0 = P[i * 3 + 1], z0 = P[i * 3 + 2];
      let vx = V[i * 3], vy = V[i * 3 + 1], vz = V[i * 3 + 2];
      // drag on air-relative velocity (windage)
      const ax = vx - w.x, ay = vy - w.y, az = vz - w.z; const sp = Math.sqrt(ax * ax + ay * ay + az * az);
      const kk = this.k[i] * rhoAt(y0) / 1.225 * sp;
      vx -= ax * kk * dt; vy -= ay * kk * dt + G0 * dt; vz -= az * kk * dt;
      V[i * 3] = vx; V[i * 3 + 1] = vy; V[i * 3 + 2] = vz;
      const x1 = x0 + vx * dt, y1 = y0 + vy * dt, z1 = z0 + vz * dt;
      P[i * 3] = x1; P[i * 3 + 1] = y1; P[i * 3 + 2] = z1;
      const team = this.team[i] === 0 ? 'blue' : 'red';
      // segment vs entities
      let hit = false;
      const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0; const sl2 = sx * sx + sy * sy + sz * sz;
      for (let k = 0; k < ents.length && !hit; k++) {
        const e = ents[k]; if (!e.alive || e.team === team) continue;
        const ex = e.pos.x - x0, ey = e.pos.y - y0, ez = e.pos.z - z0;
        const R = e.radius + 2;
        if (ex * ex + ey * ey + ez * ez > (Math.sqrt(sl2) + R) ** 2) continue;
        let t = (ex * sx + ey * sy + ez * sz) / sl2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        _v.set(x0 + sx * t, y0 + sy * t, z0 + sz * t);
        if (e.hitDistance(_v) < 0.6) { e.damage(this.dmg[i], this.owner[i], _v); g.fx.bulletHit(_v, e.kind === 'ship' ? 'metal' : 'metal'); hit = true; if (this.owner[i] === g.player) g.audio.hitTick(); }
      }
      if (!hit && this.antiMissile[i]) {
        for (const m of mis) {
          if (m.dead || m.team === team) continue;
          const ex = m.pos.x - x0, ey = m.pos.y - y0, ez = m.pos.z - z0;
          let t = (ex * sx + ey * sy + ez * sz) / sl2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = x0 + sx * t - m.pos.x, dy = y0 + sy * t - m.pos.y, dz = z0 + sz * t - m.pos.z;
          if (dx * dx + dy * dy + dz * dz < 2.2 * 2.2) { m.destroy('shot'); hit = true; break; }
        }
      }
      if (!hit) {
        const th = g.terrain.heightAt(x1, z1);
        if (y1 < th) { g.fx.bulletImpact(_v.set(x1, th, z1), 'ground'); hit = true; }
        else if (y1 < 1.5 && th < 0) { const wh = g.ocean.heightAt(x1, z1, g.time); if (y1 < wh) { g.fx.bulletImpact(_v.set(x1, wh, z1), 'water'); hit = true; } }
      }
      if (hit) { this.kill(i); i--; }
    }
  }
}

// ------------------------------------------------------------------------------------------
// Fire-control solutions
export function predictBallistic(game, pos, vel, mass, d, cd0, maxT = 60, step = 0.05) {
  const p = pos.clone(), v = vel.clone(); const S = Math.PI * d * d / 4; let t = 0;
  const w = game.wind;
  while (t < maxT) {
    const rho = rhoAt(p.y); const ax = v.x - w.x, ay = v.y, az = v.z - w.z; const sp = Math.sqrt(ax * ax + ay * ay + az * az);
    const k = 0.5 * rho * sp * cd0 * S / mass;
    v.x -= ax * k * step; v.y -= (ay * k + G0) * step; v.z -= az * k * step;
    p.addScaledVector(v, step); t += step;
    const g = Math.max(game.terrain.heightAt(p.x, p.z), 0);
    if (p.y <= g) { p.y = g; return { point: p, time: t, vel: v }; }
  }
  return null;
}

// Gun: lead-computing sight (pipper the pilot puts on the target), returns world direction of pipper
export function lcosSolution(shooterPos, shooterVel, gunDir, target, tgtAccel, v0 = 1030) {
  const rel = _v.copy(target.pos).sub(shooterPos); let R = rel.length();
  let tf = R / v0;
  const fut = _v2.copy(target.pos);
  for (let i = 0; i < 4; i++) {
    const eff = v0 * (1 - 0.00028 * R); // average speed falls with range (drag)
    tf = R / Math.max(eff, 300);
    fut.copy(target.pos).addScaledVector(target.vel, tf).addScaledVector(tgtAccel, 0.5 * tf * tf);
    R = fut.distanceTo(shooterPos);
  }
  // required aim direction (bullets inherit shooter velocity, fall under gravity)
  const aim = _v3.copy(fut).sub(shooterPos).addScaledVector(shooterVel, -tf); aim.y += 0.5 * G0 * tf * tf;
  aim.normalize();
  const los = _v4.copy(target.pos).sub(shooterPos).normalize();
  // pipper = gun line minus the lead/drop offset: target under pipper => bullets hit
  const pip = new THREE.Vector3().copy(gunDir).sub(aim).add(los).normalize();
  return { dir: pip, tof: tf, range: R };
}

// Missile launch zone estimate (Rmax, Rne, Rmin) in meters
export function launchZone(defKey, shooterAlt, shooterSpeed, closing, aspectCos) {
  const base = { aim9x: [16000, 7000, 600], aim120: [72000, 28000, 1500], r77: [55000, 22000, 1200], r73: [14000, 6000, 500] }[defKey] || [10000, 5000, 500];
  const altF = 0.55 + 0.45 * Math.min(1, shooterAlt / 9000) * 1.6;
  const spdF = 0.75 + Math.min(0.6, shooterSpeed / 600);
  const asp = 0.6 + 0.4 * (0.5 + 0.5 * aspectCos); // head-on extends range
  return { rmax: base[0] * altF * spdF * asp * 0.85, rne: base[1] * altF * asp, rmin: base[2] };
}
