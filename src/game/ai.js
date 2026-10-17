// AI: enemy fighters (energy-based point-mass flight + BVR/WVR/defensive behaviour), SAM batteries
// (search -> track -> launch, command guidance, HARM-aware emission control), point-defense SAM that
// engages incoming missiles, radar-directed SPAAG flak, armor that drives and duels.
import * as THREE from 'three';
import { Entity } from './world.js';
import { Radar, inNotch } from '../sim/radar.js';
import { Missile, Flare, Chaff, DEFS } from '../sim/weapons.js';
import { rhoAt, soundAt, G0 } from '../sim/atmo.js';
import { buildEnemyFighter, buildSAMLauncher, buildSAMRadar, buildMBT, buildAPC, buildSPAAG, buildTruck } from '../models/units.js';
import { AfterburnerFlame } from '../fx/fx.js';
import { attachLights, FLANKER_LIGHTS } from '../fx/navlights.js';

const D2R = Math.PI / 180;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

function rnd(a, b) { return a + Math.random() * (b - a); }

// ------------------------------------------------------------------------------------------
// A fighter flown by the computer. Enemy jets (team 'red', the default) hunt the player and any friendly AI jet;
// a friendly one (team 'blue', see wingman.js) fights the enemy jets. o.model / o.lights / o.flame swap the airframe,
// o.bvr / o.wvr name its long- and short-range missiles (counts come from o[name]).
export class AIJet extends Entity {
  constructor(game, o) {
    const team = o.team || 'red';
    const mdl = o.model || buildEnemyFighter(o.variant || 'fighter');
    super(game.world, { team, kind: 'air', name: o.name || 'FLANKER', label: o.label || 'SU', radius: 9, hp: 100, rcs: o.rcs || 12, ir: 1, root: mdl.root, hitSpheres: mdl.info.hitSpheres, value: 50 });
    this.game = game; this.model = mdl; game.scene.add(mdl.root);
    this.pos.copy(o.pos); const h = (o.heading || 0) * D2R;
    this.vel.set(Math.sin(h), 0, -Math.cos(h)).multiplyScalar(o.speed || 230);
    this.quat.setFromEuler(new THREE.Euler(0, -h, 0));
    this.up = new THREE.Vector3(0, 1, 0);
    this.mass = 21000; this.S = 62; this.throttle = 0.7; this.ab = 0; this.maxG = 8.5;
    this.state = 'patrol'; this.cap = o.cap ? o.cap.clone() : this.pos.clone(); this.capAlt = o.capAlt || 6000;
    this.radar = new Radar(this, { type: 'air', label: o.label === 'F18' ? 'F18' : '27', range: 75000, azHalf: 60 * D2R, isAir: true, scanPeriod: 3, lethal: 2, emitterOffset: new THREE.Vector3(0, 0, -10) });
    game.world.radars.push(this.radar);
    this.bvr = o.bvr || 'r77'; this.wvr = o.wvr || 'r73';
    this.weapons = { [this.bvr]: o[this.bvr] != null ? o[this.bvr] : 4, [this.wvr]: o[this.wvr] != null ? o[this.wvr] : 2, gun: 150 };
    this.flares = 32; this.chaffN = 32; this.cmT = 0; this.thinkT = Math.random() * 0.3; this.fireT = 0; this.myMissile = null;
    this.target = null; this.foe = null; this.threat = null; this.crankDir = 1; this.desiredDir = new THREE.Vector3(); this.desiredSpeed = 240;
    this.navLights = attachLights(mdl.root, o.lights || FLANKER_LIGHTS);
    const fl = o.flame || [0.48, 7.5];
    this.flames = [new AfterburnerFlame(fl[0], fl[1]), new AfterburnerFlame(fl[0], fl[1])];
    this.flames.forEach((f, i) => { f.group.position.copy(mdl.flameAnchors ? mdl.flameAnchors[i] : mdl.nozzles[i].position); if (mdl.flameAnchors) f.group.position.z -= 0.05; mdl.root.add(f.group); });
    this.audio = game.audio.createSource('jet'); this.audioGain = o.audioGain ?? 1;
    this.contrail = null; this.vortexL = null; this.vortexR = null;
    this.falling = false; this.fallT = 0; this.spin = new THREE.Vector3();
    this.smokeTrail = null; this.gLoad = 1;
    this.syncModel();
  }
  irIntensity(from) {
    const fwd = _v.set(0, 0, -1).applyQuaternion(this.quat);
    const toObs = _v2.copy(from).sub(this.pos).normalize();
    const aspect = -fwd.dot(toObs); // 1 = looking at the tailpipe
    const base = 0.4 + 1.3 * this.throttle + 8.5 * this.ab;
    return base * (0.3 + 0.7 * Math.max(0, aspect) ** 0.7) + 0.25;
  }
  syncModel() {
    const fwd = _v.copy(this.vel).normalize();
    const right = _v2.copy(fwd).cross(this.up).normalize(); const up = _v3.copy(right).cross(fwd).normalize();
    _m.makeBasis(right, up, fwd.clone().negate()); this.quat.setFromRotationMatrix(_m);
    // slight angle of attack
    _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.min(0.25, 0.03 + (this.gLoad - 1) * 0.02)); this.quat.multiply(_q);
    this.root.position.copy(this.pos); this.root.quaternion.copy(this.quat);
  }
  fly(dt, dir, speed) {
    const g = this.game; const V = Math.max(this.vel.length(), 60);
    const vhat = _v.copy(this.vel).multiplyScalar(1 / V);
    const rho = rhoAt(this.pos.y); const q = 0.5 * rho * V * V;
    const gAvail = q * this.S * 1.75 / (this.mass * G0);
    const gLim = Math.min(this.maxG, gAvail);
    // terrain avoidance
    const look = _v2.copy(this.pos).addScaledVector(vhat, V * 4);
    const gh = Math.max(g.terrain.heightAt(look.x, look.z), g.terrain.heightAt(this.pos.x, this.pos.z), 0);
    const want = _v3.copy(dir).normalize();
    if (this.pos.y < gh + 220 || look.y < gh + 150) { want.y = Math.max(want.y, 0.35 + (gh + 220 - this.pos.y) / 400); want.normalize(); }
    const cosA = THREE.MathUtils.clamp(vhat.dot(want), -1, 1); const ang = Math.acos(cosA);
    let turnRate = 0;
    const axis = new THREE.Vector3().copy(vhat).cross(want);
    if (axis.lengthSq() < 1e-8) axis.copy(this.up).cross(vhat);
    axis.normalize();
    if (ang > 1e-4) {
      const omegaMax = gLim * G0 / V;
      turnRate = Math.min(omegaMax, ang * 2.5);
      const newDir = vhat.clone().applyAxisAngle(axis, Math.min(ang, turnRate * dt));
      this.vel.copy(newDir).multiplyScalar(V);
    }
    // lift vector (turn accel + gravity compensation) defines the up axis (coordinated flight)
    const aTurn = axis.clone().cross(vhat).multiplyScalar(turnRate * V);
    const lift = aTurn.add(new THREE.Vector3(0, G0, 0)); lift.addScaledVector(vhat, -lift.dot(vhat));
    this.gLoad = lift.length() / G0;
    if (lift.lengthSq() > 1e-4) this.up.lerp(lift.normalize(), Math.min(1, dt * 4)).normalize();
    // energy: thrust - drag - gravity along path
    const CL = this.gLoad * this.mass * G0 / Math.max(q * this.S, 1);
    const M = V / soundAt(this.pos.y);
    const cd = 0.022 + (M > 0.85 ? Math.min(0.03, (M - 0.85) * 0.12) : 0) + 0.12 * CL * CL;
    const D = q * this.S * cd;
    const sp = this.desiredSpeed = speed;
    const err = sp - V;
    this.throttle = THREE.MathUtils.clamp(0.7 + err * 0.02, 0.3, 1.0);
    this.ab = err > 25 || this.state === 'defend' || this.gLoad > 5 ? Math.min(1, this.ab + dt * 2) : Math.max(0, this.ab - dt * 2);
    const sig = rho / 1.225;
    const T = (2 * 76000 * this.throttle + 2 * 47000 * this.ab) * Math.pow(sig, 0.75) * (1 + 0.3 * M);
    const a = (T - D) / this.mass - G0 * vhat.y;
    this.vel.addScaledVector(vhat, a * dt);
    if (this.vel.length() < 90) this.vel.setLength(90);
    this.pos.addScaledVector(this.vel, dt);
  }
  // an aircraft of the other side this jet can fight (alive, still flying)
  canFight(c) { return !!c && c !== this && c.alive && c.team !== this.team && !(c.ac && c.ac.crashed) && !c.landed; }
  // the nearest enemy aircraft its own radar or the ground-controlled-intercept network can see; enemy jets look at the
  // player and friendly AI jets, friendly jets at the enemy ones
  pickFoe() {
    const g = this.game, P = g.player; let best = null, bs = Infinity;
    const consider = (c) => {
      if (!this.canFight(c)) return;
      const R = c.pos.distanceTo(this.pos); if (R > 90000) return;
      if (!(this.radar.canSee(g.world, c) || (g.gciSees && R < 60000))) return;
      const s = R * (c === this.foe ? 0.7 : 1); if (s < bs) { bs = s; best = c; }
    };
    consider(P);
    for (const j of g.aiJets) consider(j);
    return best;
  }
  // missiles chasing this jet that its pilot knows about
  scanThreats() {
    this.threat = null;
    for (const m of this.game.world.missiles) {
      if (m.dead || m.team === this.team || m.target !== this) continue;
      const d = m.pos.distanceTo(this.pos);
      // radar missiles: RWR warns once the seeker goes active; IR shots are only spotted visually (smoke trail)
      const aware = m.def.seeker === 'arh' ? (m.active || d < 7000) : m.def.seeker === 'ir' ? (m.spotted || (d < 4500 && (m.spotted = Math.random() < 0.15))) : d < 12000;
      if (aware && (!this.threat || d < this.threat.pos.distanceTo(this.pos))) this.threat = m;
    }
  }
  // ---- decision making (4 Hz) ----
  think() {
    const g = this.game;
    this.scanThreats();
    const seen = this.pickFoe();
    if (seen) this.foe = seen; else if (!this.canFight(this.foe)) this.foe = null;
    const F = this.foe, detected = !!seen;
    const R = F ? F.pos.distanceTo(this.pos) : Infinity;
    if (this.threat) this.state = 'defend';
    else if (this.state === 'defend') this.state = detected ? 'intercept' : 'patrol';
    if (this.state === 'patrol' && detected) { this.state = 'intercept'; if (g.comms && F.isPlayer) g.comms.commit(this); }
    if (this.state === 'intercept' && !detected && R > 40000) this.state = 'patrol';
    if (!F && this.state !== 'defend') this.state = 'patrol';
    this.engage(F);
  }
  // air combat against F: radar lock, BVR shot then crank, WVR heat-seeker and gun
  engage(F) {
    const g = this.game;
    const toF = F ? _v.copy(F.pos).sub(this.pos) : null, R = F ? toF.length() : Infinity;
    if (this.state === 'intercept' && R < 11000) this.state = 'merge';
    if (this.state === 'merge' && R > 16000) this.state = 'intercept';
    // radar lock management
    if ((this.state === 'intercept' || this.state === 'merge' || this.state === 'crank') && F && this.radar.canSee(g.world, F)) {
      if (this.radar.stt !== F) { this.radar.stt = F; this.radar.sttLost = 0; }
    }
    if (this.state === 'defend' || !F) this.radar.stt = null;
    this.fireT -= 0.25;
    // BVR launch
    if (this.state === 'intercept' && F && this.radar.stt === F && this.weapons[this.bvr] > 0 && this.fireT <= 0) {
      const asp = F.vel.clone().normalize().dot(toF.clone().normalize().negate());
      const rmax = (30000 + 12000 * Math.min(1, this.pos.y / 8000) + 8000 * asp) * (this.bvrScale || 1);
      const fwd = _v2.set(0, 0, -1).applyQuaternion(this.quat);
      if (R < rmax && R > 4000 && fwd.dot(toF.clone().normalize()) > Math.cos(25 * D2R)) {
        this.fire(this.bvr, F); this.weapons[this.bvr]--; this.fireT = 14 + Math.random() * 6; this.state = 'crank'; this.crankDir = Math.random() < 0.5 ? -1 : 1;
      }
    }
    if (this.state === 'crank' && (!this.myMissile || this.myMissile.dead || this.myMissile.active)) this.state = R < 11000 ? 'merge' : 'intercept';
    // WVR: heat-seeker / gun
    if (this.state === 'merge' && F) {
      const fwd = _v2.set(0, 0, -1).applyQuaternion(this.quat);
      const off = Math.acos(THREE.MathUtils.clamp(fwd.dot(toF.clone().normalize()), -1, 1));
      if (this.weapons[this.wvr] > 0 && R < 8500 && R > 700 && off < 35 * D2R && this.fireT <= 0) { this.fire(this.wvr, F); this.weapons[this.wvr]--; this.fireT = 8; }
      this.gunning = R < 1100 && off < 4 * D2R && this.weapons.gun > 0;
    } else this.gunning = false;
  }
  fire(key, tgt) {
    const g = this.game;
    const pyl = this.model.info.pylons[(this.weapons[key] + (key === this.wvr ? 0 : 2)) % this.model.info.pylons.length];
    const p = pyl.clone().applyQuaternion(this.quat).add(this.pos).add(_v.set(0, -0.6, 0));
    const m = new Missile(g, key, { team: this.team, shooter: this, target: tgt, pos: p, vel: this.vel.clone().add(_v.set(0, -3, 0)), quat: this.quat, radar: this.radar });
    g.world.missiles.push(m); this.myMissile = m;
    if (tgt.isPlayer) g.onEnemyLaunch(m, this);
    return m;
  }
  update(dt) {
    const g = this.game;
    if (!this.alive) return this.updateFalling(dt);
    this.thinkT -= dt; if (this.thinkT <= 0) { this.thinkT = 0.25; this.think(); }
    this.move(dt);
    // gun
    if (this.gunning) {
      this.gunT = (this.gunT || 0) - dt;
      if (this.gunT <= 0 && this.weapons.gun > 0) {
        this.gunT = 0.05; this.weapons.gun--;
        const fwd = _v2.set(0, 0, -1).applyQuaternion(this.quat);
        const mp = _v3.copy(this.pos).addScaledVector(fwd, 9);
        const spread = new THREE.Vector3((Math.random() - 0.5) * 0.008, (Math.random() - 0.5) * 0.008, 0).applyQuaternion(this.quat);
        g.bullets.spawn(mp, this.vel.clone().addScaledVector(fwd.add(spread).normalize(), 860), this.team, 7, Math.random() < 0.4, this, 6e-4);
        g.fx.muzzleFlash(mp, fwd, 0.7);
      }
    }
    this.syncModel();
    // visual & audio
    this.flames.forEach(f => f.set(this.ab, 0.7 + this.throttle * 0.3));
    this.audio.update(this.pos, this.vel, { intensity: this.audioGain, ab: this.ab, rpm: this.throttle });
    this.vapor(dt);
    if (this.hp < 50 && !this.smokeTrail) this.smokeTrail = g.fx.trails.create({ kind: 'smoke', width: 2, grow: 1.5, maxAge: 10, opacity: 0.8, color: [0.12, 0.12, 0.12] });
    if (this.smokeTrail) this.smokeTrail.add(this.pos);
  }
  move(dt) { const speed = this.steer(dt, this.desiredDir); this.fly(dt, this.desiredDir, speed); }
  // where to fly this step: fills dir, returns the speed to hold
  steer(dt, dir) {
    const g = this.game, P = this.foe;
    const state = P || this.state === 'defend' ? this.state : 'patrol';
    const toP = P ? _v.copy(P.pos).sub(this.pos) : null; const R = P ? toP.length() : Infinity;
    let speed = 240;
    switch (state) {
      case 'patrol': {
        // racetrack orbit around the CAP point
        const rel = _v2.copy(this.pos).sub(this.cap); rel.y = 0;
        const tang = new THREE.Vector3(-rel.z, 0, rel.x).normalize();
        const radial = rel.length() > 9000 ? rel.clone().normalize().multiplyScalar(-1) : new THREE.Vector3();
        dir.copy(tang).add(radial.multiplyScalar(0.8)); dir.y = (this.capAlt - this.pos.y) / 3000; speed = 220; break;
      }
      case 'intercept': {
        const lead = P.vel.clone().multiplyScalar(Math.min(R / 600, 30));
        dir.copy(P.pos).add(lead).sub(this.pos); dir.y += (P.pos.y + 600 - this.pos.y) * 0.3; speed = 300; break;
      }
      case 'crank': {
        const flat = toP.clone(); flat.y = 0; flat.normalize();
        dir.copy(flat).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.crankDir * 50 * D2R); dir.y = (P.pos.y - this.pos.y) / Math.max(R, 1) * 0.5; speed = 260; break;
      }
      case 'merge': {
        // lead pursuit
        const tof = Math.min(R / 800, 1.5);
        dir.copy(P.pos).addScaledVector(P.vel, tof).sub(this.pos); speed = 270; break;
      }
      case 'defend': {
        const m = this.threat;
        if (m && !m.dead) {
          const los = _v2.copy(m.pos).sub(this.pos); const d = los.length(); los.normalize();
          // beam the missile and descend into clutter (notch), then hard last-ditch break
          // beam the threat, but pilots never hold a perfect notch: heading error drifts every few seconds
          this.notchErrT = (this.notchErrT || 0) - dt;
          if (this.notchErrT <= 0) { this.notchErrT = 2 + Math.random() * 3; this.notchErr = (Math.random() - 0.5) * 2 * (12 + Math.random() * 22) * D2R; }
          const beam = new THREE.Vector3(-los.z, 0, los.x); if (beam.dot(this.vel) < 0) beam.negate();
          beam.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.notchErr || 0);
          dir.copy(beam); dir.y = -0.35 + Math.max(0, (900 - (this.pos.y - g.terrain.heightAt(this.pos.x, this.pos.z))) / 1500);
          if (d < 1500) dir.add(_v3.copy(this.up).multiplyScalar(2.5));
          speed = 330;
          this.cmT -= dt;
          if (d < (m.def.seeker === 'ir' ? 3000 : 6000) && this.cmT <= 0) {
            this.cmT = m.def.seeker === 'ir' ? 0.9 + Math.random() * 0.6 : 1.1 + Math.random() * 0.8;
            if (m.def.seeker === 'ir' && this.flares > 0) { this.flares--; this.dropFlare(); this.ab = 0; }
            else if (this.chaffN > 0) { this.chaffN--; g.world.chaff.push(new Chaff(g, this.pos, this.vel)); }
          }
        }
        break;
      }
    }
    return speed;
  }
  dropFlare() {
    const g = this.game;
    for (let i = 0; i < 2; i++) {
      const v = this.vel.clone().multiplyScalar(0.85).add(new THREE.Vector3(rnd(-15, 15), -25, rnd(-15, 15)));
      const f = new Flare(g, this.pos.clone().add(new THREE.Vector3(0, -1, 0)), v); g.world.flares.push(f);
    }
  }
  vapor(dt) {
    const g = this.game;
    if (this.pos.y > 8500) { if (!this.contrail) this.contrail = [g.fx.trails.create({ kind: 'contrail', width: 1.5, opacity: 0.55 }), g.fx.trails.create({ kind: 'contrail', width: 1.5, opacity: 0.55 })]; this.model.nozzles.forEach((n, i) => this.contrail[i].add((n.group || n).getWorldPosition(_v))); }
    else if (this.contrail) { this.contrail.forEach(c => c.stop()); this.contrail = null; }
    if (this.gLoad > 4.5 && this.pos.y < 6000) {
      if (!this.vortexL) { this.vortexL = g.fx.trails.create({ kind: 'vortex', width: 0.35, opacity: 0.5 }); this.vortexR = g.fx.trails.create({ kind: 'vortex', width: 0.35, opacity: 0.5 }); }
      this.vortexL.add(this.model.info.wingtipL.clone().applyQuaternion(this.quat).add(this.pos)); this.vortexR.add(this.model.info.wingtipR.clone().applyQuaternion(this.quat).add(this.pos));
    } else if (this.vortexL) { this.vortexL.stop(); this.vortexR.stop(); this.vortexL = this.vortexR = null; }
  }
  onDestroyedVisual() {
    this.falling = true; this.fallT = 0; this.spin.set(rnd(-1, 1), rnd(-2, 2), rnd(-3, 3));
    this.fire_ = this.game.fx.addFire(this.pos, 0.8, 30, { follow: () => this.pos });
    this.flames.forEach(f => f.set(0, 0));
    if (this.audio) this.audio.stop();
    this.radar.on = false;
  }
  updateFalling(dt) {
    if (!this.falling) return;
    const g = this.game; this.fallT += dt;
    this.vel.y -= G0 * dt; this.vel.multiplyScalar(1 - dt * 0.15);
    this.pos.addScaledVector(this.vel, dt);
    _q.setFromEuler(new THREE.Euler(this.spin.x * dt, this.spin.y * dt, this.spin.z * dt)); this.quat.multiply(_q);
    this.root.position.copy(this.pos); this.root.quaternion.copy(this.quat);
    if (this.smokeTrail) this.smokeTrail.add(this.pos);
    const th = g.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < Math.max(th, 0)) {
      this.falling = false; g.fx.explosion(this.pos.clone(), 6, { surface: th > 0 ? 'ground' : 'water', water: th <= 0 });
      if (this.fire_) this.fire_.life = 0; this.root.visible = false; if (this.smokeTrail) this.smokeTrail.stop();
      if (th > 0) g.fx.addFire(this.pos.clone(), 0.9, 120);
    }
  }
}

// aircraft on the player's side that enemy air defenses shoot at: the player and any friendly AI jet still flying
export function blueAir(g) {
  const out = []; const P = g.player;
  if (P.alive && !P.ac.crashed) out.push(P);
  for (const j of g.aiJets) if (j.alive && j.team === 'blue' && !j.landed) out.push(j);
  return out;
}

// ------------------------------------------------------------------------------------------
// Ground vehicle entity helper
export function groundEntity(game, build, o) {
  const mdl = build;
  const e = new Entity(game.world, { team: o.team || 'red', kind: o.kind || 'ground', name: o.name, label: o.label || 'GV', radius: mdl.info.radius, hp: o.hp || 120, rcs: 20, ir: o.ir || 0.6, root: mdl.root, hitSpheres: mdl.info.hitSpheres, value: o.value || 15 });
  e.model = mdl; e.mats = mdl.mats;
  const x = o.x, z = o.z; const y = game.terrain.heightAt(x, z);
  e.pos.set(x, y, z); mdl.root.position.copy(e.pos); mdl.root.rotation.y = -(o.heading || 0) * D2R;
  e.quat.copy(mdl.root.quaternion);
  game.scene.add(mdl.root);
  game.world.add(e);
  return e;
}

export class SamSite {
  constructor(game, o) {
    this.game = game; this.name = o.name || 'SA-21'; this.kind = o.kind || 's400';
    const big = this.kind === 's400';
    this.search = groundEntity(game, buildSAMRadar('search'), { x: o.x + 40, z: o.z - 60, team: 'red', kind: 'sam', name: big ? 'SA-21 SEARCH RADAR' : 'SR', label: big ? 'S4' : 'TR', hp: 140, value: 40, heading: 30 });
    this.track = groundEntity(game, buildSAMRadar('track'), { x: o.x - 30, z: o.z + 20, team: 'red', kind: 'sam', name: big ? 'SA-21 TRACK RADAR' : 'TR', label: big ? 'S4' : 'TR', hp: 140, value: 60, heading: o.facing || 180 });
    this.searchR = new Radar(this.search, { type: 'search', label: big ? 'S4' : 'TR', range: big ? 100000 : 30000, scanPeriod: big ? 6 : 2.5, lethal: 2, emitterOffset: this.search.model.info.emitter, minAlt: 0 });
    this.trackR = new Radar(this.track, { type: 'track', label: big ? 'S4' : 'TR', range: big ? 80000 : 22000, scanPeriod: 1, lethal: 3, emitterOffset: this.track.model.info.emitter, minAlt: big ? 25 : 10 });
    this.search.radar = this.searchR; this.track.radar = this.trackR;
    game.world.radars.push(this.searchR, this.trackR);
    this.launchers = [];
    const n = o.launchers || 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4; const r = 180;
      const L = groundEntity(game, buildSAMLauncher(), { x: o.x + Math.cos(a) * r, z: o.z + Math.sin(a) * r, team: 'red', kind: 'sam', name: big ? 'SA-21 TEL' : 'TEL', label: 'S4', hp: 110, value: 30, heading: (a * 180 / Math.PI) + 90 });
      L.ammo = 4; L.erect = 0; this.launchers.push(L);
    }
    this.target = null; this.inFlight = []; this.reload = 0; this.trackT = 0; this.emcon = 0;
    this.def = big ? 's400' : 'tor'; this.maxR = o.maxR || (big ? 40000 : 12000); this.minR = big ? 4000 : 1200;
  }
  get alive() { return this.track.alive || this.search.alive; }
  update(dt) {
    const g = this.game;
    // erectors animate
    for (const L of this.launchers) { if (!L.alive) continue; const want = L.ammo > 0 && this.target ? 1 : (L.erect > 0.01 ? L.erect : 0); L.erect += (want - L.erect) * Math.min(1, dt * 0.25); L.model.nodes.erector.rotation.x = L.model.info.erectAngle * L.erect; }
    this.search.model.nodes.antenna.rotation.y += dt * Math.PI * 2 / this.searchR.scanPeriod;
    if (this.target && this.track.alive) { const d = _v.copy(this.target.pos).sub(this.track.pos); this.track.model.nodes.antenna.rotation.y = Math.atan2(-d.x, -d.z) - this.track.root.rotation.y; }
    // emission control vs anti-radiation missiles
    this.emcon -= dt;
    for (const m of g.world.missiles) if (!m.dead && m.def.seeker === 'arm' && (m.target === this.track || m.target === this.search) && m.pos.distanceTo(this.track.pos) < 18000 && this.emcon <= 0 && Math.random() < dt * 0.5) {
      this.emcon = 18; if (g.comms) g.comms.call('enemy', `${this.name}: Anti-radiation missile inbound! Radars off!`, 'Enemy radio: the big SAM site switched its radars off to dodge your anti-radar missile. The missile remembers where the radar was.', { key: 'emcon', every: 20, pri: 2, ttl: 6 });
    }
    this.trackR.on = this.track.alive && this.emcon <= 0; this.searchR.on = this.search.alive && this.emcon <= 0;
    if (!this.alive) return;
    // search -> cue track radar
    this.thinkT = (this.thinkT || 0) - dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.5;
      const cands = blueAir(g);
      this.target = null;
      for (const c of cands) if (this.searchR.canSee(g.world, c) || this.trackR.canSee(g.world, c)) { this.target = c; break; }
      if (this.target && this.trackR.on && !(this.trackR.reacqT > 0) && this.trackR.stt !== this.target && this.trackR.canSee(g.world, this.target)) { this.trackR.stt = this.target; this.trackR.sttLost = 0; this.trackT = 0; this.trackR.decoyed = null; }
      g.gciSees = g.gciSees || !!this.target;
    }
    if (this.trackR.reacqT > 0) this.trackR.reacqT -= dt;
    const locked = this.trackR.updateTrack(g.world, dt);
    if (locked) this.trackT += dt; else this.trackT = 0;
    this.inFlight = this.inFlight.filter(m => !m.dead);
    this.reload -= dt;
    const T = this.trackR.stt;
    if (T && locked && this.trackT > (this.kind === 's400' ? 4 : 1.5) && !this.inFlight.some(m => m.target === T) && this.reload <= 0) {
      const R = T.pos.distanceTo(this.track.pos);
      if (R < this.maxR && R > this.minR) {
        const L = this.launchers.find(l => l.alive && l.ammo > 0 && l.erect > 0.95);
        if (L) {
          const tube = L.model.info.tubes[4 - L.ammo];
          const p = tube.clone(); L.model.nodes.erector.localToWorld(p);
          const m = new Missile(g, this.def, { team: 'red', shooter: this.track, target: T, pos: p, vel: new THREE.Vector3(0, 45, 0), radar: this.trackR, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)) });
          g.world.missiles.push(m); this.inFlight.push(m); L.ammo--; this.reload = this.kind === 's400' ? 13 : 6;
          g.fx.explosion(p.clone().add(new THREE.Vector3(0, 2, 0)), 1.2, { surface: 'ground' });
          if (T.isPlayer) g.onEnemyLaunch(m, this.track);
        }
      }
    }
  }
}

// Short-range point defense (Tor-like): integrated radar, engages aircraft AND incoming missiles
export class PointDefense {
  constructor(game, o) {
    this.game = game; this.name = o.name || 'SA-15';
    const mdl = buildSPAAG(); // reuse tracked chassis + turret look (radar dish)
    this.e = groundEntity(game, mdl, { x: o.x, z: o.z, team: 'red', kind: 'sam', name: this.name, label: 'TR', hp: 120, value: 35, heading: o.heading || 0 });
    this.radar = new Radar(this.e, { type: 'track', label: '15', range: 25000, scanPeriod: 1.5, lethal: 3, emitterOffset: new THREE.Vector3(0, 4, 0), minAlt: 8 });
    this.e.radar = this.radar; game.world.radars.push(this.radar);
    this.ammo = 8; this.reload = 0; this.target = null; this.defended = o.defended || [];
  }
  update(dt) {
    const g = this.game; const e = this.e; if (!e.alive) { this.radar.on = false; return; }
    e.model.nodes.radar.rotation.y += dt * 4;
    this.reload -= dt;
    // priority 1: incoming player missiles/bombs aimed at defended assets within 12 km
    let best = null, bestD = 13000;
    for (const m of g.world.missiles) {
      if (m.dead || m.team === 'red' || m.def.seeker === 'none' && !m.def.bomb) continue;
      const d = m.pos.distanceTo(e.pos); if (d > bestD || d < 600) continue;
      if (!g.terrain.lineOfSight(this.radar.pos, m.pos, true, 1)) continue;
      const tgtPt = m.target ? m.target.pos : m.lastKnown; if (!tgtPt || tgtPt.distanceTo(e.pos) > 3500) continue;
      if (g.world.missiles.some(x => !x.dead && x.target === m)) continue;
      best = m; bestD = d;
    }
    const R = this.radar;
    if (R.reacqT > 0) R.reacqT -= dt;
    if (!best && !(R.reacqT > 0)) {
      // then the nearest aircraft inside 12 km (the one already tracked counts as a little nearer, so it sticks)
      let air = null, bd = 12000;
      for (const c of blueAir(g)) { const d = c.pos.distanceTo(e.pos) * (c === R.stt ? 0.8 : 1); if (d < bd) { bd = d; air = c; } }
      if (air) {
        if (R.stt !== air) { if (R.canSee(g.world, air)) { R.stt = air; R.sttLost = 0; R.decoyed = null; } }
        if (R.stt === air && R.updateTrack(g.world, dt)) best = air;
      }
    }
    if (best) {
      const d = _v.copy(best.pos).sub(e.pos); e.model.nodes.turret.rotation.y = Math.atan2(-d.x, -d.z) - e.root.rotation.y;
      if (best.isMissile) this.radar.stt = best;
      this.inFlightP = (this.inFlightP || []).filter(x => !x.dead);
      if (this.reload <= 0 && this.ammo > 0 && !(!best.isMissile && this.inFlightP.length)) {
        const p = e.pos.clone().add(new THREE.Vector3(0, 4, 0));
        const m = new Missile(g, 'tor', { team: 'red', shooter: e, target: best, pos: p, vel: new THREE.Vector3(0, 50, 0), radar: this.radar });
        // command guidance vs missiles: track directly
        g.world.missiles.push(m); this.ammo--; this.reload = best.isMissile ? 2.5 : 8; if (!best.isMissile) this.inFlightP.push(m);
        if (best.isPlayer) g.onEnemyLaunch(m, e); else if (best.isMissile && best.shooter && best.shooter.isPlayer) g.msg(`${this.name} IS SHOOTING AT YOUR MISSILE!`, 2.5, '#ff9080');
      }
    } else this.radar.stt = null;
  }
}

// Radar-directed anti-aircraft gun (ZSU-23-4 style) with lead computation
export class Flak {
  constructor(game, o) {
    this.game = game; const mdl = buildSPAAG();
    this.e = groundEntity(game, mdl, { x: o.x, z: o.z, team: 'red', kind: 'ground', name: 'ZSU-23-4', label: 'A', hp: 90, value: 25, heading: o.heading || 0 });
    this.radar = new Radar(this.e, { type: 'track', label: 'A', range: 9000, scanPeriod: 1, lethal: 2, emitterOffset: new THREE.Vector3(0, 3.5, 0), minAlt: 5 });
    this.e.radar = this.radar; game.world.radars.push(this.radar);
    this.burst = 0; this.cool = 0; this.fireT = 0; this.audio = game.audio.createSource('cannon');
  }
  update(dt) {
    const g = this.game, e = this.e; if (!e.alive) { this.radar.on = false; this.audio.update(e.pos, e.vel, { firing: false }); return; }
    e.model.nodes.radar.rotation.y += dt * 6;
    let P = null, R = 3200;
    for (const c of blueAir(g)) { const d = c.pos.distanceTo(e.pos); if (d < R && this.radar.canSee(g.world, c)) { R = d; P = c; } }
    let firing = false;
    if (P) {
      this.radar.stt = P;
      const v0 = 970; const tof = R / v0;
      const lead = P.pos.clone().addScaledVector(P.vel, tof); lead.y += 0.5 * G0 * tof * tof;
      const d = lead.sub(e.pos).normalize();
      e.model.nodes.turret.rotation.y = Math.atan2(-d.x, -d.z) - e.root.rotation.y;
      e.model.nodes.gun.rotation.x = Math.asin(d.y);
      this.cool -= dt;
      if (this.cool <= 0) { this.burst = 1.2; this.cool = 2.5 + Math.random() * 2; }
      if (this.burst > 0) {
        this.burst -= dt; firing = true; this.fireT -= dt;
        while (this.fireT <= 0) {
          this.fireT += 1 / 55;
          const mz = e.model.nodes.muzzles[Math.floor(Math.random() * 4)].getWorldPosition(new THREE.Vector3());
          const disp = new THREE.Vector3((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02);
          g.bullets.spawn(mz, d.clone().add(disp).normalize().multiplyScalar(v0), 'red', 9, Math.random() < 0.5, e, 7e-4);
          if (Math.random() < 0.25) g.fx.muzzleFlash(mz, d, 0.5);
        }
      }
    } else this.radar.stt = null;
    this.audio.update(e.pos, e.vel, { firing, intensity: 1 });
  }
}

// Armor: drives along a path and duels with opposing armor
export class Tank {
  constructor(game, o) {
    this.game = game; this.team = o.team || 'red';
    const mdl = o.apc ? buildAPC(this.team) : buildMBT(this.team);
    this.e = groundEntity(game, mdl, { x: o.x, z: o.z, team: this.team, kind: 'ground', name: o.apc ? (this.team === 'red' ? 'BMP-2' : 'BRADLEY') : (this.team === 'red' ? 'T-90' : 'M1A2'), label: 'T', hp: o.apc ? 140 : 260, value: o.apc ? 12 : 20, heading: o.heading || 0, ir: 1.4 });
    this.e.irIntensity = () => 1.6;
    this.path = o.path || null; this.pathI = 0; this.speed = o.speed || 0; this.reload = 3 + Math.random() * 4; this.apc = !!o.apc;
    this.heading = (o.heading || 0) * D2R;
  }
  update(dt) {
    const g = this.game, e = this.e; if (!e.alive) return;
    // drive
    if (this.path && this.pathI < this.path.length && this.speed > 0) {
      const [tx, tz] = this.path[this.pathI]; const dx = tx - e.pos.x, dz = tz - e.pos.z; const d = Math.hypot(dx, dz);
      if (d < 25) this.pathI++;
      else {
        const want = Math.atan2(dx, -dz); let dh = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
        this.heading += THREE.MathUtils.clamp(dh, -0.5 * dt, 0.5 * dt);
        e.pos.x += Math.sin(this.heading) * this.speed * dt; e.pos.z -= Math.cos(this.heading) * this.speed * dt;
        e.vel.set(Math.sin(this.heading) * this.speed, 0, -Math.cos(this.heading) * this.speed);
      }
      e.pos.y = g.terrain.heightAt(e.pos.x, e.pos.z);
      const n = g.terrain.normalAt(e.pos.x, e.pos.z);
      e.root.position.copy(e.pos);
      e.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n).multiply(_q.setFromEuler(new THREE.Euler(0, -this.heading, 0)));
      if (Math.random() < dt * 3) g.fx.ps.alpha.spawn(4, e.pos.x, e.pos.y + 0.5, e.pos.z, 0, 0.8, 0, 2.5, 3, { grow: 2, color: [0.3, 0.26, 0.2], alpha: 0.35, drag: 1 });
    } else e.vel.set(0, 0, 0);
    // engage nearest enemy armor in range
    this.reload -= dt;
    if (this.reload <= 0) {
      let best = null, bd = this.apc ? 1500 : 2600;
      for (const o of g.tanks) { if (o === this || o.team === this.team || !o.e.alive) continue; const d = o.e.pos.distanceTo(e.pos); if (d < bd && g.terrain.lineOfSight(_v.copy(e.pos).setY(e.pos.y + 2.5), _v2.copy(o.e.pos).setY(o.e.pos.y + 1.5), false, 0)) { bd = d; best = o; } }
      if (best) {
        this.reload = this.apc ? 2.5 : 6 + Math.random() * 4;
        const muz = e.model.nodes.muzzle.getWorldPosition(new THREE.Vector3());
        const tgt = best.e.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 1.4 + Math.random() * 1.5, (Math.random() - 0.5) * 6));
        const dir = tgt.sub(muz).normalize();
        e.model.nodes.turret.rotation.y = Math.atan2(-dir.x, -dir.z) - e.root.rotation.y;
        g.bullets.spawn(muz, dir.multiplyScalar(this.apc ? 1000 : 1650), this.team, this.apc ? 15 : 90, 2, e, 1e-4);
        g.fx.muzzleFlash(muz, dir, this.apc ? 1 : 3.5);
        if (!this.apc) { for (let i = 0; i < 6; i++) g.fx.ps.alpha.spawn(4, muz.x, muz.y - 1.5, muz.z, (Math.random() - 0.5) * 12, 1 + Math.random() * 2, (Math.random() - 0.5) * 12, 3, 3, { grow: 3, color: [0.36, 0.31, 0.24], alpha: 0.6, drag: 1.2 }); g.audio.explosion(muz, 2.5, muz.distanceTo(g.camera.position) / 343); }
      } else this.reload = 1.5;
    }
  }
}

// Warship self-defense: a radar-guided SAM launcher (engages aircraft and incoming weapons) plus a close-in gun.
// Enemy ships shoot at the player (first) and friendly jets; friendly escorts (team 'blue') shoot at enemy jets near
// the group and at enemy missiles chasing the player, the wingman or any friendly ship.
export class ShipDefense {
  constructor(game, ship, e, o = {}) {
    this.game = game; this.ship = ship; this.e = e; this.name = o.name || 'SA-N-9'; this.team = o.team || 'red';
    this.radar = new Radar(e, { type: 'track', label: o.label || 'N9', range: 32000, scanPeriod: 1.5, lethal: 3, emitterOffset: new THREE.Vector3(0, o.mastH || 24, 0), minAlt: 4, eccm: o.eccm, notchV: o.notchV });
    e.radar = this.radar; game.world.radars.push(this.radar);
    this.ammo = this.maxAmmo = o.sam || 8; this.reload = 2 + Math.random() * 2; this.samRange = o.samRange || 13000;
    this.gunCool = 0; this.burst = 0; this.fireT = 0; this.audio = game.audio.createSource('ciws'); this.onShot = o.onShot || null;
  }
  update(dt) {
    const g = this.game, e = this.e, team = this.team, blue = team === 'blue';
    if (!e.alive) { this.radar.on = false; this.audio.update(e.pos, e.vel, { firing: false }); return; }
    this.reload -= dt; this.gunCool -= dt;
    // highest threat: a weapon inbound on this ship
    let threat = null, td = 9000;
    for (const m of g.world.missiles) {
      if (m.dead || m.team === team) continue;
      if (blue && g.world.missiles.some(x => !x.dead && x.target === m)) continue; // escorts: one interceptor per missile
      const aimed = (m.target === e) || (m.lastKnown && m.lastKnown.distanceTo(e.pos) < 400) || (blue && m.target && m.target.team === 'blue' && !m.target.isMissile);
      const d = m.pos.distanceTo(e.pos); if (aimed && d < td) { td = d; threat = m; }
    }
    // aircraft to engage: enemy ships watch the player, escorts pick the nearest enemy jet
    let air = null;
    if (!blue) { let bd = this.samRange; for (const c of blueAir(g)) { const d = c.pos.distanceTo(e.pos) * (c.isPlayer ? 0.85 : 1); if (d < bd) { bd = d; air = c; } } }
    else { let bd = this.samRange; for (const j of g.aiJets) { if (!j.alive || j.team === team) continue; const d = j.pos.distanceTo(e.pos); if (d < bd) { bd = d; air = j; } } }
    const R = this.radar; if (R.reacqT > 0) R.reacqT -= dt;
    let airSeen = false;
    if (air && air.pos.distanceTo(e.pos) < this.samRange && !(R.reacqT > 0)) {
      if (R.stt !== air && R.canSee(g.world, air)) { R.stt = air; R.sttLost = 0; R.decoyed = null; }
      airSeen = R.stt === air && R.updateTrack(g.world, dt);
    }
    const T = threat || (airSeen ? air : null);
    if (threat) R.stt = threat;
    this.inFlightP = (this.inFlightP || []).filter(x => !x.dead);
    if (T && this.reload <= 0 && this.ammo > 0 && T.pos.distanceTo(e.pos) > 900 && !(T === air && this.inFlightP.length)) {
      const p = e.pos.clone().add(new THREE.Vector3(0, 9, 0));
      const m = new Missile(g, 'tor', { team, shooter: e, target: T, pos: p, vel: new THREE.Vector3(0, 55, 0).add(e.vel), radar: this.radar });
      g.world.missiles.push(m); this.ammo--; this.reload = threat ? 2.2 : 9; if (T === air) this.inFlightP.push(m);
      if (T.isPlayer) g.onEnemyLaunch(m, e);
      if (this.onShot) this.onShot(T);
    }
    // close-in gun: aircraft inside 2.5 km or a weapon inside 1.8 km
    let firing = false;
    const gunT = threat && td < 1800 ? threat : (airSeen && air.pos.distanceTo(e.pos) < 2500 ? air : null);
    if (gunT) {
      if (this.gunCool <= 0 && this.burst <= 0) { this.burst = 1.4; this.gunCool = 3 + Math.random() * 2; }
      if (this.burst > 0) {
        this.burst -= dt; firing = true; this.fireT -= dt;
        const mz = e.pos.clone().add(new THREE.Vector3(0, 14, 0));
        const R = gunT.pos.distanceTo(mz); const v0 = 1100, tof = R / v0;
        const lead = gunT.pos.clone().addScaledVector(gunT.vel, tof); lead.y += 0.5 * G0 * tof * tof;
        const d = lead.sub(mz).normalize();
        while (this.fireT <= 0) {
          this.fireT += 1 / 60;
          const disp = new THREE.Vector3((Math.random() - 0.5) * 0.012, (Math.random() - 0.5) * 0.012, (Math.random() - 0.5) * 0.012);
          g.bullets.spawn(mz, d.clone().add(disp).normalize().multiplyScalar(v0), team, 8, Math.random() < 0.4, e, 6e-4, gunT.isMissile ? 1 : 0);
        }
        if (Math.random() < 0.3) g.fx.muzzleFlash(mz, d, 0.6);
      }
    }
    this.audio.update(e.pos, e.vel, { firing, intensity: 1.2 });
  }
}
