// Entity container shared by weapons, sensors and AI.
import * as THREE from 'three';

let _id = 0;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Entity {
  constructor(world, o) {
    this.world = world; this.id = ++_id;
    this.team = o.team || 'red'; this.kind = o.kind || 'ground'; this.name = o.name || 'TARGET'; this.label = o.label || '?';
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.quat = new THREE.Quaternion();
    this.radius = o.radius || 6; this.hp = o.hp || 100; this.maxHp = this.hp; this.alive = true;
    this.rcs = o.rcs != null ? o.rcs : 5; this.irBase = o.ir != null ? o.ir : 0.2; this.heat = 0.3;
    this.root = o.root || null; this.hitSpheres = o.hitSpheres || null; this.mats = o.mats || null;
    this.radar = null; this.targetable = o.targetable !== false; this.value = o.value || 10;
    this.isPlayer = false; this.onKill = o.onKill || null; this.smoking = 0; this.hidden = false;
  }
  irIntensity(fromPos) { return this.irBase; }
  hitDistance(p) {
    if (!this.hitSpheres || !this.root) return p.distanceTo(this.pos) - this.radius;
    let best = 1e9;
    for (const hs of this.hitSpheres) {
      _v.copy(hs.c).applyQuaternion(this.root.quaternion).add(this.root.position);
      const d = p.distanceTo(_v) - hs.r; if (d < best) best = d;
    }
    return best;
  }
  damage(amount, src, point) {
    if (!this.alive) return;
    // hardened (bunkered) targets shrug off everything except a penetrating warhead
    if (this.hardened) { const pen = this.world.blast && this.world.blast.penetrator; if (!pen) { amount *= 0.04; if (this.onHardHit) this.onHardHit(src); } }
    this.hp -= amount;
    this.lastHitBy = src;
    if (this.onDamage) this.onDamage(amount, src, point);
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.world.onDestroyed(this, src, point); }
  }
}

// plain-English label for a target (markers, coach, debrief)
export function tagOf(e) {
  if (e.tag) return e.tag;
  if (e.kind === 'air') return e.name;
  if (/RADAR|\bSR\b|\bTR\b/.test(e.name)) return 'RADAR';
  if (/TEL/.test(e.name)) return 'SAM LAUNCHER';
  if (e.kind === 'sam') return 'SAM';
  if (e.name === 'ZSU-23-4') return 'AA GUN';
  if (e.kind === 'ship') return 'WARSHIP';
  return e.name;
}

export class World {
  constructor(game) {
    this.game = game;
    this.entities = []; this.missiles = []; this.flares = []; this.chaff = []; this.radars = []; this.laserSpots = [];
    this.events = [];
  }
  add(e) { this.entities.push(e); return e; }
  remove(e) { const i = this.entities.indexOf(e); if (i >= 0) this.entities.splice(i, 1); }
  enemiesOf(team) { return this.entities.filter(e => e.alive && e.team !== team && e.targetable); }
  // area damage with linear falloff beyond the lethal core
  damageArea(p, killR, maxR, dmg, src, opts = {}) {
    for (const e of this.entities) {
      if (!e.alive || e === opts.ignore) continue;
      const d = e.hitDistance(p);
      if (d > maxR) continue;
      const f = d <= killR ? 1 : 1 - (d - killR) / (maxR - killR);
      e.damage(dmg * f * (e.kind === 'ship' ? (opts.shipMul || 1) : 1), src, p);
    }
    // missiles can be destroyed by blasts too (e.g. flak, SAM vs missile)
    for (const m of this.missiles) {
      if (m.dead || m === opts.ignoreMissile) continue;
      if (m.pos.distanceTo(p) < Math.min(maxR, 18) && opts.killsMissiles) m.destroy('blast');
    }
  }
  onDestroyed(e, src, point) { this.game.onDestroyed(e, src, point); }
}
