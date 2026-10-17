// Spear 1-2, the player's wingman: a computer-flown Super Hornet on the player's side. It flies formation off the
// right wing and follows five orders (O, then 1-5): attack my target, cover me, hunt, rejoin, go home. The air combat
// is the fighter brain from ai.js (team 'blue'); ground targets and ships get stand-off weapons (small glide bombs,
// anti-radar missiles, an anti-ship missile) released far outside the short-range defenses. On a carrier start it
// waits on catapult 2 and launches a few seconds after the player.
import * as THREE from 'three';
import { AIJet } from './ai.js';
import { tagOf } from './world.js';
import { buildFighter, STATIONS, JET_GEOM } from '../models/fighter.js';
import { buildMunition } from '../models/munitions.js';
import { Missile, DEFS } from '../sim/weapons.js';
import { HORNET_LIGHTS } from '../fx/navlights.js';
import { G0 } from '../sim/atmo.js';
import { CATS, DECK_Y } from '../models/carrier.js';

const D2R = Math.PI / 180;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// one anti-ship missile can't sink even the frigate, so the strike load carries two
const LOADS = {
  strike: { L1: 'aim9x', R1: 'aim9x', L2: 'agm88', R2: 'agm88', L3: 'agm84', R3: 'agm84', L4: 'gbu39x4', R4: 'gbu39x4', R6: 'aim120' },
  air: { L1: 'aim9x', R1: 'aim9x', L2: 'aim120', R2: 'aim120', L3: 'aim120', R3: 'aim120', L4: 'aim120', R4: 'aim120', R6: 'aim120' },
};
// the order menu: O, then the number
export const ORDERS = [
  { n: 1, id: 'attack', text: 'ATTACK MY TARGET' },
  { n: 2, id: 'cover', text: 'COVER ME' },
  { n: 3, id: 'hunt', text: 'HUNT ON YOUR OWN' },
  { n: 4, id: 'rejoin', text: 'REJOIN ON ME' },
  { n: 5, id: 'home', text: 'GO HOME TO THE SHIP' },
];
const PLAIN = { aim120: 'a radar missile', aim9x: 'a heat-seeker', gbu39: 'a small guided bomb', agm88: 'an anti-radar missile', agm84: 'an anti-ship missile' };
const CALL = { aim120: 'Fox three', aim9x: 'Fox two', gbu39: 'bombs away', agm88: 'Magnum', agm84: 'Bruiser' };
const NUMW = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
// formation slot in the leader's flight-path frame: metres right, up, ahead (a little ahead keeps him in the outside view)
const SLOT = new THREE.Vector3(30, 3, 14);
// hunting with targets left to attack: a dogfight still going after HUNT_FIGHT_MAX s is broken off and that bandit
// left alone for HUNT_IGNORE s (two computer pilots in the same jet can circle each other for minutes)
const HUNT_FIGHT_MAX = 90, HUNT_IGNORE = 60;
const CAT = CATS[1], CAT_LEN = CAT.z0 - CAT.z1, CAT_V = 80, CAT_ACC = CAT_V * CAT_V / (2 * CAT_LEN);
const KNEEL = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1.6 * D2R);
const title = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
let RACK = null;

export class Wingman extends AIJet {
  constructor(game, o = {}) {
    const mdl = buildFighter({ lowDetail: true });
    mdl.info.wingtipL = JET_GEOM.wingtipL; mdl.info.wingtipR = JET_GEOM.wingtipR;
    mdl.cockpit.group.visible = false; // its MFD screens would glow white through the canopy
    super(game, { team: 'blue', model: mdl, name: 'SPEAR 1-2', label: 'F18', rcs: 5, lights: HORNET_LIGHTS, flame: [0.4, 7.5], bvr: 'aim120', wvr: 'aim9x', pos: o.pos || game.player.pos, heading: o.heading || 0, speed: o.speed || 230, audioGain: 0.5 });
    // radar missiles from inside about 25 km: from further out a bandit that turns away almost always outruns them
    this.isWingman = true; this.maxG = 9; this.bvrScale = 0.6;
    // Radar.inCoverage never passes for a radar on a jet (radar.pos and the line of sight share one scratch vector), so
    // no AI fighter ever gets a radar lock: that is why the enemy jets only fight close in. His radar gets a working
    // test, or he could never fire his long-range missiles.
    const R = this.radar; R.inCoverage = (tp) => R.forward(_v3).dot(_v4.copy(tp).sub(R.pos).normalize()) > Math.cos(R.azHalf);
    this.order = 'cover'; this.orderTgt = null; this.strike = null; this.kills = 0; this.idleT = 0;
    this.fightFoe = null; this.fightAt = 0; this.fightSeen = 0; this.ignore = null;
    this.mode = 'join'; this.joined = false; this.slotErr = Infinity;
    this.slot = new THREE.Vector3(); this.slotPrev = new THREE.Vector3(); this.slotVel = new THREE.Vector3(); this.slotOk = false; this.slotR = new THREE.Vector3(1, 0, 0);
    this.accS = new THREE.Vector3(); this.gearK = 0; this.gearUpAt = 0;
    this.loadStores(o.loadout || 'strike');
    if (o.deck) { this.deck = { s: 0, v: 0, launchAt: null }; this.landed = true; this.gearK = 1; this.placeOnDeck(); }
    this.setGear(this.gearK);
  }

  // ---------------- stores ----------------
  loadStores(name) {
    const L = LOADS[name] || LOADS.strike, root = this.model.root;
    if (!RACK) RACK = { geo: new THREE.BoxGeometry(0.34, 0.14, 2.3), mat: new THREE.MeshStandardMaterial({ color: 0x8c9196, roughness: 0.6, metalness: 0.3 }) };
    this.stores = [];
    for (const st of STATIONS) {
      let k = L[st.id]; if (!k) continue;
      const pack = /x(\d)$/.exec(k), n = pack ? +pack[1] : 1; if (pack) k = k.slice(0, -2);
      if (n > 1) { const r = new THREE.Mesh(RACK.geo, RACK.mat); r.position.set(st.pos[0], st.pos[1] - 0.1, st.pos[2] + 0.4); root.add(r); }
      for (let i = 0; i < n; i++) {
        const m = buildMunition(DEFS[k].model);
        const off = st.rail === 'tip' ? 0 : -(DEFS[k].d / 2 + 0.05) - (n > 1 ? 0.14 : 0);
        const ox = n > 1 ? (i % 2 ? 0.13 : -0.13) : 0, oz = n > 1 ? (i < 2 ? -0.95 : 0.95) : 0;
        m.root.position.set(st.pos[0] + ox, st.pos[1] + off, st.pos[2] + 0.4 + oz); root.add(m.root);
        this.stores.push({ st, key: k, mesh: m });
      }
    }
    this.weapons = { aim120: 0, aim9x: 0, gbu39: 0, agm88: 0, agm84: 0, gun: 400 };
    for (const s of this.stores) this.weapons[s.key]++;
  }
  // outboard stations first, like the player's jet
  popStore(key) {
    let best = null;
    for (const s of this.stores) if (s.key === key && (!best || Math.abs(s.st.pos[0]) > Math.abs(best.st.pos[0]))) best = s;
    if (!best) return null;
    this.stores.splice(this.stores.indexOf(best), 1); this.model.root.remove(best.mesh.root);
    return best;
  }
  ammoText() {
    const W = this.weapons, parts = [];
    for (const [n, label] of [[W.aim120 + W.aim9x, 'AIR-TO-AIR'], [W.gbu39, 'SMALL BOMBS'], [W.agm88, 'ANTI-RADAR'], [W.agm84, 'ANTI-SHIP']]) if (n > 0) parts.push(`${label} ${n}`);
    return parts.length ? parts.join(' · ') : 'GUN ONLY';
  }
  // the air-combat code (ai.js) counts the round off itself; ground releases do the same in thinkStrike
  fire(key, tgt) {
    const g = this.game, d = DEFS[key], st = this.popStore(key);
    const p = (st ? _v.copy(st.mesh.root.position).add(_v2.set(0, st.st.rail === 'tip' ? -0.2 : -0.3, 0)) : _v.set(0, -1.2, 0)).applyQuaternion(this.quat).add(this.pos);
    const down = _v2.set(0, -1, 0).applyQuaternion(this.quat).multiplyScalar(d.bomb ? 4 : 2.5);
    const m = new Missile(g, key, { team: this.team, shooter: this, target: tgt, targetPoint: d.seeker === 'gps' ? tgt.pos : null, pos: p.clone(), vel: this.vel.clone().add(down), quat: this.quat, radar: d.seeker === 'arh' && tgt.kind === 'air' ? this.radar : null });
    g.world.missiles.push(m); this.myMissile = m;
    this.say(`${CALL[key]}!`, `Your wingman fired ${PLAIN[key]} at ${tgt.kind === 'air' ? tgt.name : `the ${tagOf(tgt).toLowerCase()}`}.`, { key: 'w-fire', every: 4, pri: 2, ttl: 3, dur: 3 });
    if (this.weapons.aim120 + this.weapons.aim9x <= (key === 'aim120' || key === 'aim9x' ? 1 : 0) && !this.winchester) {
      this.winchester = true;
      g.comms.later(3, () => this.say('Winchester air-to-air, gun only.', 'Your wingman has used all his air-to-air missiles. He can still use his gun.', { pri: 1, ttl: 8 }));
    }
    return m;
  }

  // ---------------- radio ----------------
  say(text, plain, o = {}) { const g = this.game; if (g.comms && !g.attract && this.alive) g.comms.call('wing', `Spear 1-2, ${text}`, plain, { pri: 2, ttl: 6, ...o }); }
  checkIn() {
    if (this.order !== 'cover' || this.strike || this.fighting()) return; // already busy with an order: he knows about O
    if (this.deck) this.say('on cat two, ready.', 'Your wingman (Spear 1-2) is on the catapult beside you. He launches right after you and joins on your right wing. Press O to give him orders.', { pri: 1, ttl: 20 });
    else this.say('in position, right side.', 'Your wingman (Spear 1-2) flies on your right. Press O, then a number, to give him orders: 1 attack my target, 2 cover me, 3 hunt, 4 rejoin, 5 go home.', { pri: 1, ttl: 20 });
  }
  // credit for a kill (game.onDestroyed)
  creditKill(e) {
    const g = this.game; this.kills++;
    g.msg(`YOUR WINGMAN ${e.kind === 'air' ? 'SHOT DOWN' : e.kind === 'ship' ? 'SANK' : 'DESTROYED'} ${tagOf(e)}`, 3, '#b0ffb0');
    if (e.kind === 'air') {
      this.say('splash one!', `Your wingman shot down ${e.name}.`, { pri: 3, ttl: 5 });
      const left = g.aiJets.filter(j => j.alive && j.team === 'red').length;
      g.comms.call('awacs', left ? `Magic copies, splash one. ${title(NUMW[left] || String(left))} bandit${left > 1 ? 's' : ''} remaining.` : 'Magic copies, splash. Picture clean.', left ? `${left} enemy fighter${left > 1 ? 's' : ''} left.` : 'The sky is clear of enemy fighters.', { pri: 2, ttl: 8 });
    } else if (e.kind === 'ship') this.say(`good hits, the ${tagOf(e) === 'ENEMY DESTROYER' ? 'destroyer' : 'frigate'} is burning.`, `Your wingman's anti-ship missile sank the ${tagOf(e).toLowerCase()}.`, { pri: 3, ttl: 6 });
    else this.say('shack!', `Your wingman destroyed the ${tagOf(e).toLowerCase()}.`, { key: 'w-shack', every: 3, pri: 2, ttl: 6 });
  }

  // ---------------- orders ----------------
  // what the player is working on: the locked jet while an air weapon is selected, otherwise the marked ground target
  playerTarget() {
    const P = this.game.player;
    const air = P.radar.stt && P.radar.stt.alive ? P.radar.stt : null, gnd = P.tgp.target && P.tgp.target.alive ? P.tgp.target : null;
    return P.airWeapon ? air || gnd : gnd || air;
  }
  // returns false when the order can't be carried out (he says why on the radio)
  command(id) {
    const g = this.game; if (!this.alive) return false;
    const ack = { key: 'w-ack', every: 1, pri: 3, ttl: 5 };
    this.idleT = 0;
    if (id === 'attack') {
      const T = this.playerTarget();
      if (!T) { g.msg('LOCK OR MARK A TARGET WITH T FIRST, THEN O AND 1', 2.5); this.say('say again, no target.', 'Lock a jet or mark a ground target with T first, then press O and 1.', ack); return false; }
      const what = tagOf(T).toLowerCase();
      if (T.kind === 'air') {
        this.order = 'attack'; this.orderTgt = T; this.strike = null; this.foe = T; if (this.state === 'patrol') this.state = 'intercept';
        const G = g.comms.geo(T.pos);
        this.say(`copy, engaging ${title(T.name)}.`, `Your wingman goes after ${T.name}, the jet you locked (${G.km} km ${G.dir}).`, ack);
        return true;
      }
      if (T.isBunker) { this.say('unable, no penetrator.', 'Your wingman carries no bunker buster. The bunker is your job: press 4, mark it with T, release when the HUD says IN RANGE.', ack); return false; }
      const key = this.groundWeapon(T);
      if (!key) { this.say(`unable, nothing left for the ${what}.`, `Your wingman has no weapon left that can hit the ${what}.`, ack); return false; }
      this.order = 'attack'; this.orderTgt = T; this.foe = null; this.radar.stt = null; this.startStrike(T, key, false);
      this.say(`copy, attacking the ${what}.`, `Your wingman attacks the ${what} you marked with ${PLAIN[key]} from long range, then comes back to you.`, ack);
      return true;
    }
    this.strike = null; this.orderTgt = null;
    if (id === 'cover') { this.order = 'cover'; this.say('copy, covering you.', 'Your wingman stays on your right wing and fights any enemy jet that comes within 25 km of you.', ack); }
    else if (id === 'hunt') {
      this.order = 'hunt';
      this.say('copy, going hunting.', g.mission && g.mission.kind === 'strike' ? 'Your wingman takes out air defenses on his own (anti-radar missiles and small bombs from long range) and fights any jet that comes near. O then 4 calls him back.' : 'Your wingman goes after the enemy jets on his own. O then 4 calls him back.', ack);
    } else if (id === 'rejoin') { this.order = 'rejoin'; this.foe = null; this.radar.stt = null; this.say('rejoining.', 'Your wingman stops what he is doing and flies back to your right wing.', ack); }
    else if (id === 'home') { this.order = 'home'; this.foe = null; this.radar.stt = null; this.say('copy, RTB.', 'Your wingman flies back to the carrier and circles over it. O then 4 brings him back.', ack); }
    return true;
  }

  // ---------------- decisions (4 Hz) ----------------
  // the player can't be followed: dead, on the deck, or landing
  holding() {
    const g = this.game, P = g.player;
    return !P.alive || P.ac.onGround || g.ops.inApproach || (P.ac.ctl.gearCmd && P.pos.distanceTo(g.carrier.pos) < 15000);
  }
  fighting() { return this.state === 'defend' || (!!this.foe && this.state !== 'patrol'); }
  pickFoe() {
    const g = this.game, P = g.player, o = this.order, M = g.mission;
    if (o === 'rejoin' || o === 'home' || this.holding()) return null;
    if (o === 'attack' && this.orderTgt && this.orderTgt.kind === 'air') return this.canFight(this.orderTgt) ? this.orderTgt : null;
    // on a bomb run only a bandit close by counts; hunting in the strike, the air defenses come first
    const reach = this.strike || o === 'attack' ? 12000 : o === 'hunt' ? (M && M.kind === 'strike' && this.huntTargets().length ? 15000 : 90000) : 0;
    let best = null, bs = Infinity;
    for (const j of g.aiJets) {
      if (!this.canFight(j) || (o === 'hunt' && this.ignore && this.ignore.j === j && g.time < this.ignore.until)) continue;
      const R = j.pos.distanceTo(this.pos);
      if (reach ? R > reach : R > 15000 && j.pos.distanceTo(P.pos) > 25000) continue;
      const s = R * (j === this.foe ? 0.7 : 1); if (s < bs) { bs = s; best = j; }
    }
    return best;
  }
  think() {
    const g = this.game, P = g.player, M = g.mission;
    const was = this.state;
    if (M && M.ended && (this.order === 'hunt' || this.order === 'attack')) { this.order = 'cover'; this.strike = null; this.orderTgt = null; }
    if (this.order === 'attack' && !this.strike && !(this.orderTgt && this.orderTgt.alive)) {
      const T = this.orderTgt; this.order = 'cover'; this.orderTgt = null;
      if (T && T.lastHitBy !== this) this.say('target destroyed, rejoining.', `${T.kind === 'air' ? T.name : `The ${tagOf(T).toLowerCase()}`} is destroyed. Your wingman comes back to your wing.`, { key: 'w-done', every: 5 });
    }
    if (this.order === 'rejoin' || this.order === 'home' || this.holding()) this.foe = null;
    super.think();
    // covering: don't chase a bandit far from the leader
    if (this.order === 'cover' && this.foe && this.state !== 'defend' && this.foe.pos.distanceTo(P.pos) > 32000) { this.foe = null; this.state = 'patrol'; this.radar.stt = null; }
    if (this.order === 'hunt' && this.huntTargets().length) {
      // losing the bandit for a moment (dodging a missile, out of radar view) doesn't restart the clock
      if (this.foe && (this.foe !== this.fightFoe || g.time - this.fightSeen > 30)) { this.fightFoe = this.foe; this.fightAt = g.time; }
      if (this.foe) this.fightSeen = g.time;
      if (this.foe && this.state !== 'defend' && g.time - this.fightAt > HUNT_FIGHT_MAX) {
        this.say('bugging out, pressing to the target.', `Your wingman can't finish ${this.foe.name} quickly, so he breaks off and goes back to his own targets.`, { key: 'w-brk', every: 30 });
        this.ignore = { j: this.foe, until: g.time + HUNT_IGNORE };
        this.foe = null; this.fightFoe = null; this.state = 'patrol'; this.radar.stt = null;
      }
    } else this.fightFoe = null;
    if (this.foe && this.state === 'intercept' && was === 'patrol') {
      const G = g.comms.geo(this.foe.pos);
      this.say(`engaged, bandit ${G.clock} o'clock, ${G.km} km.`, `Your wingman is attacking ${this.foe.name}, ${G.km} km ${G.dir}.`, { key: 'w-eng', every: 12 });
    }
    if (this.state === 'defend' && was !== 'defend') this.say('defending, missile on me!', 'An enemy missile is chasing your wingman. He turns away from it and drops chaff and flares.', { key: 'w-def', every: 15, pri: 3, ttl: 4 });
    this.thinkStrike();
    if (this.order === 'rejoin' && this.mode === 'form' && this.slotErr < 60) { this.order = 'cover'; this.say('in position.', 'Your wingman is back on your right wing.', { key: 'w-pos', every: 20, pri: 1 }); }
  }

  // ---------------- ground attack ----------------
  groundWeapon(e) {
    const W = this.weapons;
    if (!e || e.isBunker || e.kind === 'air') return null;
    if (e.kind === 'ship') return W.agm84 > 0 ? 'agm84' : null; // small bombs and anti-radar missiles barely scratch a warship
    if (e.radar && W.agm88 > 0 && (e.radar.on || !W.gbu39)) return 'agm88';
    if (W.gbu39 > 0) return 'gbu39';
    return e.radar && W.agm88 > 0 ? 'agm88' : null;
  }
  // what he goes after on his own: in the city strike the air defenses, then the warships; never the bunker, that is
  // the player's job
  huntTargets() {
    const M = this.game.mission; if (!M || M.kind !== 'strike' || M.ended) return [];
    return (M.state === 'sead' ? M.defenses : M.fleet || []).filter(e => e.alive && this.groundWeapon(e));
  }
  huntTarget() {
    const g = this.game, busy = new Set([g.player.tgp.target]);
    for (const m of g.world.missiles) if (!m.dead && m.team === 'blue' && m.target) busy.add(m.target);
    let best = null, bs = Infinity;
    for (const e of this.huntTargets()) {
      if (busy.has(e)) continue;
      // the long-range SAM's radars first, with anti-radar missiles fired from outside its reach; a damaged warship
      // before a fresh one, so the hits add up to a sinking
      const s = e.pos.distanceTo(this.pos) - (/SA-21/.test(e.name) && this.groundWeapon(e) === 'agm88' ? 1e5 : 0) - (e.kind === 'ship' && e.hp < e.maxHp ? 3e4 : 0);
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }
  startStrike(T, key, hunt) {
    this.strike = { tgt: T, key, hunt, phase: 'run', tries: 0, offT: 0, weapons: [], salvoAt: 0, open: false, side: Math.random() < 0.5 ? -1 : 1, hp0: T.hp,
      alt: key === 'gbu39' ? 7000 : key === 'agm84' ? 2000 : 6000, minR: key === 'gbu39' ? 4000 : key === 'agm88' ? 7000 : 10000 };
    return this.strike;
  }
  // release window: small bombs by glide reach from height and speed (as the player's HUD works it out), missiles by range
  inLAR(T, key) {
    const dx = T.pos.x - this.pos.x, dz = T.pos.z - this.pos.z, R = Math.hypot(dx, dz);
    const V = Math.max(120, Math.hypot(this.vel.x, this.vel.z));
    const off = Math.acos(THREE.MathUtils.clamp((dx * this.vel.x + dz * this.vel.z) / (R * V || 1), -1, 1));
    if (key === 'gbu39') { const rb = V * Math.sqrt(2 * Math.max(50, this.pos.y - T.pos.y) / G0); return R < (rb * 2.6 + 3000) * 0.85 && R > Math.min(rb * 0.25, 800) && off < 25 * D2R; }
    if (key === 'agm88') return R < 30000 && R > 6000 && off < 20 * D2R;
    return R < 45000 && R > 9000 && off < 25 * D2R;
  }
  thinkStrike() {
    const g = this.game;
    if (this.order === 'hunt' && !this.strike && !this.fighting()) {
      const T = this.huntTarget();
      if (T) { this.startStrike(T, this.groundWeapon(T), true); this.idleT = 0; }
      else if (!this.foe && (this.huntTargets().length === 0 || g.mission.kind !== 'strike') && (this.idleT += 0.25) > 8) {
        const out = g.mission && g.mission.kind === 'strike' && this.weapons.gbu39 + this.weapons.agm88 + this.weapons.agm84 === 0;
        this.order = 'cover';
        this.say(out ? 'Winchester, rejoining.' : 'nothing left to hunt, rejoining.', out ? 'Your wingman has used all his bombs and anti-radar missiles and comes back to your wing.' : 'Your wingman found nothing more he can attack and comes back to your wing.', { pri: 1, ttl: 8 });
      }
    }
    const S = this.strike; if (!S) return;
    const T = S.tgt;
    if (!T.alive) { this.strike = null; return; }
    if (S.phase === 'run') {
      if (this.fighting()) return;
      if (!(this.weapons[S.key] > 0)) { const k = this.groundWeapon(T); if (!k) return this.unable(T); S.key = k; }
      if (!this.inLAR(T, S.key)) return;
      S.weapons = [this.fire(S.key, T)]; this.weapons[S.key]--; S.tries++;
      // a warship: the second anti-ship missile follows 1.5 s behind, so one interceptor's blast can't take both
      S.salvoAt = S.key === 'agm84' && this.weapons.agm84 > 0 ? g.time + 1.5 : 0;
      S.phase = 'wait'; S.offT = 0;
      if (S.hunt && !S.salvoAt) this.strike = null; // a hunter goes straight on to the next target
      return;
    }
    // weapon in flight: turn away, then back to the leader; if the target survives, run in again
    S.offT += 0.25;
    if (S.salvoAt && g.time >= S.salvoAt) {
      S.salvoAt = 0;
      if (this.weapons.agm84 > 0) { S.weapons.push(this.fire('agm84', T)); this.weapons.agm84--; }
      if (S.hunt) { this.strike = null; return; }
    }
    if (S.salvoAt || S.weapons.some(m => !m.dead)) return;
    const k = S.tries < 3 ? this.groundWeapon(T) : null;
    if (!k) return this.unable(T, S.weapons.every(m => m.reason === 'blast' || m.reason === 'shot'), T.hp < S.hp0);
    S.key = k; S.phase = 'run'; S.offT = 0;
    this.say('target still standing, re-attacking.', `The ${tagOf(T).toLowerCase()} survived. Your wingman makes another run.`, { key: 'w-re', every: 10 });
  }
  // out of weapons for T. intercepted: its defenses shot down every weapon of the last attack; damaged: hits, no kill
  unable(T, intercepted, damaged) {
    this.strike = null;
    if (this.order === 'attack') { this.order = 'cover'; this.orderTgt = null; }
    const what = tagOf(T).toLowerCase(), o = { key: 'w-unable', every: 8 };
    // a warship spends its whole missile load on a two-missile attack; worth knowing before you go in yourself
    const def = T.kind === 'ship' && (this.game.shipDefs || []).find(d => d.e === T), dry = def && def.ammo === 0;
    const dryR = dry ? ' She\'s out of SAMs.' : '', dryP = dry ? ' It fired all of its own missiles, so only its close-in gun (2.5 km) is left.' : '';
    if (damaged) this.say(`good hits, but ${T.kind === 'ship' ? 'she\'s still afloat' : 'it\'s still standing'}.${dryR} I'm out, rejoining.`, `Your wingman damaged the ${what} (${Math.round(T.hp / T.maxHp * 100)}% left) but has nothing left to finish it.${dryP} He comes back to your wing.`, o);
    else if (intercepted) this.say(`no joy, they shot my missiles down.${dryR} Rejoining.`, `The ${what}'s air defenses shot down your wingman's missiles.${dryP} He has nothing left for it and comes back to your wing.`, o);
    else this.say(`no joy on the ${what}, rejoining.`, `Your wingman has nothing left that can finish the ${what} and comes back to your wing.`, o);
  }

  // ---------------- flying ----------------
  move(dt) {
    const S = this.strike;
    if (this.fighting()) { this.mode = 'join'; return super.move(dt); }
    if (S && (S.phase === 'run' || S.offT < 6)) { this.mode = 'join'; return this.flyStrike(dt); }
    if (this.order === 'home' || this.holding()) { this.mode = 'join'; return this.flyOrbit(dt); }
    this.flyFormation(dt);
  }
  flyStrike(dt) {
    const g = this.game, S = this.strike, T = S.tgt, dir = this.desiredDir;
    const dx = T.pos.x - this.pos.x, dz = T.pos.z - this.pos.z, R = Math.hypot(dx, dz) || 1;
    if (R < S.minR) S.open = true; else if (R > S.minR * 2.2) S.open = false;
    let speed = 250;
    if ((S.phase === 'run' || S.salvoAt) && !S.open) dir.set(dx / R, 0, dz / R);
    else { dir.set(-dx / R, 0, -dz / R).applyAxisAngle(UP, 40 * D2R * S.side); speed = 280; } // turn away (after a release, or to open the range for a new run)
    const floor = Math.max(g.terrain.heightAt(this.pos.x, this.pos.z), 0) + 1500;
    dir.y = THREE.MathUtils.clamp((Math.max(S.alt, floor) - this.pos.y) / 2500, -0.3, 0.4);
    this.fly(dt, dir, speed);
  }
  // circle the carrier 3.5 km out at 6,000 ft
  flyOrbit(dt) {
    const C = this.game.carrier.pos, dir = this.desiredDir;
    const rx = this.pos.x - C.x, rz = this.pos.z - C.z, r = Math.hypot(rx, rz) || 1;
    if (r > 9000) dir.set(-rx / r, 0, -rz / r);
    else dir.set(-rz / r, 0, rx / r).addScaledVector(_v.set(-rx / r, 0, -rz / r), THREE.MathUtils.clamp((r - 3500) / 2000, -0.8, 0.8));
    dir.y = THREE.MathUtils.clamp((1800 - this.pos.y) / 2500, -0.35, 0.35);
    this.fly(dt, dir, r > 9000 ? 250 : 200);
  }
  // the leader's flight-path frame: forward along his velocity, right level with the horizon
  slotPoint(out) {
    const g = this.game, P = g.player;
    const F = _v.copy(P.vel), sp = F.length();
    if (sp > 1) F.multiplyScalar(1 / sp); else P.ac.forward(F);
    const R = _v2.crossVectors(F, UP);
    if (R.lengthSq() > 0.02) this.slotR.copy(R.normalize()); // straight up or down: keep the last "right"
    const U = _v3.crossVectors(this.slotR, F).normalize();
    out.copy(P.pos).addScaledVector(this.slotR, SLOT.x).addScaledVector(U, SLOT.y).addScaledVector(F, SLOT.z);
    const floor = Math.max(g.terrain.heightAt(out.x, out.z), 0) + 60;
    if (out.y < floor) out.y = floor;
    return out;
  }
  placeInSlot() {
    this.slotPoint(this.pos); this.vel.copy(this.game.player.vel); this.up.set(0, 1, 0);
    this.mode = 'form'; this.joined = true; this.slotOk = false; this.syncModel();
  }
  flyFormation(dt) {
    const g = this.game, P = g.player, slot = this.slotPoint(this.slot);
    // the slot's own velocity (it swings round in a turn), smoothed; a jump (respawn) falls back to the leader's
    if (this.slotOk) {
      _v.copy(slot).sub(this.slotPrev).multiplyScalar(1 / dt);
      if (_v.distanceToSquared(P.vel) < 150 * 150) this.slotVel.lerp(_v, Math.min(1, dt * 10)); else this.slotVel.copy(P.vel);
    } else this.slotVel.copy(P.vel);
    this.slotPrev.copy(slot); this.slotOk = true;
    const err = _v2.copy(slot).sub(this.pos), d = err.length(); this.slotErr = d;
    if (this.mode === 'form' && d > 450) this.mode = 'join';
    else if (this.mode !== 'form' && d < 250) {
      this.mode = 'form';
      if (!this.joined) { this.joined = true; this.say('visual, joined.', 'Your wingman is on your right wing. Press O to give him orders.', { pri: 1, ttl: 8 }); }
    }
    if (this.mode !== 'form') {
      // catch up: fly at a point ahead of the slot, faster than the leader
      const dir = this.desiredDir.copy(slot).addScaledVector(P.vel, Math.min(d / 250, 25)).sub(this.pos);
      this.fly(dt, dir, Math.max(P.vel.length() + THREE.MathUtils.clamp(d * 0.04, 20, 140), 170));
      return;
    }
    // close formation: match the slot's velocity plus a capped closure term (no overshoot), turning at most 11 g
    const corr = err.multiplyScalar(0.6); if (corr.lengthSq() > 45 * 45) corr.setLength(45);
    const dv = _v3.copy(this.slotVel).add(corr).sub(this.vel), maxDv = 11 * G0 * dt;
    if (dv.lengthSq() > maxDv * maxDv) dv.setLength(maxDv);
    this.vel.add(dv); this.pos.addScaledVector(this.vel, dt);
    this.bank(dv.multiplyScalar(1 / dt), dt);
    const push = corr.dot(this.slotVel) / Math.max(this.slotVel.length(), 1);
    this.throttle = THREE.MathUtils.clamp(P.ac.ctl.throttle + push * 0.012, 0.25, 1);
    this.ab = THREE.MathUtils.clamp(this.ab + THREE.MathUtils.clamp((P.ac.ab > 0.05 || push > 25 ? 1 : 0) - this.ab, -dt * 2, dt * 2), 0, 1);
  }
  // bank like a real jet: the lift vector carries the turn and holds the jet up
  bank(acc, dt) {
    this.accS.lerp(acc, Math.min(1, dt * 6));
    const V = Math.max(this.vel.length(), 1), vhat = _v.copy(this.vel).multiplyScalar(1 / V);
    const lift = _v4.copy(this.accS); lift.y += G0; lift.addScaledVector(vhat, -lift.dot(vhat));
    this.gLoad = lift.length() / G0;
    if (lift.lengthSq() > 1e-4) this.up.lerp(lift.normalize(), Math.min(1, dt * 4)).normalize();
  }

  // ---------------- deck (carrier starts) ----------------
  // same pose as the player's jet on a catapult (CarrierOps.catPose): launch bar on the shuttle, nose strut kneeling
  placeOnDeck() {
    const C = this.game.carrier, D = this.deck, fwd = _v2.set(Math.sin(C.heading), 0, -Math.cos(C.heading));
    C.toWorld(_v.set(CAT.x, DECK_Y + 2.0, CAT.z0 - JET_GEOM.launchBar.z - D.s), this.pos);
    this.quat.copy(C.quat).multiply(KNEEL); this.vel.copy(fwd).multiplyScalar(D.v).add(C.vel); this.up.set(0, 1, 0).applyQuaternion(C.quat);
    this.root.position.copy(this.pos); this.root.quaternion.copy(this.quat);
  }
  updateDeck(dt) {
    const g = this.game, C = g.carrier, D = this.deck;
    const spool = D.launchAt != null && g.time >= D.launchAt - 2.5;
    this.throttle += ((spool ? 1 : 0.3) - this.throttle) * Math.min(1, dt * 2); this.ab = spool ? Math.min(1, this.ab + dt) : 0;
    if (D.launchAt != null && g.time >= D.launchAt) {
      D.v += CAT_ACC * dt; D.s += D.v * dt;
      for (let i = 0; i < 2; i++) g.fx.steam(C.toWorld(_v.set(CAT.x, DECK_Y + 0.3, CAT.z0 - Math.random() * (D.s + 5))), 0.9, C.fwd);
      if (D.s >= CAT_LEN) {
        this.deck = null; this.landed = false; this.mode = 'join'; this.gearUpAt = g.time + 3;
        this.vel.set(Math.sin(C.heading), 0, -Math.cos(C.heading)).multiplyScalar(CAT_V).add(C.vel); this.vel.y = 4;
        this.say('airborne, joining.', 'Your wingman is off the catapult and catching up with you.', { pri: 1, ttl: 6 });
        return;
      }
    }
    this.placeOnDeck();
    this.flames.forEach(f => f.set(this.ab, 0.7 + this.throttle * 0.3));
    this.audio.update(this.pos, this.vel, { intensity: this.audioGain, ab: this.ab, rpm: this.throttle });
  }

  update(dt) {
    if (this.deck) return this.updateDeck(dt);
    super.update(dt);
    if (!this.alive) return;
    const P = this.game.player;
    const want = this.game.time < this.gearUpAt || (this.mode === 'form' && !this.fighting() && !this.strike && P.ac.gear > 0.5) ? 1 : 0;
    if (want !== this.gearK) { this.gearK = THREE.MathUtils.clamp(this.gearK + Math.sign(want - this.gearK) * dt * 0.5, 0, 1); this.setGear(this.gearK); }
  }
  setGear(k) {
    const G = this.model.gear;
    G.nose.rotation.x = (1 - k) * 1.6; G.mainL.rotation.z = (1 - k) * 1.5; G.mainR.rotation.z = -(1 - k) * 1.5;
    G.nose.visible = G.mainL.visible = G.mainR.visible = k > 0.02;
    this.navLights.setGear(k > 0.9 ? 1 : 0);
  }

  // one line for the HUD
  statusText() {
    if (!this.alive) return 'SHOT DOWN';
    if (this.deck) return this.deck.launchAt != null ? 'LAUNCHING' : 'ON CATAPULT 2, LAUNCHES AFTER YOU';
    if (this.state === 'defend') return 'DODGING A MISSILE';
    if (this.fighting()) return `FIGHTING ${this.foe.name}`;
    const S = this.strike;
    if (S) return `${S.phase === 'run' ? 'ATTACKING' : 'WEAPON AWAY:'} ${tagOf(S.tgt)}`;
    if (this.order === 'home' || this.holding()) return this.pos.distanceTo(this.game.carrier.pos) > 9000 ? 'FLYING HOME TO THE SHIP' : 'CIRCLING OVER THE SHIP';
    const k = this.order === 'hunt' ? 'HUNTING' : this.order === 'rejoin' ? 'REJOINING' : 'COVERING YOU';
    return `${k}, ${this.mode === 'form' ? 'ON YOUR RIGHT WING' : 'CATCHING UP'}`;
  }

  // gone for good (new flight, main menu)
  despawn() {
    const g = this.game; this.alive = false; this.falling = false;
    g.scene.remove(this.root); g.world.remove(this);
    const i = g.world.radars.indexOf(this.radar); if (i >= 0) g.world.radars.splice(i, 1);
    g.aiJets = g.aiJets.filter(j => j !== this);
    if (this.audio) this.audio.stop();
    for (const t of [].concat(this.contrail || [], this.vortexL || [], this.vortexR || [], this.smokeTrail || [])) t.stop();
    if (this.fire_) this.fire_.life = 0;
  }
}
