// Drones and UAVs flown by the computer. Enemy: a recon UAV that circles and reports the player's position to the
// enemy fighters and SAMs, one-way attack drones that dive into ships, sea-skimming anti-ship cruise missiles.
// Friendly: an MQ-9 Reaper that circles the target area and marks the enemy ground units it sees on the HUD.
// They are entities of kind 'air', so the player's radar, missiles and gun and the warships' defenses all treat
// them as aircraft; game.drones holds the live ones.
import * as THREE from 'three';
import { Entity } from './world.js';
import { buildReconUAV, buildAttackDrone, buildReaper } from '../models/drones.js';
import { buildMunition } from '../models/munitions.js';
import { G0 } from '../sim/atmo.js';
import { CS } from './radio.js';

const D2R = Math.PI / 180;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const rnd = (a, b) => a + Math.random() * (b - a);

// speed m/s, alt m (agl: above the ground/sea, else above sea level), turn deg/s, dmg on the ship it hits
export const DRONE_TYPES = {
  recon: { name: 'RECON DRONE', label: 'UAV', team: 'red', hp: 45, speed: 55, alt: 4200, agl: false, turn: 7, rcs: 1.5, ir: 0.6, value: 30, sound: 'drone', gain: 0.8, build: buildReconUAV },
  attack: { name: 'ATTACK DRONE', label: 'DRN', team: 'red', hp: 16, speed: 62, alt: 240, agl: true, turn: 14, rcs: 0.35, ir: 0.5, value: 10, sound: 'drone', gain: 0.9, dmg: 900, blast: 30, build: buildAttackDrone },
  cruise: { name: 'ANTI-SHIP MISSILE', label: 'ASM', team: 'red', hp: 8, speed: 255, alt: 12, agl: true, turn: 5, rcs: 0.25, ir: 2.5, value: 15, sound: 'jet', gain: 0.35, dmg: 2600, blast: 40, build: () => buildMunition('cruise') },
  reaper: { name: 'REAPER', label: 'MQ9', team: 'blue', hp: 80, speed: 72, alt: 6400, agl: false, turn: 5, rcs: 2, ir: 0.6, value: 0, sound: 'drone', gain: 0.45, build: buildReaper },
};
const CRUISE_SPHERES = [{ c: new THREE.Vector3(0, 0, -2), r: 0.9 }, { c: new THREE.Vector3(0, 0, 0), r: 0.9 }, { c: new THREE.Vector3(0, 0, 2), r: 0.9 }];

export class Drone extends Entity {
  constructor(game, type, o = {}) {
    const T = DRONE_TYPES[type]; const mdl = T.build(); const info = mdl.info || { radius: 3.5, hitSpheres: CRUISE_SPHERES };
    super(game.world, { team: o.team || T.team, kind: 'air', name: o.name || T.name, label: T.label, radius: info.radius, hp: T.hp, rcs: T.rcs, ir: T.ir, root: mdl.root, hitSpheres: info.hitSpheres, value: T.value });
    this.game = game; this.type = type; this.T = T; this.model = mdl; this.isDrone = true;
    // slow movers would sit inside the radar's doppler notch whenever they fly across the beam (see radar.js)
    this.notchV = type === 'cruise' ? 16 : 5;
    game.scene.add(mdl.root);
    this.pos.copy(o.pos); const h = (o.heading || 0) * D2R;
    this.speed = o.speed || T.speed;
    this.vel.set(Math.sin(h), 0, -Math.cos(h)).multiplyScalar(this.speed);
    this.alt = o.alt ?? T.alt;
    this.orbit = o.orbit ? new THREE.Vector3(o.orbit.x, 0, o.orbit.z) : null; this.orbitR = o.orbitR || 3000; this.orbitDir = o.orbitDir || 1;
    this.target = o.target || null; this.dest = o.dest ? new THREE.Vector3(o.dest.x, 0, o.dest.z) : null;
    this.retarget = o.retarget !== false; this.onImpact = o.onImpact || null;
    this.bank = 0; this.falling = false; this.fallT = 0; this.spin = new THREE.Vector3(); this.done = false;
    this.terminal = false; this.weave = rnd(0, 6.28); this.age = 0; this.senseT = rnd(0, 0.5); this.seesPlayer = false;
    this.audio = game.audio.createSource(T.sound);
    this.trail = type === 'cruise' ? game.fx.trails.create({ kind: 'missile', width: 1.0, opacity: 0.2 }) : null;
    this.syncModel();
  }
  syncModel() {
    const f = _v.copy(this.vel).normalize();
    const right = _v2.copy(f).cross(_v3.set(0, 1, 0)); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize();
    const up = _v3.copy(right).cross(f).normalize();
    _m.makeBasis(right, up, f.negate()); this.quat.setFromRotationMatrix(_m);
    _q.setFromAxisAngle(_v.set(0, 0, -1), this.bank); this.quat.multiply(_q);
    this.root.position.copy(this.pos); this.root.quaternion.copy(this.quat);
  }
  // ship entities on the other side, nearest first
  shipsToHit() {
    const out = [];
    for (const s of this.game.ships) { const e = s.entity; if (e && e.alive && e.team !== this.team) out.push(e); }
    return out.sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos));
  }
  // where to fly this step (unit vector into out)
  steer(out) {
    const g = this.game, p = this.pos, T = this.T;
    if (this.target && !this.target.alive && this.retarget) { this.target = this.shipsToHit()[0] || null; this.terminal = false; }
    const ground = Math.max(g.terrain.heightAt(p.x, p.z), 0);
    const holdY = (T.agl ? ground : 0) + this.alt;
    if (this.target) {
      const tp = this.target.pos, tv = this.target.vel;
      const R = Math.hypot(tp.x - p.x, tp.z - p.z), tof = Math.min(R / this.speed, 90);
      const lx = tp.x + tv.x * tof, lz = tp.z + tv.z * tof;
      if (R < (this.type === 'cruise' ? 700 : 1500)) this.terminal = true;
      if (this.terminal) return out.set(lx - p.x, tp.y + (this.type === 'cruise' ? 5 : 9) - p.y, lz - p.z).normalize();
      out.set(lx - p.x, 0, lz - p.z).normalize();
      // cruise missiles jink in the last few kilometres to spoil the ships' guns
      if (this.type === 'cruise' && R < 7000) out.addScaledVector(_v.set(-out.z, 0, out.x), 0.22 * Math.sin(this.age * 1.4 + this.weave)).normalize();
    } else if (this.dest) {
      out.set(this.dest.x - p.x, 0, this.dest.z - p.z);
      if (out.length() < 1500) { if (!this.orbit) this.orbit = this.dest.clone(); this.dest = null; }
      out.normalize();
    } else if (this.orbit) {
      const rx = p.x - this.orbit.x, rz = p.z - this.orbit.z, r = Math.hypot(rx, rz) || 1;
      out.set(-rz / r * this.orbitDir, 0, rx / r * this.orbitDir).addScaledVector(_v.set(-rx / r, 0, -rz / r), THREE.MathUtils.clamp((r - this.orbitR) / this.orbitR, -0.6, 1.2)).normalize();
    } else out.copy(this.vel).setY(0).normalize();
    // hold altitude, climbing early for terrain ahead
    const ahead = Math.max(g.terrain.heightAt(p.x + this.vel.x * 12, p.z + this.vel.z * 12), 0);
    const floor = Math.max(holdY, ahead + (T.agl ? this.alt : 150));
    out.y = THREE.MathUtils.clamp((floor - p.y) / 350, -0.35, 0.45);
    return out.normalize();
  }
  update(dt) {
    if (this.done) return;
    if (!this.alive) return this.updateFalling(dt);
    const g = this.game, T = this.T; this.age += dt;
    const want = this.steer(_v3.set(0, 0, 0)).clone();
    const V = this.speed * (this.terminal && this.type === 'attack' ? 1.4 : 1);
    const vhat = _v.copy(this.vel).normalize();
    const ang = Math.acos(THREE.MathUtils.clamp(vhat.dot(want), -1, 1));
    let turnRight = 0;
    if (ang > 1e-5) {
      const axis = _v2.copy(vhat).cross(want); if (axis.lengthSq() < 1e-10) axis.set(0, 1, 0); axis.normalize();
      const a = Math.min(ang, T.turn * D2R * dt * (this.terminal ? 2.5 : 1));
      turnRight = -axis.y * a / dt;
      vhat.applyAxisAngle(axis, a);
    }
    this.vel.copy(vhat).multiplyScalar(V);
    this.bank += (THREE.MathUtils.clamp(Math.atan(V * turnRight / G0), -1.05, 1.05) - this.bank) * Math.min(1, dt * 2.5);
    this.pos.addScaledVector(this.vel, dt);
    const ground = Math.max(g.terrain.heightAt(this.pos.x, this.pos.z), 0);
    if (!this.terminal && this.pos.y < ground + 8) { this.pos.y = ground + 8; if (this.vel.y < 0) this.vel.y = 0; }
    this.syncModel();
    if (this.model.prop) this.model.prop.blades.rotation.z += dt * 75;
    this.audio.update(this.pos, this.vel, { intensity: T.gain, ab: 0, rpm: 1 });
    if (this.trail) this.trail.add(this.pos);
    if (this.target && this.target.alive) {
      if (this.target.hitDistance(this.pos) < 3) this.impact(this.target);
      else if (this.terminal && this.pos.y < ground + 1) this.impact(null);
    } else if (this.terminal && this.pos.y < ground + 1) this.impact(null);
    if (this.age > 1500) this.remove();
  }
  // the warhead goes off: on a ship, or in the water next to it
  impact(hit) {
    const g = this.game, T = this.T; const p = this.pos.clone();
    this.remove(); this.impacted = true;
    if (hit) hit.damage(T.dmg, this, p);
    g.world.damageArea(p, 3, T.blast, T.dmg * 0.2, this, { ignore: hit || this });
    g.fx.explosion(p, this.type === 'cruise' ? 7.5 : 4.5, { surface: hit ? 'target' : 'water', water: !hit, fuel: true });
    if (hit && hit.alive && hit.ship) { const s = hit.ship, off = p.clone().sub(s.root.position); g.fx.addFire(p, this.type === 'cruise' ? 1.6 : 0.9, 150, { follow: () => off.clone().add(s.root.position) }); }
    if (this.onImpact) this.onImpact(hit);
  }
  // shot down: cruise missiles and most attack drones blow up in the air, the rest fall burning
  onDestroyedVisual() {
    const g = this.game;
    if (this.type === 'cruise' || (this.type === 'attack' && Math.random() < 0.6)) { g.fx.explosion(this.pos.clone(), this.type === 'cruise' ? 5 : 3.5, { surface: 'air', fuel: true }); this.remove(); return; }
    g.fx.explosion(this.pos.clone(), 2.5, { surface: 'air' });
    this.falling = true; this.fallT = 0; this.spin.set(rnd(-1.5, 1.5), rnd(-1, 1), rnd(-3, 3));
    this.vel.multiplyScalar(0.8);
    this.smoke = g.fx.trails.create({ kind: 'smoke', width: 1.4, grow: 1.4, maxAge: 9, opacity: 0.8, color: [0.1, 0.1, 0.1], minStep: 3 });
    this.fire_ = g.fx.addFire(this.pos, 0.35, 40, { follow: () => this.pos });
    if (this.audio) this.audio.stop();
  }
  updateFalling(dt) {
    if (!this.falling) return;
    const g = this.game; this.fallT += dt;
    this.vel.y -= G0 * dt; this.vel.multiplyScalar(1 - dt * 0.12);
    this.pos.addScaledVector(this.vel, dt);
    _q.setFromEuler(new THREE.Euler(this.spin.x * dt, this.spin.y * dt, this.spin.z * dt)); this.quat.multiply(_q);
    this.root.position.copy(this.pos); this.root.quaternion.copy(this.quat);
    if (this.smoke) this.smoke.add(this.pos);
    const th = g.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < Math.max(th, 0) || this.fallT > 90) {
      this.falling = false; g.fx.explosion(this.pos.clone(), 3, { surface: th > 0 ? 'ground' : 'water', water: th <= 0 });
      if (this.fire_) this.fire_.life = 0; if (this.smoke) this.smoke.stop();
      if (th > 0) g.fx.addFire(this.pos.clone(), 0.4, 60);
      this.remove();
    }
  }
  // out of the world: hidden, silent, swept from the lists at the end of the frame
  remove() {
    if (this.done) return;
    this.done = true; this.alive = false; this.root.visible = false; this.game.scene.remove(this.root);
    if (this.audio) this.audio.stop(); if (this.trail) this.trail.stop(); if (this.smoke) this.smoke.stop(); if (this.fire_) this.fire_.life = 0;
  }
  // sensors (called once a frame after the game clears its "enemy can see you" flag)
  sense(dt) {
    if (!this.alive) return;
    const g = this.game;
    this.senseT -= dt;
    if (this.senseT <= 0) {
      this.senseT = 0.5;
      if (this.type === 'recon') this.watch();
      else if (this.type === 'reaper') this.spot();
    }
    if (this.seesPlayer) g.gciSees = true;
  }
  // recon UAV: is the player in sight? (it reports him to the enemy fighters, who then come straight for him)
  watch() {
    const g = this.game, P = g.player;
    const was = this.seesPlayer;
    this.seesPlayer = !!(P.alive && !P.ac.crashed && !P.ac.onGround && P.pos.distanceTo(this.pos) < 32000 && g.terrain.lineOfSight(this.pos, P.pos, false, 0));
    if (this.seesPlayer && !was && !g.attract) g.comms.call('awacs', `${CS}, Magic, enemy drone overhead is reporting your position. Kill it and their fighters lose you.`,
      'An enemy spy drone can see you and tells its fighters where you are. Shoot it down (it is slow and can\'t fight back): lock it with T and fire, or use the gun (hold C).',
      { key: 'reconSees', every: 120, pri: 3, ttl: 12 });
  }
  // Reaper: marks enemy ground units and ships around it on the HUD
  spot() {
    const g = this.game; let fresh = 0;
    for (const e of g.world.entities) {
      // air defenses, warships and the mission's named targets (not every building and tank)
      if (!e.alive || e.spotted || e.team === this.team || !e.targetable || !(e.kind === 'sam' || e.kind === 'ship' || e.tag)) continue;
      if (Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) < 14000) { e.spotted = true; fresh++; }
    }
    if (fresh && !g.attract) {
      const first = !this.reported; this.reported = true;
      g.comms.call('awacs', first ? `${CS}, Reaper 1-1 on station. Eyes on ${fresh} target${fresh > 1 ? 's' : ''}, marked on your HUD.` : `${CS}, Reaper 1-1, ${fresh} more target${fresh > 1 ? 's' : ''} marked.`,
        first ? 'A friendly Reaper drone is circling high over the target area. Every enemy it sees now shows on your HUD as an orange diamond, even far away.' : 'The Reaper drone has found more enemies; they are marked on your HUD.',
        { from: 'REAPER', key: first ? 'reaper1' : 'reaperN', every: first ? 1e9 : 25, pri: 2, ttl: 10 });
    }
  }
}

// add a drone to the world
export function spawnDrone(g, type, o) {
  const d = new Drone(g, type, o);
  g.world.add(d); g.drones.push(d);
  return d;
}

// A wave of attack drones (or cruise missiles) launched from 'from' at the enemy ships: spread out abreast, half at
// the carrier, the rest at the nearest escorts; returns the drones.
export function launchRaid(g, { type = 'attack', n = 6, from, spread = 900, team = 'red', carrierShare = 0.5, onImpact } = {}) {
  const ships = g.ships.filter(s => s.entity && s.entity.alive && s.team !== team);
  if (!ships.length) return [];
  const cv = ships.find(s => s.deck) || ships[0];
  const others = ships.filter(s => s !== cv).sort((a, b) => a.pos.distanceTo(_v.set(from.x, 0, from.z)) - b.pos.distanceTo(_v.set(from.x, 0, from.z)));
  const hdg = Math.atan2(cv.pos.x - from.x, -(cv.pos.z - from.z));
  const out = [];
  for (let i = 0; i < n; i++) {
    const side = (i - (n - 1) / 2) * spread / Math.max(1, n - 1) * 2;
    const back = rnd(0, 600) + (i % 2) * 400;
    const x = from.x + Math.cos(hdg) * side - Math.sin(hdg) * back, z = from.z + Math.sin(hdg) * side + Math.cos(hdg) * back;
    const tgt = (i / n < carrierShare || !others.length ? cv : others[i % others.length]).entity;
    const y = (type === 'cruise' ? 15 : DRONE_TYPES[type].alt + rnd(-60, 80)) + Math.max(0, g.terrain.heightAt(x, z));
    out.push(spawnDrone(g, type, { pos: new THREE.Vector3(x, y, z), heading: hdg / D2R + rnd(-4, 4), target: tgt, team, onImpact, speed: DRONE_TYPES[type].speed * rnd(0.95, 1.06) }));
  }
  return out;
}

// per-frame housekeeping: sweep out drones that hit something or crashed
export function sweepDrones(g) {
  if (!g.drones.some(d => d.done)) return;
  for (const d of g.drones) if (d.done) g.world.remove(d);
  g.drones = g.drones.filter(d => !d.done);
}

// the radio when a drone goes down
export function droneKilled(g, e, src, byPlayer) {
  if (byPlayer) {
    g.kills++; g.audio.killConfirm();
    g.msg(`${e.name} DOWN`, 2.5, '#ffe680');
    const left = g.drones.filter(d => d.alive && d.team === 'red' && d.type !== 'recon').length;
    if (e.type === 'recon') g.comms.call('awacs', `Magic copies, splash the drone. ${CS}, they're blind.`, 'The enemy spy drone is down: their fighters no longer get your position from it.', { pri: 3, ttl: 8 });
    else g.comms.call('pilot', e.type === 'cruise' ? 'Splash the vampire!' : 'Splash the drone!', left ? `${left} more inbound.` : '', { key: 'dkill', every: 3, pri: 2, ttl: 4, dur: 2.2, say: e.type === 'cruise' ? 'Splash the vampire!' : 'Splash the drone!' });
  } else if (src && src.isWingman && src.creditKill) src.creditKill(e);
  else if (src && src.kind === 'ship' && src.team === 'blue') {
    g.comms.call('ship', `${src.name.charAt(0) + src.name.slice(1).toLowerCase()}, splash ${e.type === 'cruise' ? 'vampire' : 'drone'}.`, `The friendly warship ${src.name} shot down ${e.type === 'cruise' ? 'an anti-ship missile' : 'a drone'}.`, { from: src.name, key: 'shipsplash', every: 9, pri: 1, ttl: 5 });
  }
}
