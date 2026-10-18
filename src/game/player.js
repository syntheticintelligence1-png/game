// Player aircraft: entity wrapper around the 6-DOF model, stores management, fire control, targeting pod,
// countermeasures, damage, vapor/contrail effects and HUD-state assembly.
import * as THREE from 'three';
import { Entity, tagOf } from './world.js';
import { Aircraft, JET } from '../sim/flight.js';
import { buildFighter, STATIONS, JET_GEOM } from '../models/fighter.js';
import { buildMunition } from '../models/munitions.js';
import { Missile, Flare, Chaff, DEFS, predictBallistic, lcosSolution, launchZone } from '../sim/weapons.js';
import { PlayerRadar } from '../sim/radar.js';
import { AfterburnerFlame } from '../fx/fx.js';
import { attachLights, HORNET_LIGHTS } from '../fx/navlights.js';
import { KTS, FT, G0 } from '../sim/atmo.js';

const D2R = Math.PI / 180;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();

export const LOADOUTS = {
  multirole: { L1: 'aim9x', R1: 'aim9x', L2: 'aim120', R2: 'aim120', R6: 'aim120', L3: 'agm88', R3: 'agm88', L4: 'gbu39x4', R4: 'gbu31', C5: 'gbu31' },
  strike: { L1: 'aim9x', R1: 'aim9x', L2: 'agm88', R2: 'agm88', L3: 'gbu39x4', R3: 'gbu39x4', L4: 'gbu31', R4: 'gbu31', R6: 'aim120' },
  air: { L1: 'aim9x', R1: 'aim9x', L2: 'aim120', R2: 'aim120', L3: 'aim120', R3: 'aim120', L4: 'aim120', R4: 'aim120', R6: 'aim120' },
  cas: { L1: 'aim9x', R1: 'aim9x', L2: 'agm65', R2: 'agm65', L3: 'agm65', R3: 'agm65', L4: 'gbu12', R4: 'gbu12', C5: 'mk84', R6: 'aim120' },
  // campaign stages: four anti-radar missiles and eight small bombs; five Harpoons (the warships shoot some down)
  sead: { L1: 'aim9x', R1: 'aim9x', L2: 'agm88', R2: 'agm88', L3: 'agm88', R3: 'agm88', L4: 'gbu39x4', R4: 'gbu39x4', R6: 'aim120' },
  naval: { L1: 'aim9x', R1: 'aim9x', L2: 'aim120', R2: 'aim120', L3: 'agm84', R3: 'agm84', L4: 'agm84', R4: 'agm84', C5: 'agm84', R6: 'aim120' },
  // the ring course: wingtip missiles only, nothing to slow the jet down
  clean: { L1: 'aim9x', R1: 'aim9x' },
};
// What the jet is loaded with for a mission (mission.kind). 'auto', the menu default, is the mission's own load. Any
// pick flies the city strike with bunker busters, as nothing else hurts the bunker: air-to-air only becomes the mixed
// load, and a load without them gets two on the inboard pylons. A campaign stage always flies its own load (stage).
export function missionLoadout(pick, kind, stage) {
  if (stage && LOADOUTS[stage]) return LOADOUTS[stage];
  if (kind === 'rings') return LOADOUTS.clean;
  const L = pick !== 'auto' && LOADOUTS[pick];
  if (kind === 'strike') {
    if (!L) return LOADOUTS.strike;
    if (pick === 'air') return LOADOUTS.multirole;
    return Object.values(L).includes('gbu31') ? L : { ...L, L4: 'gbu31', R4: 'gbu31' };
  }
  if (kind === 'dogfight' && !L) return LOADOUTS.air;
  return L || LOADOUTS.multirole;
}
const PLAIN = { gbu39: 'small guided bomb', aim9x: 'heat-seeker', aim120: 'radar missile', agm65: 'guided missile', agm84: 'anti-ship missile', agm88: 'anti-radar missile', gbu12: 'laser bomb', gbu31: 'bunker buster', mk84: 'big bomb', cbu: 'cluster bomb' };
const WEAPON_KEYS = { Digit1: ['aim9x'], Digit2: ['aim120'], Digit3: ['gbu39', 'agm65', 'agm84'], Digit4: ['gbu31', 'gbu12', 'mk84', 'cbu'], Digit5: ['agm88'] };
const GROUND_KINDS = new Set(['ground', 'sam', 'structure', 'ship']);

export class Player extends Entity {
  constructor(game, loadoutName = 'multirole') {
    const mdl = buildFighter();
    super(game.world, { team: 'blue', kind: 'air', name: 'HORNET 1-1', label: 'F18', radius: 9, hp: 100, rcs: 4, ir: 1, root: mdl.root, hitSpheres: mdl.info.hitSpheres });
    this.game = game; this.isPlayer = true; this.model = mdl; game.scene.add(mdl.root);
    this.ac = new Aircraft(game.env);
    this.radar = new PlayerRadar(game);
    this.loadoutName = loadoutName; this.stores = [];
    this.navLights = attachLights(mdl.root, HORNET_LIGHTS, { phase: 0 });
    this.flames = [new AfterburnerFlame(0.4, 7.5), new AfterburnerFlame(0.4, 7.5)];
    this.flames.forEach((f, i) => { f.group.position.copy(i === 0 ? JET_GEOM.nozzleL : JET_GEOM.nozzleR); f.group.position.z -= 0.05; mdl.root.add(f.group); });
    this.sel = 'aim120'; this.gunRounds = 578; this.flares = 60; this.chaff = 60;
    this.gunT = 0; this.firingGun = false; this.gunHeat = 0;
    this.tgp = { target: null, point: null, laser: { pos: new THREE.Vector3(), vel: new THREE.Vector3(), on: false, owner: 'player' }, mode: 2, fov: 6 };
    game.world.laserSpots.push(this.tgp.laser);
    this.seeker9 = { dir: new THREE.Vector3(0, 0, -1), lock: null, tone: 0 };
    this.history = []; // for gun funnel (EEGS)
    this.trails = {}; this.alive = true; this.deadT = 0; this.gStress = 0; this.redStress = 0; this.gloc = 0;
    this.ccrpHold = false; this.lastWarn = 0; this.rwr = []; this.rwrLevel = 'none'; this.prevContacts = 0;
    this.applyLoadout(loadoutName);
  }

  // a LOADOUTS name or a station → weapon map (missionLoadout)
  applyLoadout(load) {
    for (const s of this.stores) if (s.mesh) this.model.root.remove(s.mesh.root);
    this.stores = [];
    const L = typeof load === 'object' ? load : LOADOUTS[load] || LOADOUTS.multirole;
    let mass = 0, drag = 0;
    for (const r of this.racks || []) this.model.root.remove(r);
    this.racks = [];
    for (const st of STATIONS) {
      let k = L[st.id]; if (!k) continue;
      const pack = /x(\d)$/.exec(k); const n = pack ? +pack[1] : 1; if (pack) k = k.slice(0, -2);
      if (n > 1) { // BRU-61 style rack: two pairs in tandem under the pylon
        const rack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 2.3), new THREE.MeshStandardMaterial({ color: 0x8c9196, roughness: 0.6, metalness: 0.3 }));
        rack.position.set(st.pos[0], st.pos[1] - 0.1, st.pos[2] + 0.4); this.model.root.add(rack); this.racks.push(rack); drag += 0.0006;
      }
      for (let i = 0; i < n; i++) {
        const m = buildMunition(DEFS[k].model);
        const off = st.rail === 'tip' ? 0.0 : -(DEFS[k].d / 2 + 0.05) - (n > 1 ? 0.14 : 0);
        const ox = n > 1 ? (i % 2 ? 0.13 : -0.13) : 0, oz = n > 1 ? (i < 2 ? -0.95 : 0.95) : 0;
        m.root.position.set(st.pos[0] + ox, st.pos[1] + off, st.pos[2] + 0.4 + oz);
        this.model.root.add(m.root);
        this.stores.push({ st, key: k, mesh: m, off: [ox, n > 1 ? -0.14 : 0, oz] });
        mass += DEFS[k].mass; drag += DEFS[k].d * 0.004 + 0.0008;
      }
    }
    this.ac.storesMass = mass; this.ac.storesDrag = drag;
    if (!this.stores.find(s => s.key === this.sel)) this.sel = this.stores.length ? this.stores[0].key : 'gun';
    this.gunRounds = 578; this.flares = 60; this.chaff = 60;
  }
  count(key) { return this.stores.filter(s => s.key === key).length; }
  inventory() {
    const out = []; const seen = new Set();
    for (const [code, keys] of Object.entries(WEAPON_KEYS)) for (const k of keys) { const n = this.count(k); if (n && !seen.has(k)) { seen.add(k); out.push({ key: code.slice(-1), name: `${DEFS[k].name} ${PLAIN[k] || ''}`.trim(), n, sel: this.sel === k, k }); } }
    out.push({ key: 'C', name: 'M61A2', n: this.gunRounds, sel: false, k: 'gun' });
    return out;
  }
  selectKey(code) {
    const keys = WEAPON_KEYS[code]; if (!keys) return;
    const avail = keys.filter(k => this.count(k) > 0); if (!avail.length) { this.game.msg('NONE OF THOSE LEFT — TRY ANOTHER NUMBER (1–5)', 1.4); return; }
    const i = avail.indexOf(this.sel); this.sel = avail[(i + 1) % avail.length];
    this.game.audio.weaponSelect(); this.game.msg(`${DEFS[this.sel].name} ${PLAIN[this.sel] || ''} SELECTED`.replace('  ', ' '), 1.4);
  }

  damage(amount, src, point) {
    if (this.game.opts.invulnerable) { if (amount > 5) { this.game.rig.shake = Math.min(2, this.game.rig.shake + 0.6); this.game.audio.hullHit(0.6); this.game.msg('HIT! (PRACTICE: NO DAMAGE)', 1, '#ffb080'); } return; }
    super.damage(amount, src, point);
    if (this.alive && amount > 2) this.game.audio.hullHit(amount / 30);
    if (this.alive && amount > 5) { this.game.rig.shake = Math.min(2, this.game.rig.shake + amount / 40); if (this.hp < 70) this.ac.engineHealth = Math.max(0.25, this.hp / 100); }
  }
  get airWeapon() { return this.sel === 'aim9x' || this.sel === 'aim120'; }
  irIntensity(from) {
    const fwd = this.ac.forward(_v); const toObs = _v2.copy(from).sub(this.pos).normalize();
    const aspect = -fwd.dot(toObs);
    return this.ac.ir * (0.3 + 0.7 * Math.max(0, aspect) ** 0.7) + 0.3;
  }
  sync() { const s = this.ac.s; this.pos.copy(s.p); this.vel.copy(s.v); this.quat.copy(s.q); this.root.position.copy(s.p); this.root.quaternion.copy(s.q); }

  // ---------------- per-frame logic ----------------
  update(dt, input) {
    const g = this.game, ac = this.ac;
    if (!this.alive) { this.deadT += dt; return; }
    this.sync();
    this.radar.update(g.world, this, dt);
    // targeting pod: track designated target or ground point under boresight
    this.updateTGP(dt);
    // AIM-9X seeker
    this.updateSeeker9(dt);
    // gun
    this.firingGun = (input.down('KeyC') || (input.mouse.buttons & 1 && input.locked && g.rig.mode !== 'cockpit')) && this.gunRounds > 0 && !g.uiCapture;
    if (input.mouse.buttons & 1 && g.rig.mode === 'cockpit' && input.locked) this.firingGun = this.gunRounds > 0;
    if (this.firingGun) this.fireGun(dt); else this.gunT = 0;
    g.audio.setPlayerGun(this.firingGun);
    // gun funnel history
    this.history.push({ p: ac.s.p.clone(), v: ac.s.v.clone(), f: ac.forward(new THREE.Vector3()), t: g.time });
    while (this.history.length && g.time - this.history[0].t > 1.6) this.history.shift();
    // CCRP auto release
    if (this.ccrpHold && this.ccrp && this.ccrp.timeToRelease <= 0.05 && this.ccrp.timeToRelease > -1) { this.releaseSelected(); this.ccrpHold = false; }
    if (!input.down('Space')) this.ccrpHold = false;
    // effects
    this.flames.forEach(f => f.set(ac.ab, ac.rpm));
    this.navLights.setGear(ac.gear > 0.9 ? 1 : 0);
    this.model.nozzles.forEach(n => { const k = 1 + ac.ab * 0.18 - (ac.rpm - 0.7) * 0.1; n.petals.scale.set(k, k, 1); n.glow.material.color.setRGB(1 + ac.ab * 6, 0.35 + ac.ab * 2, 0.1 + ac.ab * 0.6); });
    this.animateSurfaces();
    this.vapor(dt);
    // damage effects
    if (this.hp < 60 && !this.trails.smoke) this.trails.smoke = g.fx.trails.create({ kind: 'smoke', width: 1.6, grow: 1.4, maxAge: 9, opacity: 0.75, color: [0.14, 0.14, 0.14] });
    if (this.trails.smoke) this.trails.smoke.add(_v.copy(JET_GEOM.nozzleL).applyQuaternion(ac.s.q).add(ac.s.p));
    this.physiology(dt);
  }

  physiology(dt) {
    const nz = this.ac.nz;
    // sustained +G greys out vision progressively (G-suit tolerance ~ 7.5 G), -G reds out
    if (nz > 5.2) this.gStress += (nz - 5.2) * dt * 0.11; else this.gStress -= dt * (0.18 + Math.max(0, 4 - nz) * 0.04);
    this.gStress = THREE.MathUtils.clamp(this.gStress, 0, 1.35);
    if (nz < -2.2) this.redStress += (-nz - 2.2) * dt * 0.35; else this.redStress -= dt * 0.4;
    this.redStress = THREE.MathUtils.clamp(this.redStress, 0, 1);
    if (this.gStress > 1.1 && this.gloc <= 0) { this.gloc = 4.5; this.game.msg('BLACKED OUT — TOO MANY G', 2, '#ff8080'); }
    if (this.gloc > 0) this.gloc -= dt;
  }

  animateSurfaces() {
    const ac = this.ac, P = this.model.pivots;
    const de = ac.de, da = ac.da, dr = ac.dr;
    P.stabL.rotation.x = -de * 0.9 - da * 0.35; P.stabR.rotation.x = -de * 0.9 + da * 0.35;
    P.ailL.rotation.x = -da * 0.9; P.ailR.rotation.x = da * 0.9;
    const fl = ac.flap * 0.55; P.flapL.rotation.x = fl; P.flapR.rotation.x = fl;
    P.rudL.rotation.y = -dr * 0.6; P.rudR.rotation.y = -dr * 0.6;
    P.airbrake.rotation.x = -ac.airbrakePos * 0.9;
    // gear retraction (and strut compression)
    const g = ac.gear; const G = this.model.gear;
    G.nose.rotation.x = (1 - g) * 1.6; G.mainL.rotation.z = (1 - g) * 1.5; G.mainR.rotation.z = -(1 - g) * 1.5;
    G.nose.visible = G.mainL.visible = G.mainR.visible = g > 0.02;
    G.noseStrut.position.y = (ac.compress[0] || 0) * 0.9;
    const kneel = this.game.ops && (this.game.ops.cat.state !== 'none') ? 1 : 0;
    G.launchBar.rotation.x = kneel ? -0.55 : -0.05;
    this.model.hook.rotation.x = this.game.ops ? this.game.ops.hookAngle : 0;
  }

  vapor(dt) {
    const g = this.game, ac = this.ac, s = ac.s;
    const wt = (p) => _v.copy(p).applyQuaternion(s.q).add(s.p);
    const humid = s.p.y < 3000;
    const vort = (ac.nz > 4.2 || Math.abs(ac.alpha) > 14 * D2R) && ac.tas > 90 && humid;
    if (vort) {
      if (!this.trails.vl) { this.trails.vl = g.fx.trails.create({ kind: 'vortex', width: 0.3, opacity: 0.55 }); this.trails.vr = g.fx.trails.create({ kind: 'vortex', width: 0.3, opacity: 0.55 }); this.trails.ll = g.fx.trails.create({ kind: 'vortex', width: 1.0, opacity: 0.32, maxAge: 0.12, grow: 3 }); this.trails.lr = g.fx.trails.create({ kind: 'vortex', width: 1.0, opacity: 0.32, maxAge: 0.12, grow: 3 }); }
      this.trails.vl.add(wt(JET_GEOM.wingtipL)); this.trails.vr.add(wt(JET_GEOM.wingtipR));
      if (Math.abs(ac.alpha) > 12 * D2R) { this.trails.ll.add(wt(JET_GEOM.lexL)); this.trails.lr.add(wt(JET_GEOM.lexR)); }
    } else if (this.trails.vl) { for (const k of ['vl', 'vr', 'll', 'lr']) { this.trails[k].stop(); this.trails[k] = null; } }
    // contrails at altitude
    if (s.p.y > 8800 && ac.rpm > 0.8) {
      if (!this.trails.c1) { this.trails.c1 = g.fx.trails.create({ kind: 'contrail', width: 1.4, opacity: 0.5 }); this.trails.c2 = g.fx.trails.create({ kind: 'contrail', width: 1.4, opacity: 0.5 }); }
      this.trails.c1.add(wt(JET_GEOM.nozzleL).addScaledVector(s.v, -0.2)); this.trails.c2.add(wt(JET_GEOM.nozzleR).addScaledVector(s.v, -0.2));
    } else if (this.trails.c1) { this.trails.c1.stop(); this.trails.c2.stop(); this.trails.c1 = this.trails.c2 = null; }
    // transonic vapor cone (Prandtl-Glauert condensation) in humid air
    if (g.vaporCone) { const k = ac.mach > 0.93 && ac.mach < 1.07 && humid ? 1 - Math.abs(ac.mach - 1.0) / 0.07 : 0; g.vaporCone.set(k); }
  }

  // ---------------- weapons ----------------
  fireGun(dt) {
    const g = this.game, ac = this.ac; const s = ac.s;
    this.gunT -= dt; let n = 0;
    while (this.gunT <= 0 && this.gunRounds > 0) {
      this.gunT += 0.01; this.gunRounds--; n++;
      const fwd = _v.set(0, 0.0262, -1).normalize().applyQuaternion(s.q); // gun line 1.5 deg up
      const muz = _v2.copy(JET_GEOM.gun).applyQuaternion(s.q).add(s.p);
      const disp = _v3.set((Math.random() - 0.5) * 0.006, (Math.random() - 0.5) * 0.006, (Math.random() - 0.5) * 0.006);
      const vel = fwd.clone().add(disp).normalize().multiplyScalar(1030).add(s.v);
      g.bullets.spawn(muz, vel, 'blue', 8, this.gunRounds % 4 === 0, this, 5.7e-4, 1);
    }
    if (n) { const fwd = _v.set(0, 0, -1).applyQuaternion(s.q); g.fx.muzzleFlash(_v2.copy(JET_GEOM.gun).applyQuaternion(s.q).add(s.p), fwd, 1.2); }
  }

  updateSeeker9(dt) {
    const g = this.game; const S = this.seeker9;
    if (this.sel !== 'aim9x' || !this.count('aim9x')) { S.lock = null; g.audio.setSeekerTone(0); return; }
    const fwd = this.ac.forward(_v);
    // slaved to radar track if within gimbal, else boresight / helmet cue
    let cue = fwd.clone();
    if (this.radar.stt && this.radar.stt.alive) cue.copy(this.radar.stt.pos).sub(this.pos).normalize();
    else if (g.rig.mode === 'cockpit') cue.set(0, 0, -1).applyQuaternion(g.camera.quaternion);
    if (cue.dot(fwd) < Math.cos(90 * D2R)) cue.copy(fwd);
    if (S.lock && (!S.lock.alive || S.lock.pos.distanceTo(this.pos) > 18000)) S.lock = null;
    if (!S.lock) {
      let best = null, bw = 0.35;
      for (const e of g.world.entities) {
        if (!e.alive || e.team === this.team || e.kind !== 'air') continue;
        const d = _v2.copy(e.pos).sub(this.pos); const R = d.length(); if (R > 16000) continue; d.normalize();
        if (d.dot(cue) < Math.cos(4.5 * D2R)) continue;
        const w = e.irIntensity(this.pos) * Math.exp(-R / 12000) * g.cloudTransmittance(this.pos, e.pos);
        if (w > bw) { bw = w; best = e; }
      }
      if (best) { S.lock = best; g.audio.lockTone(); }
      S.dir.lerp(cue, Math.min(1, dt * 8)).normalize();
    } else S.dir.copy(S.lock.pos).sub(this.pos).normalize();
    const str = S.lock ? Math.min(1, S.lock.irIntensity(this.pos) / 4) : 0;
    g.audio.setSeekerTone(S.lock ? 2 : 1, str);
  }

  // T: lock whatever is nearest to where you're pointing - jets or ground targets - and ready a weapon that can hit it
  designate(viewDir) {
    const g = this.game, W = g.world;
    const cands = [];
    const preferAir = this.airWeapon || this.sel === 'gun';
    for (const e of W.entities) {
      if (!e.alive || e.team === this.team || !e.targetable || e.hidden) continue;
      const d = _v.copy(e.pos).sub(this.pos); const R = d.length(); d.multiplyScalar(1 / Math.max(R, 1));
      const ang = Math.acos(Math.max(-1, Math.min(1, d.dot(viewDir)))) / D2R;
      if (e.kind === 'air') { if (ang < 50 && R < 120000 && this.radar.detect(W, this, e)) cands.push({ e, air: true, s: ang - (preferAir ? 8 : 0) + R / 9000 }); }
      else if (GROUND_KINDS.has(e.kind)) {
        // ground targets sit below the nose: judge mostly by left/right, only lightly by how far below
        const az = Math.atan2(d.x * viewDir.z - d.z * viewDir.x, d.x * viewDir.x + d.z * viewDir.z) / D2R;
        const el = (Math.asin(Math.max(-1, Math.min(1, d.y))) - Math.asin(Math.max(-1, Math.min(1, viewDir.y)))) / D2R;
        const gAng = Math.hypot(az, el * 0.3);
        if (gAng < 35 && R < 45000) cands.push({ e, air: false, s: gAng - (preferAir ? 0 : 8) + R / 9000 + (e.isBunker && this.count('gbu31') && (this.sel === 'gbu31' || (g.mission && g.mission.state === 'strike')) ? -5 : 0) });
      }
    }
    if (!cands.length) { g.msg('NOTHING TO LOCK AHEAD — POINT YOUR NOSE AT AN ENEMY', 1.6); return; }
    cands.sort((a, b) => a.s - b.s);
    const pick = cands[0].e === this.lastLocked && cands.length > 1 ? cands[1] : cands[0]; // T again = next one
    const e = pick.e; this.lastLocked = e; g.audio.lockTone();
    const km = (e.pos.distanceTo(this.pos) / 1000).toFixed(1);
    if (pick.air) {
      this.radar.stt = e; this.radar.sttLost = 0; if (e.onLocked) e.onLocked(this);
      if (!this.airWeapon) { const k = this.count('aim120') ? 'aim120' : this.count('aim9x') ? 'aim9x' : null; if (k) this.sel = k; }
      if (this.sel === 'aim9x') this.seeker9.lock = null;
      g.msg(`LOCKED ${e.name} — ${km} KM${this.airWeapon ? ` — ${PLAIN[this.sel].toUpperCase()} READY` : ''}`, 1.8);
    } else {
      this.tgp.target = e;
      if (!this.canEngage(this.sel, e)) { const k = this.bestGroundWeapon(e); if (k) this.sel = k; }
      g.msg(`MARKED ${tagOf(e)} — ${km} KM — ${this.canEngage(this.sel, e) ? `${(PLAIN[this.sel] || DEFS[this.sel].name).toUpperCase()} READY` : 'NO WEAPON FOR IT'}`, 2);
    }
  }
  canEngage(k, e) {
    if (!k || k === 'gun') return true;
    if (k === 'aim9x' || k === 'aim120') return e.kind === 'air';
    if (e.kind === 'air') return false;
    if (k === 'agm88') return !!e.radar;
    if (e.isBunker) return k === 'gbu31';
    return true;
  }
  bestGroundWeapon(e) {
    if (e.isBunker) return this.count('gbu31') ? 'gbu31' : null;
    if (e.kind === 'ship' && this.count('agm84')) return 'agm84';
    for (const k of ['gbu39', 'agm65', 'gbu12']) if (this.count(k)) return k;
    if (e.radar && this.count('agm88')) return 'agm88';
    for (const k of ['gbu31', 'cbu', 'mk84']) if (this.count(k)) return k;
    return null;
  }
  // ripple attacks: after a small bomb goes, mark the next nearby target nobody is already bombing
  markNext(prev) {
    const g = this.game; const busy = new Set(g.world.missiles.filter(m => !m.dead && m.team === 'blue' && m.target).map(m => m.target));
    let best = null, bd = 6000;
    for (const e of g.world.entities) {
      if (!e.alive || e.team === this.team || !GROUND_KINDS.has(e.kind) || e.isBunker || busy.has(e) || e === prev || !e.targetable) continue;
      const d = e.pos.distanceTo(prev.pos); if (d < bd) { bd = d; best = e; }
    }
    if (best) { this.tgp.target = best; this.lastLocked = best; g.msg(`NEXT TARGET MARKED: ${tagOf(best)} — SPACE AGAIN TO BOMB IT`, 2.2); }
  }

  updateTGP(dt) {
    const g = this.game; const T = this.tgp;
    if (T.target && !T.target.alive) { T.target = null; }
    const pod = _v.copy(JET_GEOM.tgp).applyQuaternion(this.ac.s.q).add(this.ac.s.p);
    T.podPos = T.podPos || new THREE.Vector3(); T.podPos.copy(pod);
    if (T.target) T.point = (T.point || new THREE.Vector3()).copy(T.target.pos).add(_v2.set(0, 1.2, 0));
    else {
      // look at the ground under the gun line
      const f = this.ac.forward(_v2); f.y -= 0.35; f.normalize();
      const hit = g.raycastGround(pod, f, 30000);
      T.point = hit;
    }
    // laser designation (needs line of sight and gimbal within ~150 deg off nose)
    const L = T.laser;
    L.on = false;
    if (T.target && T.point) {
      const vis = g.terrain.lineOfSight(pod, T.point, false, 0);
      const dirTo = _v3.copy(T.point).sub(pod).normalize();
      const below = dirTo.dot(this.ac.up(new THREE.Vector3())) < 0.3;
      if (vis && below) { L.on = true; L.pos.copy(T.point); L.vel.copy(T.target.vel); }
    }
  }

  canRelease(key) { return this.stores.some(s => s.key === key); }
  popStore(key) {
    // release outboard -> inboard alternating
    const list = this.stores.filter(s => s.key === key); if (!list.length) return null;
    list.sort((a, b) => Math.abs(b.st.pos[0]) - Math.abs(a.st.pos[0]));
    const st = list[0]; this.stores.splice(this.stores.indexOf(st), 1);
    this.model.root.remove(st.mesh.root);
    this.ac.storesMass -= DEFS[key].mass; this.ac.storesDrag -= DEFS[key].d * 0.004 + 0.0008;
    return st;
  }

  // Space: fire selected weapon
  fireSelected(input) {
    const g = this.game; const key = this.sel;
    if (!this.canRelease(key)) { g.msg('NONE LEFT — PICK ANOTHER WEAPON (1–5)', 1.4); return; }
    const d = DEFS[key];
    if (key === 'gbu31' || key === 'gbu39') {
      const T = this.tgp.target && this.tgp.target.alive ? this.tgp.target : null;
      if (!T) { g.msg('MARK A TARGET FIRST: POINT AT IT AND PRESS T', 2.4); return; }
      const L = this.jdamLAR(T.pos, key);
      if (L.range > L.rMax) { g.msg(`TOO FAR — GET WITHIN ${(L.rMax / 1000).toFixed(1)} KM (NOW ${(L.range / 1000).toFixed(1)} KM)`, 1.8); return; }
      if (L.range < L.rMin) { g.msg('TOO CLOSE — FLY AWAY A LITTLE AND COME BACK', 1.8); return; }
      this.releaseSelected();
      if (key === 'gbu39') this.markNext(T);
      return;
    }
    if (d.bomb && (this.tgp.target && this.ccrp)) { this.ccrpHold = true; g.msg('KEEP HOLDING SPACE AND FLY AT THE TARGET — THE BOMB DROPS ITSELF', 2.2); return; }
    this.releaseSelected();
  }
  releaseSelected() {
    const g = this.game; const key = this.sel; const d = DEFS[key]; const ac = this.ac; const s = ac.s;
    let target = null, tpoint = null;
    if (key === 'aim120') { target = this.radar.stt; if (!target) { g.msg('NO LOCK — PRESS T TO LOCK A JET FIRST', 1.6); return; } }
    if (key === 'aim9x') { target = this.seeker9.lock; if (!target) g.msg('NO LOCK — MISSILE FIRED STRAIGHT AHEAD', 1.4); }
    if (key === 'agm65' || key === 'agm84') { target = this.tgp.target; tpoint = this.tgp.point; }
    if (key === 'gbu31' || key === 'gbu39') { target = this.tgp.target; tpoint = target ? target.pos.clone() : null; }
    if (key === 'agm88') { target = this.tgp.target && this.tgp.target.radar ? this.tgp.target : g.findEmitter(this); if (!target) { g.msg('NO ENEMY RADAR FOUND FOR THE ANTI-RADAR MISSILE', 1.6); return; } }
    const st = this.popStore(key); if (!st) return;
    const o = st.off || [0, 0, 0];
    const p = _v.set(st.st.pos[0] + o[0], st.st.pos[1] + o[1] - (st.st.rail === 'tip' ? 0.2 : d.d / 2 + 0.3), st.st.pos[2] + o[2]).applyQuaternion(s.q).add(s.p);
    const down = _v2.set(0, -1, 0).applyQuaternion(s.q).multiplyScalar(d.bomb ? 4 : 2.5);
    const m = new Missile(g, key, { team: 'blue', shooter: this, target, targetPoint: tpoint, pos: p.clone(), vel: s.v.clone().add(down), quat: s.q, seekerDir: key === 'aim9x' ? this.seeker9.dir : null });
    if (key === 'aim9x' && !target) { m.seekerDir.copy(this.ac.forward(new THREE.Vector3())); }
    g.world.missiles.push(m); g.lastMissile = m;
    g.msg(`${d.name} AWAY`, 1.5);
    if (g.comms) g.comms.fired(key); // "Fox three!", "Magnum!", "Rifle!"… on the radio
    if (key === 'agm65' || key === 'agm84') g.takeover(m);
  }

  dropCountermeasure(kind) {
    const g = this.game; const s = this.ac.s;
    if (kind === 'flare') {
      if (this.flares <= 0) { g.msg('FLARES EMPTY', 1); return; }
      for (let i = 0; i < 2 && this.flares > 0; i++) {
        this.flares--;
        const side = i === 0 ? -1 : 1;
        const ej = _v.set(side * 18, -22, 12).applyQuaternion(s.q);
        g.world.flares.push(new Flare(g, _v2.set(side * 0.6, -0.8, 5.5).applyQuaternion(s.q).add(s.p), s.v.clone().multiplyScalar(0.92).add(ej)));
      }
      g.audio.flare();
    } else {
      if (this.chaff <= 0) { g.msg('CHAFF EMPTY', 1); return; }
      this.chaff--;
      g.world.chaff.push(new Chaff(g, _v.set(0, -0.8, 4).applyQuaternion(s.q).add(s.p), s.v.clone().multiplyScalar(0.6)));
      g.audio.chaff();
      // visual: a burst of glittering particles
      for (let i = 0; i < 18; i++) g.fx.ps.add.spawn(3, s.p.x, s.p.y, s.p.z, (Math.random() - 0.5) * 30 + s.v.x * 0.5, (Math.random() - 0.5) * 30 + s.v.y * 0.5, (Math.random() - 0.5) * 30 + s.v.z * 0.5, 0.3, 1.5, { color: [3, 3, 3], drag: 2 });
    }
  }

  // GPS bomb launch-acceptable region: glide reach from height and speed
  jdamLAR(tp, key = 'gbu31') {
    const s = this.ac.s; const h = Math.max(50, s.p.y - tp.y); const V = Math.max(120, Math.hypot(s.v.x, s.v.z));
    const rb = V * Math.sqrt(2 * h / 9.81);
    const range = Math.hypot(tp.x - s.p.x, tp.z - s.p.z);
    const sdb = key === 'gbu39';
    const rMax = sdb ? rb * 2.6 + 3000 : rb * 1.9 + 1500, rMin = Math.min(rb * 0.25, sdb ? 800 : 1200);
    return { range, rMax, rMin, inRange: range <= rMax && range >= rMin };
  }

  // ---------------- fire control for the HUD ----------------
  fireControl() {
    const g = this.game, ac = this.ac, s = ac.s; const out = {};
    const key = this.sel; const d = DEFS[key];
    this.ccrp = null; this.ccip = null;
    if (d && d.bomb && this.count(key)) {
      const pred = predictBallistic(g, s.p, _v.copy(s.v).add(_v2.set(0, -4, 0).applyQuaternion(s.q)), d.mass, d.d, d.cd0 + 0.04, 80, 0.06);
      if (this.tgp.target && pred) {
        // CCRP: compare predicted impact with the designated target along track
        const tp = this.tgp.target.pos;
        const fwdH = _v3.copy(s.v); fwdH.y = 0; fwdH.normalize();
        const toT = _v2.copy(tp).sub(s.p); toT.y = 0;
        const toI = new THREE.Vector3().copy(pred.point).sub(s.p); toI.y = 0;
        const along = toT.dot(fwdH) - toI.dot(fwdH);
        const gs = Math.max(30, Math.hypot(s.v.x, s.v.z));
        const az = Math.atan2(fwdH.x * toT.z - fwdH.z * toT.x, fwdH.dot(toT));
        this.ccrp = { target: tp.clone(), timeToRelease: along / gs, azErr: -az, impact: pred.point };
        out.ccrp = this.ccrp;
      } else if (pred) { this.ccip = pred; out.ccip = pred; }
    }
    if (key === 'gun' || this.firingGun || (this.radar.stt && this.radar.stt.pos.distanceTo(s.p) < 2500)) {
      const G = {};
      const gunDir = _v.set(0, 0.0262, -1).normalize().applyQuaternion(s.q).clone();
      if (this.radar.stt && this.radar.stt.pos.distanceTo(s.p) < 3000) {
        // target acceleration from its velocity change since the last look (this runs once per drawn frame, whatever the
        // frame rate, and some frames have no physics step in between)
        const T = this.radar.stt, now = g.time;
        const age = now - T._pt;
        if (!T._acc || !(age >= 0 && age <= 0.5)) { T._acc = new THREE.Vector3(); T._pv = T.vel.clone(); T._pt = now; }
        const dtS = now - T._pt;
        if (dtS > 1e-4) { T._acc.lerp(_v2.copy(T.vel).sub(T._pv).divideScalar(dtS), 1 - Math.exp(-dtS / 0.17)); T._pv.copy(T.vel); T._pt = now; }
        G.lcos = lcosSolution(s.p, s.v, gunDir, T, T._acc);
      }
      // EEGS-style funnel from bullets fired over the last 1.5 s
      const f = [];
      for (const h of this.history) {
        const tau = g.time - h.t; if (tau < 0.15) continue;
        const v0 = _v2.copy(h.f).multiplyScalar(1030).add(h.v);
        const drag = 1 - 0.00028 * 1030 * tau * 0.5;
        const p = h.p.clone().addScaledVector(v0, tau * drag); p.y -= 0.5 * G0 * tau * tau;
        f.push({ p, r: p.distanceTo(s.p) });
      }
      G.funnel = f.filter((_, i) => i % 6 === 0);
      out.gun = G;
    }
    return out;
  }
}
