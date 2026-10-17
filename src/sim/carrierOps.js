// Ships (kinematics + wave response), moving-surface queries, CATOBAR catapult launch, tailhook +
// arresting-wire physics, IFLOLS meatball and LSO logic.
import * as THREE from 'three';
import { DECK_Y, CATS, LANDING, landingPoint, pointInDeck, setWire } from '../models/carrier.js';
import { JET_GEOM } from '../models/fighter.js';

const D2R = Math.PI / 180;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3(), _v7 = new THREE.Vector3(), _v8 = new THREE.Vector3(), _q1 = new THREE.Quaternion();
// same text as the landing assist's bolter message, so the two never show up twice
export const BOLTER_MSG = 'BOLTER — MISSED THE WIRES. THE JET CLIMBS AWAY BY ITSELF';

export class Ship {
  constructor(model, opts) {
    this.model = model; this.root = model.root;
    this.name = opts.name || 'ship';
    this.pos = new THREE.Vector3(opts.x, 0, opts.z);
    this.heading = (opts.heading || 0) * D2R;
    this.speed = opts.speed || 0; this.cruise = this.speed;
    this.length = model.info.length; this.beam = model.info.beam; this.deckY = model.info.deckY; this.draft = model.info.draft;
    this.deck = !!opts.deck;
    this.quat = new THREE.Quaternion(); this.world = new THREE.Matrix4(); this.inv = new THREE.Matrix4();
    this.vel = new THREE.Vector3(); this.angVel = new THREE.Vector3(); this.fwd = new THREE.Vector3();
    this.pitch = 0; this.roll = 0; this.heave = 0; this.pitchV = 0; this.rollV = 0; this.heaveV = 0;
    this.turnRate = 0; this.targetHeading = this.heading;
    this.patrol = opts.patrol || null; // { x, z, r }: steam clockwise round this circle
    this.alive = true; this.hp = opts.hp || 1000; this.maxHp = this.hp; this.sinkT = 0; this.team = opts.team || 'blue';
    this.motionScale = opts.motionScale || (this.length > 250 ? 0.35 : 1.0);
    this.hitSpheres = model.info.hitSpheres;
    this.updateMatrices();
  }
  updateMatrices() {
    _e.set(this.pitch, -this.heading, this.roll, 'YXZ');
    this.quat.setFromEuler(_e);
    this.world.compose(_v.set(this.pos.x, this.heave, this.pos.z), this.quat, _v2.set(1, 1, 1));
    this.inv.copy(this.world).invert();
    this.root.position.set(this.pos.x, this.heave, this.pos.z);
    this.root.quaternion.copy(this.quat);
  }
  update(dt, t, ocean) {
    const C = this.patrol;
    if (C && this.alive) { // along the circle (clockwise seen from above), pulled back onto it when off
      const r = Math.hypot(this.pos.x - C.x, this.pos.z - C.z) || 1, ux = (this.pos.x - C.x) / r, uz = (this.pos.z - C.z) / r;
      const k = THREE.MathUtils.clamp((r - C.r) / C.r * 2, -1, 1);
      this.targetHeading = Math.atan2(-uz - k * ux, -(ux - k * uz));
    }
    // steer toward target heading
    let dh = this.targetHeading - this.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const maxRate = (this.length > 250 ? 0.6 : 1.6) * D2R;
    const want = THREE.MathUtils.clamp(dh * 0.3, -maxRate, maxRate);
    this.turnRate += (want - this.turnRate) * Math.min(1, dt * 0.4);
    this.heading += this.turnRate * dt;
    this.fwd.set(Math.sin(this.heading), 0, -Math.cos(this.heading));
    this.pos.addScaledVector(this.fwd, this.speed * dt);
    // wave response: sample along the hull, low-pass filtered rigid-body response
    if (!this.alive) {
      this.sinkT += dt;
      this.pitch += (this.sinkPitch - this.pitch) * dt * 0.05; this.roll += (this.sinkRoll - this.roll) * dt * 0.06;
      this.heave -= dt * Math.min(this.sinkT * 0.02, 0.8);
      this.speed *= 1 - dt * 0.1;
    } else {
      const L = this.length * 0.42, B = this.beam * 0.45; const f = this.fwd;
      const sx = -f.z, sz = f.x;
      const hb = ocean.heightAt(this.pos.x + f.x * L, this.pos.z + f.z * L, t);
      const hs = ocean.heightAt(this.pos.x - f.x * L, this.pos.z - f.z * L, t);
      const hp = ocean.heightAt(this.pos.x - sx * B, this.pos.z - sz * B, t);
      const hsb = ocean.heightAt(this.pos.x + sx * B, this.pos.z + sz * B, t);
      const hc = ocean.heightAt(this.pos.x, this.pos.z, t);
      const k = this.motionScale;
      const pT = Math.atan2(hb - hs, 2 * L) * k * 1.4, rT = Math.atan2(hp - hsb, 2 * B) * k * 1.2, zT = (hb + hs + hp + hsb + hc) / 5 * k;
      // second-order response
      const wn = this.length > 250 ? 0.9 : 1.6, z = 0.5;
      this.pitchV += (wn * wn * (pT - this.pitch) - 2 * z * wn * this.pitchV) * dt; this.pitch += this.pitchV * dt;
      this.rollV += (wn * wn * (rT - this.roll) - 2 * z * wn * this.rollV) * dt; this.roll += this.rollV * dt;
      const heaveOld = this.heave;
      this.heaveV += (wn * wn * (zT - this.heave) - 2 * z * wn * this.heaveV) * dt; this.heave += this.heaveV * dt;
      void heaveOld;
      // turning heel
      this.roll += (-this.turnRate * this.speed * 0.08 - 0) * dt * 0.2;
    }
    this.vel.copy(this.fwd).multiplyScalar(this.speed); this.vel.y = this.heaveV;
    this.angVel.set(0, -this.turnRate, 0);
    this.updateMatrices();
  }
  toLocal(p, out = new THREE.Vector3()) { return out.copy(p).applyMatrix4(this.inv); }
  toWorld(p, out = new THREE.Vector3()) { return out.copy(p).applyMatrix4(this.world); }
  pointVel(pW, out = new THREE.Vector3()) { return out.copy(pW).sub(this.root.position).cross(this.angVel).negate().add(this.vel); }
}

export function makeSurfaceQuery(terrain, ocean, ships, clock) {
  const res = { point: new THREE.Vector3(), n: new THREE.Vector3(), vel: new THREE.Vector3(), kind: '', ship: null };
  const loc = new THREE.Vector3();
  return function surfaceAt(p) {
    for (const sh of ships) {
      if (!sh.deck || !sh.alive) continue;
      const dx = p.x - sh.pos.x, dz = p.z - sh.pos.z;
      if (dx * dx + dz * dz > 210 * 210) continue;
      loc.copy(p).applyMatrix4(sh.inv);
      if (loc.y < sh.deckY - 3.5 || loc.y > sh.deckY + 25) continue;
      if (!pointInDeck(loc.x, loc.z)) continue;
      res.point.set(loc.x, sh.deckY, loc.z).applyMatrix4(sh.world);
      res.n.set(0, 1, 0).applyQuaternion(sh.quat);
      sh.pointVel(res.point, res.vel);
      res.kind = 'deck'; res.ship = sh;
      return res;
    }
    const th = terrain.heightAt(p.x, p.z);
    if (p.y > Math.max(th, 4) + 8) return null;
    const wh = ocean.heightAt(p.x, p.z, clock.t);
    if (th > wh) { res.point.set(p.x, th, p.z); terrain.normalAt(p.x, p.z, res.n); res.kind = 'ground'; }
    else { res.point.set(p.x, wh, p.z); res.n.set(0, 1, 0); res.kind = 'water'; }
    res.vel.set(0, 0, 0); res.ship = null;
    return res;
  };
}

// ---------------------------------------------------------------------------------------------
export class CarrierOps {
  constructor(ship, model, game) {
    this.ship = ship; this.model = model; this.game = game;
    this.cat = { state: 'none', idx: 0, t: 0, from: null };
    this.hookAngle = 0; this.hookTipLocal = new THREE.Vector3(); this.prevTipLocal = null;
    this.wire = null; this.wireState = 'none'; this.wireTimer = 0; this.trap = null;
    this.ball = 0; this.lineup = 0; this.inApproach = false; this.lsoTimer = 0; this.passTrack = [];
    this.jbdAngle = [0, 0];
    this.bolterArmed = false;
  }

  // world pose of the aircraft when sitting on catapult i with launch bar on the shuttle
  catPose(i, s = 0) {
    const c = CATS[i];
    const local = new THREE.Vector3(c.x, DECK_Y + 2.0, c.z0 - JET_GEOM.launchBar.z - s);
    const p = this.ship.toWorld(local);
    const kneel = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1.6 * D2R);
    const q = this.ship.quat.clone().multiply(kneel);
    return { p, q };
  }

  nearCat(ac) {
    const lb = _v.copy(JET_GEOM.launchBar).applyQuaternion(ac.s.q).add(ac.s.p);
    const loc = this.ship.toLocal(lb);
    for (let i = 0; i < CATS.length; i++) {
      const c = CATS[i];
      const d = Math.hypot(loc.x - c.x, loc.z - c.z0);
      if (d < 6 && Math.abs(loc.y - DECK_Y) < 4) {
        const f = ac.forward(_v2); const sf = this.ship.fwd; const ang = Math.acos(THREE.MathUtils.clamp(f.x * sf.x + f.z * sf.z, -1, 1));
        if (ang < 25 * D2R) return i;
      }
    }
    return -1;
  }

  // F key: hookup / salute
  actionKey(ac) {
    const c = this.cat;
    if (c.state === 'none') {
      const i = this.nearCat(ac);
      if (i >= 0 && ac.onGround && ac.tas - this.ship.speed < 5) {
        c.state = 'hookup'; c.idx = i; c.t = 0;
        c.fromP = this.ship.toLocal(ac.s.p.clone()); c.fromQ = this.ship.quat.clone().invert().multiply(ac.s.q.clone());
        ac.kinematic = (dt) => this.kinematic(ac, dt);
        this.game.msg('HOOKED TO THE CATAPULT', 3);
        this.game.audio.catapultHookup();
        return true;
      }
      if (ac.onGround && this.trap && this.trap.done) { this.game.respawnOnCat(); return true; }
      return false;
    }
    if (c.state === 'tension') {
      if (ac.ctl.throttle < 0.78) { this.game.msg('MORE POWER FIRST — HOLD SHIFT TO 80%, THEN PRESS F', 3); return true; }
      c.state = 'salute'; c.t = 0;
      this.game.msg('READY — LAUNCHING IN 2 SECONDS…', 2);
      return true;
    }
    return false;
  }

  placeOnCat(ac, i) {
    const c = this.cat; c.state = 'tension'; c.idx = i; c.t = 0;
    ac.kinematic = (dt) => this.kinematic(ac, dt);
    const pose = this.catPose(i);
    ac.s.p.copy(pose.p); ac.s.q.copy(pose.q); ac.s.v.copy(this.ship.vel); ac.s.w.set(0, 0, 0);
  }

  kinematic(ac, dt) {
    const c = this.cat; c.t += dt;
    const sh = this.ship;
    if (c.state === 'hookup') {
      const k = Math.min(1, c.t / 1.6); const e = k * k * (3 - 2 * k);
      const tgt = this.catPose(c.idx);
      const tgtLocal = sh.toLocal(tgt.p.clone());
      const pL = c.fromP.clone().lerp(tgtLocal, e);
      ac.s.p.copy(sh.toWorld(pL));
      const qL = c.fromQ.clone().slerp(sh.quat.clone().invert().multiply(tgt.q), e);
      ac.s.q.copy(sh.quat).multiply(qL);
      ac.s.v.copy(sh.vel); ac.s.w.set(0, 0, 0);
      if (k >= 1) { c.state = 'tension'; c.t = 0; this.game.msg('HOOKED UP — HOLD SHIFT TO 80% POWER, THEN PRESS F', 4); }
    } else if (c.state === 'tension' || c.state === 'salute') {
      const pose = this.catPose(c.idx);
      // engine run-up shakes the jet against the holdback
      const shake = ac.rpm > 0.9 ? (ac.ab > 0.1 ? 0.012 : 0.006) : 0;
      ac.s.p.copy(pose.p).add(_v.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0));
      ac.s.q.copy(pose.q); ac.s.v.copy(sh.vel); ac.s.w.set(0, 0, 0);
      if (c.state === 'salute' && c.t > 2.0) {
        if (ac.ctl.throttle < 0.7) { c.state = 'tension'; this.game.msg('LAUNCH CANCELLED — KEEP THE THROTTLE UP', 2); }
        else { c.state = 'stroke'; c.t = 0; this.game.audio.catapultFire(); this.game.onCatShot(); }
      }
    } else if (c.state === 'stroke') {
      const A = 84.9 / 2.5; // 0 -> 165 kts in 2.5 s
      const tt = Math.min(c.t, 2.5); const s = 0.5 * A * tt * tt;
      const pose = this.catPose(c.idx, s);
      ac.s.p.copy(pose.p); ac.s.q.copy(pose.q);
      ac.s.v.copy(sh.vel).addScaledVector(sh.fwd, A * tt); ac.s.w.set(0, 0, 0);
      this.game.catStroke = { t: tt, s };
      if (c.t >= 2.5) {
        c.state = 'none'; ac.kinematic = null; ac.handsOff = 3.0;
        ac.s.v.copy(sh.vel).addScaledVector(sh.fwd, A * 2.5);
        this.game.catStroke = null;
        this.game.msg('LAUNCHED! PULL BACK GENTLY (S), THEN GEAR UP (G)', 3);
      }
    }
  }

  hookTip(ac, s, outW) {
    const pv = JET_GEOM.hookPivot; const L = JET_GEOM.hookLen; const a = this.hookAngle;
    return outW.set(pv.x, pv.y - Math.sin(a) * L, pv.z + Math.cos(a) * L).applyQuaternion(s.q).add(s.p);
  }

  update(ac, dt) {
    const sh = this.ship;
    // JBD raise while hooked on cat
    for (let i = 0; i < 2; i++) {
      const up = (this.cat.state === 'tension' || this.cat.state === 'salute' || this.cat.state === 'stroke') && this.cat.idx === i;
      this.jbdAngle[i] += ((up ? 1 : 0) - this.jbdAngle[i]) * Math.min(1, dt * 0.8);
      this.model.jbds[i].rotation.x = -this.jbdAngle[i] * 1.05;
    }
    // shuttle position
    for (let i = 0; i < 2; i++) {
      const c = CATS[i]; let z = c.z0;
      if (this.cat.idx === i && this.cat.state === 'stroke' && this.game.catStroke) z = c.z0 - this.game.catStroke.s;
      this.model.shuttles[i].position.z = z;
    }
    // hook actuator with deck/ground contact limiting
    const target = ac.ctl.hookCmd ? 1.12 : 0;
    this.hookAngle += THREE.MathUtils.clamp(target - this.hookAngle, -dt * 1.0, dt * 1.6);
    ac.hook = this.hookAngle / 1.12;
    if (this.hookAngle > 0.05) {
      // limit so tip rides on the surface
      let lo = 0, hi = this.hookAngle;
      const tip = this.hookTip(ac, ac.s, _v);
      const surf = this.game.surfaceAt(tip);
      if (surf && _v2.copy(surf.point).sub(tip).dot(surf.n) > 0) {
        for (let k = 0; k < 10; k++) {
          const mid = (lo + hi) / 2; this.hookAngle = mid; const tp = this.hookTip(ac, ac.s, _v3);
          const sf = this.game.surfaceAt(tp);
          if (sf && _v2.copy(sf.point).sub(tp).dot(sf.n) > 0) hi = mid; else lo = mid;
        }
        this.hookAngle = lo;
      }
    }
    // wire engagement
    const tipW = this.hookTip(ac, ac.s, new THREE.Vector3());
    const tipL = sh.toLocal(tipW, this.hookTipLocal);
    const ld = LANDING.dir;
    if (!this.wire && this.hookAngle > 0.3 && this.prevTipLocal && ac.ctl.hookCmd) {
      for (const w of this.model.wires) {
        const a = w.a, b = w.b;
        const dPrev = (this.prevTipLocal.x - a.x) * ld.x + (this.prevTipLocal.z - a.z) * ld.y;
        const dCur = (tipL.x - a.x) * ld.x + (tipL.z - a.z) * ld.y;
        if (dPrev < 0 && dCur >= 0) {
          const lat = (tipL.x - (a.x + b.x) / 2) * LANDING.perp.x + (tipL.z - (a.z + b.z) / 2) * LANDING.perp.y;
          if (Math.abs(lat) < LANDING.halfWidth - 0.5 && tipL.y < DECK_Y + 0.22 && tipL.y > DECK_Y - 1.5) { // pendant rides ~12 cm up on bow springs
            this.engage(ac, w);
            break;
          }
        }
      }
      // bolter detection: hook passed the last wire on deck without engaging
      const lw = this.model.wires[3];
      const dLast = (tipL.x - lw.a.x) * ld.x + (tipL.z - lw.a.z) * ld.y;
      const dLastPrev = (this.prevTipLocal.x - lw.a.x) * ld.x + (this.prevTipLocal.z - lw.a.z) * ld.y;
      if (!this.wire && dLastPrev < 0 && dLast >= 0 && ac.onGround && ac.contactSurface === 'deck') { this.game.msg(this.game.opts.realistic ? 'MISSED THE WIRES — FULL POWER, CLIMB AND TRY AGAIN' : BOLTER_MSG, 3); this.game.audio.speak('Bolter, bolter, bolter', { voice: 'lso' }); }
    }
    this.prevTipLocal = this.prevTipLocal || new THREE.Vector3(); this.prevTipLocal.copy(tipL);
    // engaged wire visuals & state
    if (this.wire) {
      setWire(this.wire, tipL);
      if (!ac.ctl.hookCmd && (this.wireState === 'stopped' || this.wireState === 'slack')) this.release(ac);
      if (this.wireState === 'stopped') { this.wireTimer -= dt; if (this.wireTimer < 0) this.wireState = 'slack'; }
      if (this.trap && !this.trap.done && this.wireState !== 'arresting') { this.trap.done = true; this.game.onTrap(this.trap); }
    }
    // IFLOLS
    this.updateLens(ac, dt);
  }

  engage(ac, w) {
    this.wire = w; this.wireState = 'arresting';
    const idx = this.model.wires.indexOf(w) + 1;
    this.trap = { wire: idx, done: false, grade: this.gradePass() };
    this.game.audio.wireTrap();
    this.game.msg(`CAUGHT WIRE ${idx}!`, 3);
    const sh = this.ship;
    this.engageT = this.game.time; this.engageLocal = sh.toLocal(this.hookTip(ac, ac.s, new THREE.Vector3()), new THREE.Vector3());
    this.wirePeakG = 0;
    const RUNOUT = 88; // constant-runout arresting engine: stop point ~88 m past the pendant regardless of entry speed
    const ld = new THREE.Vector3(LANDING.dir.x, 0, LANDING.dir.y);
    ac.extForce = (s, F, T, record) => {
      const tip = this.hookTip(ac, s, _v);
      const A = _v2.copy(w.a).applyMatrix4(sh.world), B = _v3.copy(w.b).applyMatrix4(sh.world);
      const da = A.sub(tip); const la = da.length(); da.multiplyScalar(1 / la);
      const db = B.sub(tip); const lb = db.length(); db.multiplyScalar(1 / lb);
      const span = w.a.distanceTo(w.b);
      const payout = la + lb - span;
      // hook-tip velocity relative to the deck
      const pv = JET_GEOM.hookPivot;
      const rb = _v4.set(pv.x, pv.y - Math.sin(this.hookAngle) * JET_GEOM.hookLen, pv.z + Math.cos(this.hookAngle) * JET_GEOM.hookLen);
      const vTip = _v5.copy(s.w).cross(rb).applyQuaternion(s.q).add(s.v).sub(sh.vel);
      const rate = -vTip.dot(da) - vTip.dot(db);           // purchase-cable payout rate
      const vHook = Math.hypot(vTip.x, vTip.z);
      const tEng = this.game.time - this.engageT;
      let Tn = 0;
      if (this.wireState === 'arresting') {
        // metering only while the jet is still pulling cable out: once it stops (or is pulled back), the stopping
        // tension would otherwise grow with the rollback speed and fling the jet backwards. Decided once per physics
        // step: switching between the Runge-Kutta sub-steps can leave the jet creeping at the threshold for ever.
        if (record) this.metering = (vHook > 2.0 && rate > 0) || tEng < 0.4;
        if (this.metering) {
          // metering: tension for the deceleration that brings the jet to rest at the runout point
          const loc = sh.toLocal(_v6.copy(tip), _v6);
          const x = (loc.x - this.engageLocal.x) * ld.x + (loc.z - this.engageLocal.z) * ld.z;
          const aDes = Math.min(5.2 * 9.81, vHook * vHook / (2 * Math.max(2.5, RUNOUT - x)));
          const geo = Math.max(1.0, rate / Math.max(vHook, 0.5));    // = cos(a) + cos(b): tension -> retarding force (no boost while the pendant is still athwartships)
          const ramp = Math.min(1, 0.15 + tEng / 0.25); // pendant stretch, purchase-cable slack and sheave inertia
          Tn = Math.min(1.3e6, (ac.mass * aDes + Math.max(0, ac.thrust)) / geo) * ramp + 15000;
        } else if (record) { this.wireState = 'stopped'; this.wireTimer = 1.6; }
      } else if (this.wireState === 'stopped') {
        // engine at the end of its stroke: holds the jet against thrust, soaks up the last of the roll, then a gentle rollback pull
        const geo = Math.max(1.0, rate / Math.max(vHook, 0.5));
        Tn = 22000 + (Math.max(0, ac.thrust) + ac.mass * Math.max(0, rate * 0.5) * 3) / geo;
      }
      if (payout > 236) Tn += 3e6 * (payout - 236);          // purchase-cable hard runout limit
      if (record) this.wirePayout = payout;
      const Fw = _v7.copy(da).multiplyScalar(Tn).addScaledVector(db, Tn);
      if (record) this.wirePeakG = Math.max(this.wirePeakG, Fw.length() / (ac.mass * 9.81));
      // the pinned hook shank carries the along-deck pull into the airframe at its pivot (nose-down slam);
      // its side load enters at the hook tip on the deck, so it yaws the jet into line rather than rolling it
      const Fb = Fw.applyQuaternion(_q1.copy(s.q).invert());
      const lat = Fb.x; Fb.x = 0;
      T.add(_v6.copy(pv).cross(Fb));
      T.add(_v6.copy(rb).cross(_v8.set(lat, 0, 0)));
      Fb.x = lat;
      F.add(Fb.applyQuaternion(s.q));
      // arrestment stabilizer: the heavy main-gear tyres and oleos keep a trapped jet tracking straight and
      // wings-level far more stiffly than the simple contact model does, so add that stiffness while hooked
      if (this.wireState !== 'none') {
        const vb = _v6.copy(s.v).sub(sh.vel).applyQuaternion(_q1.copy(s.q).invert());
        const vh = Math.hypot(vb.x, vb.z);
        // ground-track sideslip, only meaningful while rolling forward (not during the rollback)
        const betaG = vh > 4 && -vb.z > 2 ? THREE.MathUtils.clamp(Math.atan2(vb.x, -vb.z), -0.45, 0.45) : 0;
        const up = _v8.set(0, 1, 0).applyQuaternion(s.q), rt = _v4.set(1, 0, 0).applyQuaternion(s.q);
        const phi = Math.atan2(-rt.y, up.y) - sh.roll;                       // bank relative to the deck
        T.y += -5.5e6 * betaG - 9e5 * s.w.y;
        T.z += 4.5e6 * phi - 7e5 * s.w.z;
      }
    };
  }

  release(ac) {
    if (!this.wire) return;
    setWire(this.wire, null); this.wire = null; this.wireState = 'none'; ac.extForce = null;
  }

  gradePass() {
    const tr = this.passTrack.slice(-90);
    if (!tr.length) return 'NO GRADE';
    let dev = 0, lu = 0; for (const p of tr) { dev += Math.abs(p.ball); lu += Math.abs(p.lineup); }
    dev /= tr.length; lu /= tr.length;
    if (dev < 0.35 && lu < 0.6) return 'OK';
    if (dev < 0.7 && lu < 1.2) return 'FAIR';
    return 'NO GRADE';
  }

  updateLens(ac, dt = 0) {
    const sh = this.ship;
    const tip = this.hookTip(ac, ac.s, _v); const tipL = sh.toLocal(tip, _v2);
    const T = landingPoint(LANDING.targetS);
    const dx = T.x - tipL.x, dz = T.y - tipL.z;
    const dist = dx * LANDING.dir.x + dz * LANDING.dir.y; // + when aft of target
    const lat = -(dx * LANDING.perp.x + dz * LANDING.perp.y);
    const hh = tipL.y - DECK_Y;
    const ideal = dist * Math.tan(LANDING.glide * D2R);
    const dev = dist > 1 ? Math.atan2(hh - ideal, dist) / D2R : 0;
    this.ball = THREE.MathUtils.clamp(dev, -1.6, 1.6);
    this.lineup = dist > 1 ? Math.atan2(lat, dist) / D2R : 0;
    this.rangeToTD = dist;
    // raw geometry for the landing assist (unclamped, in metres): hook above (+) / below the glide slope, right (+) /
    // left of the centre line, and the jet's velocity relative to the moving deck along / across the landing line
    this.glideErr = hh - ideal; this.latErr = lat; this.tipH = hh;
    const vL = _v3.copy(ac.s.v).sub(sh.vel).applyQuaternion(_q.copy(sh.quat).invert());
    this.vAlong = vL.x * LANDING.dir.x + vL.z * LANDING.dir.y; this.vLat = vL.x * LANDING.perp.x + vL.z * LANDING.perp.y; this.vUp = vL.y;
    this.inApproach = ac.gear > 0.9 && dist > 0 && dist < 3500 && Math.abs(this.lineup) < 12 && hh < 300 && !ac.onGround;
    // the grade stops sampling 60 m out: over the deck both angles blow up for a few centimetres of error
    if (this.inApproach && dist < 1400 && dist > 60) this.passTrack.push({ ball: this.ball / 0.25, lineup: this.lineup });
    if (this.passTrack.length > 400) this.passTrack.shift();
    // lens cells
    const lens = this.model.lens; const cell = Math.round(5.5 + this.ball / 0.27);
    const visible = dist > 30;
    for (let i = 0; i < lens.cells.length; i++) {
      const lit = visible && i === THREE.MathUtils.clamp(cell, 0, 11);
      lens.cellMat[i].color.setRGB(lit ? (i < 2 ? 3.0 : 3.2) : 0.02, lit ? (i < 2 ? 0.05 : 1.6) : 0.02, lit ? 0.0 : 0.02);
    }
    const waveoff = this.inApproach && dist < 900 && (this.ball < -1.2 || Math.abs(this.lineup) > 6);
    const flash = waveoff && (performance.now() % 500) < 250;
    for (const m of lens.waveoff) m.color.setRGB(flash ? 4 : 0.02, 0.0, 0.0);
    this.waveoff = waveoff;
    // LSO calls. While the landing assist flies the approach the corrections would be orders the player can't act
    // on, so only the wave-off and "roger ball" are said then
    this.lsoTimer -= dt;
    const LA = this.game.landAssist, assisted = LA && LA.state === 'approach';
    if (this.inApproach && dist < 1700 && dist > 120 && this.lsoTimer < 0) {
      const a = this.game.audio; let call = null;
      if (waveoff) call = 'Wave off, wave off!';
      else if (assisted) { if (dist < 900 && dist > 600 && !this._calledBall) { call = 'Roger ball.'; this._calledBall = true; } }
      else if (this.ball < -0.7 && ac.s.v.y - sh.vel.y < -4.5) call = 'Power!';
      else if (this.ball < -0.55) call = "You're low.";
      else if (this.ball > 0.75) call = "You're high.";
      else if (this.lineup < -1.6) call = 'Right for lineup.';
      else if (this.lineup > 1.6) call = 'Come left.';
      else if (dist < 900 && dist > 600 && !this._calledBall) { call = 'Roger ball.'; this._calledBall = true; }
      if (call) { a.speak(call, { voice: 'lso' }); this.game.msg('LANDING OFFICER: ' + call.toUpperCase(), 2); this.lsoTimer = 3.2; }
    }
    if (!this.inApproach) this._calledBall = false;
  }
}
