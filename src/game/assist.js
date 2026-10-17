// "Easy" flight controls. Turns keyboard keys into stick commands for the jet's real fly-by-wire system,
// the way an arcade/instructor mode does: A/D bank the jet up to a bank limit and it turns immediately
// (automatic back-pressure holds the nose on the horizon), letting go rolls wings-level again, and W/S give
// fine pitch corrections. The aircraft physics are untouched - this only decides how far the stick moves.
import * as THREE from 'three';
import { LANDING } from '../models/carrier.js';
import { BOLTER_MSG } from '../sim/carrierOps.js';
import { JET } from '../sim/flight.js';

const D2R = Math.PI / 180, G0 = 9.81;
const _va = new THREE.Vector3();
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (e0, e1, x) => { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class FlightAssist {
  constructor() { this.reset(); }
  reset() { this.bankTgt = 0; this.pull = 0; this.dir = 0; this.hold = 0; }

  // keys: { left, right, pull, push } booleans; returns { pitch, roll } stick in [-1, 1]
  update(dt, ac, keys) {
    const theta = ac.pitchDeg() * D2R;
    const phi = ac.rollDeg() * D2R;
    const gearDown = ac.gear > 0.5;
    const bankMax = (gearDown ? 35 : 78) * D2R;
    // authority of the bank-hold fades out near the vertical, where "bank" stops meaning anything
    const auth = smooth(75 * D2R, 58 * D2R, Math.abs(theta));

    // --- bank target: ramps while A/D is held (taps give small banks), returns to level when released
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (dir && dir !== this.dir && Math.sign(this.bankTgt) !== dir) this.bankTgt = clamp(phi, -bankMax, bankMax) * auth; // start from where the jet is
    this.dir = dir;
    const prev = this.bankTgt;
    // a short "sticky" pause after a tap lets small taps make small, visible corrections
    if (dir) { this.bankTgt = clamp(this.bankTgt + dir * 220 * D2R * dt, -bankMax, bankMax); this.hold = 0.18; }
    else if ((this.hold -= dt) <= 0) this.bankTgt -= Math.sign(this.bankTgt) * Math.min(Math.abs(this.bankTgt), 260 * D2R * dt);
    const tgtRate = (this.bankTgt - prev) / Math.max(dt, 1e-3);
    // roll-rate demand: feed-forward of the target motion plus a correction on the *predicted* bank (less overshoot)
    const p = -ac.s.w.z;
    let err = this.bankTgt - (phi + p * 0.16); err = Math.atan2(Math.sin(err), Math.cos(err));
    let pDes = tgtRate + 4.0 * err;
    pDes = clamp(pDes, -200 * D2R, 200 * D2R);
    let roll = pDes / Math.max(ac.rollRateMax(), 0.2);
    // near vertical: plain roll-rate control from the keys
    roll = roll * auth + dir * 0.7 * (1 - auth);

    // --- pitch: automatic back-pressure for a level turn, plus the player's fine W/S input
    const want = (keys.pull ? 1 : 0) - (keys.push ? 1 : 0);
    if (want) this.pull = clamp(this.pull + want * 2.6 * dt, -1, 1);
    else this.pull -= Math.sign(this.pull) * Math.min(Math.abs(this.pull), 7 * dt);
    // pull slightly ahead of the bank so the nose starts tracking round as the jet rolls in
    const phiEff = phi + clamp(this.bankTgt - phi, -25 * D2R, 25 * D2R) * 0.5;
    const cphi = Math.cos(phiEff);
    let nAuto = Math.cos(theta) * (cphi > 0.2 ? 1 / cphi : 1);          // g for a level turn at this bank
    nAuto = Math.min(nAuto, gearDown ? 1.6 : 4.6) * auth + Math.cos(theta) * (1 - auth);
    if (Math.abs(phi) > 100 * D2R) nAuto = 0;                            // inverted: don't pull toward the ground
    const spAuto = ac.stickForG(nAuto);
    const pc = this.pull * Math.abs(this.pull) * 0.55 + this.pull * 0.45;  // finer near centre
    const pitch = pc >= 0 ? spAuto + pc * (1 - spAuto) : spAuto + pc * (1 + spAuto);
    // a touch of rudder leads the roll-in, so the nose moves the instant A/D is pressed
    const yaw = clamp(err * 1.1, -0.45, 0.45) * auth * (dir ? 1 : 0.4);
    return { pitch: clamp(pitch, -1, 1), roll: clamp(roll, -1, 1), yaw };
  }
}

// Landing assist for the easy controls, modelled on the Super Hornet's own carrier-landing aids (approach
// auto-throttle and the "Magic Carpet" precision landing mode). Once the jet is behind the ship with the gear down it
// holds landing speed with the throttle, flies the glide slope down to the wires and keeps the jet on the landing
// area's centre line. W/S and A/D nudge it; the nudges fade out over the last few hundred metres so a late key press
// can't fly the jet into the back of the ship. On the deck it goes to full power the moment the wheels touch (the real
// procedure, in case the hook misses), idles once a wire has stopped the jet, and after a bolter or wave-off it climbs
// away by itself. Like FlightAssist it only moves the stick and the throttle.
export const ON_SPEED_AOA = 8.1;
// the green "fly here" circle that leads the jet into the approach shows up this close to the ship (gear down)
const JOIN_RANGE = 20000;
const MIL = 0.8, PATTERN_KT = 180, OUT_BACK = 9000;
const _f = new THREE.Vector3(), _jp = new THREE.Vector3();
// lift coefficient of the trimmed jet with the gear down, angle of attack in degrees (flight.js: 0.08 per degree below
// the stall, +0.32 with full flaps, about -0.02 lost to the trim elevator)
const clApproach = (aDeg, flap) => 0.08 * aDeg + 0.32 * flap - 0.02;
// true airspeed at which the jet holds 1 g at the on-speed angle of attack
export function onSpeedTAS(ac, rho) { return Math.sqrt(2 * ac.mass * G0 / (rho * JET.S * clApproach(ON_SPEED_AOA, 1))); }

export class LandingAssist {
  constructor() { this.reset(); }
  reset() {
    this.state = 'off'; this.t = 0; this.why = '';
    this.thr = 0; this.thrI = 0; this.vTrim = 0; this.nI = 0; this.vyMan = 0; this.manBank = 0; this.wMan = 0; this.offDeckT = 0; this.idle = false;
    this.leg = 'out'; this.side = -1;
    // armed: the player means to land (gear lowered in the air, or the assist has already flown an approach). Only then
    // do the green circle, the hints and the pattern auto-throttle show up, so they stay out of the way after a
    // catapult launch, when the gear is still down
    this.armed = false; this.prevGear = null; this.pattern = false; this.userThr = 0.8;
  }

  // armed, gear down, in the air near the ship and the assist not flying: the circle pattern is being flown
  inPattern(g) {
    const ac = g.player.ac;
    return this.state === 'off' && this.armed && !!ac.ctl.gearCmd && !ac.onGround && g.ops.vAlong != null && g.carrier.root.position.distanceTo(ac.s.p) < JOIN_RANGE;
  }

  // the "basket" behind the ship where the assist can take over: inside 7 km, within 20° of the centre line,
  // 1.5° low to 2.5° high on the glide slope, and flying up the landing line
  canCapture(ac, ops) {
    const d = ops.rangeToTD;
    if (!(d > 350 && d < 7000) || ac.gear < 0.9 || ac.onGround || ops.vAlong == null) return false;
    const latA = Math.atan2(Math.abs(ops.latErr), d) / D2R, gsA = Math.atan2(ops.glideErr, d) / D2R;
    return latA < 20 && gsA > -1.5 && gsA < 2.5 && ops.tipH > 15 && ops.vAlong > 35 && ops.vAlong > 0.75 * Math.hypot(ops.vAlong, ops.vLat);
  }

  enter(state, g, why = '') {
    const prev = this.state; this.state = state; this.t = 0; this.why = why;
    if (state === 'approach') {
      const c = g.player.ac.ctl; this.armed = true;
      this.thr = this.thrI = Math.min(c.throttle, MIL); this.vTrim = 0; this.nI = 0; this.vyMan = 0; this.manBank = 0; this.wMan = 0;
      g.msg('LANDING ASSIST ON — IT HOLDS SPEED, GLIDE SLOPE AND LINEUP FOR YOU', 4, '#b0ffb0');
      if (!c.hookCmd) { c.hookCmd = 1; g.audio.hookMotor(); g.msg('HOOK DOWN — THE ASSIST LOWERED IT FOR YOU', 3); }
    } else if (state === 'climb') {
      g.msg(why === 'bolter' ? BOLTER_MSG : why === 'waveoff' ? 'WAVE-OFF — TOO FAR OFF THE GLIDE PATH. CLIMBING AWAY' : 'TOO HIGH OVER THE DECK — CLIMBING AWAY FOR ANOTHER TRY', 4, '#ffe680');
    } else if (state === 'deck') this.offDeckT = 0;
    else if (state === 'done') this.idle = true;
    else if (state === 'off' && prev !== 'off') {
      if (why === 'gear') g.msg('LANDING ASSIST OFF (GEAR UP)', 2.5);
      else if (why === 'lost') g.msg('LANDING ASSIST OFF — TOO FAR FROM THE LANDING LINE', 3);
      else if (why === 'climbed') g.msg(g.scenario === 'approach' ? 'YOU HAVE CONTROL — PRESS ENTER TO FLY THE APPROACH AGAIN' : 'YOU HAVE CONTROL — COME AROUND BEHIND THE SHIP AND TRY AGAIN', 6, '#b0ffb0');
    }
  }

  // the strip at the top of the screen: what the assist is doing or, gear down with the assist off, what keeps it from
  // taking over. null = nothing to show
  status(g) {
    switch (this.state) {
      case 'approach': return { text: 'LANDING ASSIST FLYING · HANDS OFF IS FINE · W A S D = SMALL NUDGES', color: '#9fffb5' };
      case 'deck': return { text: 'WHEELS DOWN — FULL POWER IN CASE THE HOOK MISSES', color: '#ffe680' };
      case 'trap': return { text: 'CAUGHT A WIRE — HOLD ON', color: '#9fffb5' };
      case 'climb': return { text: 'LANDING ASSIST CLIMBING AWAY · HANDS OFF', color: '#ffe680' };
      case 'off': { const h = this.joinHint(g); return h ? { text: h.text.toUpperCase(), color: '#cfe9ff' } : null; }
      default: return null;
    }
  }

  // the green "fly here" circle (gear down, assist off), a little like the legs of a real landing pattern. Behind the
  // ship and not too far off to the side ('final') it slides along the extended centre line, ahead of the jet and on
  // the glide slope: flying straight at it cuts in toward the landing line at about 30° and then eases onto it, on the
  // glide path, which is where the assist takes over. From anywhere else ('out') it waits 9 km behind the ship, 2.5 km
  // off to the jet's side, so a jet coming from ahead or beside the ship first flies past it, then turns in.
  joinPoint(g, out) {
    const ops = g.ops, x = ops.rangeToTD, y = ops.latErr, ay = Math.abs(y);
    if (ay > 400) this.side = Math.sign(y);
    const outP = g.approachPoint(OUT_BACK, this.side * 2500, out);
    if (this.leg === 'final') { if (x < 1500 || ay > 0.6 * x - 600) this.leg = 'out'; }
    else if (ay < 0.6 * x - 1300 && (ops.vAlong > 0 || x > OUT_BACK - 500 || outP.distanceTo(g.player.ac.s.p) < 1500)) this.leg = 'final';
    return this.leg === 'final' ? g.approachPoint(x - Math.max(2000, 1.6 * ay), 0, out) : outP;
  }

  // gear down near the ship and the assist not flying yet: what to do so it takes over (see canCapture), as
  // { text, circle } (circle: the advice is about the green circle, so the coach adds where it is). null when it
  // doesn't apply
  joinHint(g) {
    const ac = g.player.ac, ops = g.ops;
    if (!g.player.alive || !this.inPattern(g)) return null;
    if (ac.gear < 0.9) return { text: 'Gear coming down…' };
    const jp = this.joinPoint(g, _jp), f = ac.forward(_f);
    let brg = (Math.atan2(jp.x - ac.s.p.x, -(jp.z - ac.s.p.z)) - Math.atan2(f.x, -f.z)) / D2R; brg = ((brg % 360) + 540) % 360 - 180;
    if (Math.abs(brg) > 30) return { text: `Turn ${brg < 0 ? 'left' : 'right'} toward the green circle`, circle: true };
    if (this.leg !== 'final') return { text: 'Fly to the green circle behind the ship', circle: true };
    const d = ops.rangeToTD, gsA = Math.atan2(ops.glideErr, Math.max(d, 1)) / D2R, ft = Math.max(50, Math.round(Math.abs(ops.glideErr) * 3.28084 / 50) * 50);
    if (gsA >= 2.5) return { text: `Too high — come down about ${ft} ft (W)` };
    if (gsA <= -1.5 || ops.tipH <= 15) return { text: `Too low — climb about ${ft} ft (S)` };
    return { text: 'Keep flying at the green circle — the landing assist takes over soon', circle: true };
  }

  // keys: { left, right, pull, push } booleans. Returns null when the assist is not involved, otherwise the stick
  // { pitch, roll, yaw } (pitch null = the player keeps the stick) and/or { throttle }.
  update(dt, g, keys) {
    const ops = g.ops, P = g.player, ac = P.ac;
    if (!P.alive) { if (this.state !== 'off') this.reset(); return null; }
    this.t += dt;
    const onDeck = ac.onGround && ac.contactSurface === 'deck';
    const d = ops.rangeToTD, gear = !!ac.ctl.gearCmd, wasPattern = this.pattern;
    // gear raised while the assist had the throttle: give back the power the player had set, so the jet doesn't
    // slowly run out of speed at the assist's landing setting
    const handBack = !gear && this.prevGear && (wasPattern || this.state === 'approach');
    this.pattern = false;
    if (!gear) this.armed = false;
    else if (this.prevGear === false && !ac.onGround) this.armed = true;
    this.prevGear = gear;
    switch (this.state) {
      case 'off': if (this.canCapture(ac, ops)) { if (!wasPattern) this.userThr = ac.ctl.throttle; this.enter('approach', g); } break;
      case 'approach': {
        const latA = Math.atan2(Math.abs(ops.latErr), Math.max(d, 1)) / D2R, gsA = Math.atan2(ops.glideErr, Math.max(d, 1)) / D2R;
        if (!ac.ctl.gearCmd) this.enter('off', g, 'gear');
        else if (ac.onGround) this.enter(onDeck ? 'deck' : 'off', g);
        else if (d < -40) this.enter('climb', g, 'long');
        else if (d > 9000 || (d > 250 && latA > 30)) this.enter('off', g, 'lost');
        else if (d > 150 && d < 1200 && (gsA < -1.2 || latA > 8)) this.enter('climb', g, 'waveoff');
        break;
      }
      case 'deck':
        if (ops.wire) this.enter('trap', g);
        else if (!ac.onGround) { if ((this.offDeckT += dt) > 0.15) this.enter('climb', g, 'bolter'); }
        else this.offDeckT = 0;
        break;
      case 'trap':
        if ((ops.trap && ops.trap.done) || (ops.wire && Math.abs(ops.vAlong) < 3)) this.enter('done', g);
        else if (!ops.wire) this.enter('deck', g);
        break;
      case 'climb':
        if (ac.onGround) this.enter(onDeck ? 'deck' : 'off', g);
        else if ((ac.s.p.y > 190 && Math.abs(ac.s.v.y) < 3 && this.t > 4) || this.t > 35 || !ac.ctl.gearCmd) this.enter('off', g, 'climbed');
        break;
      case 'done':
        if (!ac.onGround || !ops.trap) this.enter('off', g);
        break;
    }
    switch (this.state) {
      case 'approach': return this.approach(dt, ac, ops, keys);
      case 'climb': return this.climb(ac);
      // hands off the stick on the deck: a push now would slam the nose wheel down
      case 'deck': case 'trap': return { pitch: 0, roll: 0, yaw: 0, throttle: MIL };
      case 'done': if (this.idle) { this.idle = false; return { pitch: null, throttle: 0 }; } return null;
      default:
        if (handBack) return { pitch: null, throttle: Math.max(this.userThr, 0.6) };
        if (!this.inPattern(g)) return null;
        if (!wasPattern) { this.userThr = ac.ctl.throttle; this.thr = this.thrI = Math.min(ac.ctl.throttle, MIL); }
        this.pattern = true;
        return { pitch: null, throttle: this.patternThrottle(dt, ac) };
    }
  }

  // flying the circle pattern (the player steers): hold a steady speed, slow enough that the turn onto the landing
  // line stays tight and close to the speed the assist wants when it takes over
  patternThrottle(dt, ac) {
    const vAir = _va.copy(ac.s.v).sub(ac.env.wind), accel = ac.k[0].dv.dot(vAir) / Math.max(vAir.length(), 1);
    const eV = clamp(PATTERN_KT / 1.944 - ac.ias(), -15, 15);
    const cmd = this.thrI + 0.06 * eV - 0.15 * accel;
    if ((cmd < MIL || eV < 0) && (cmd > 0 || eV > 0)) this.thrI = clamp(this.thrI + 0.01 * eV * dt, 0, MIL);
    this.thr += clamp(clamp(cmd, 0, MIL) - this.thr, -0.5 * dt, 0.5 * dt);
    return this.thr;
  }

  approach(dt, ac, ops, keys) {
    const d = ops.rangeToTD, Vc = Math.max(ops.vAlong, 30);
    const theta = ac.pitchDeg() * D2R, phi = ac.rollDeg() * D2R, p = -ac.s.w.z;
    // glide slope: a climb-rate command that closes on the glide slope; no flare (carrier jets fly into the deck).
    // Far out it may come down steeper to fix a high start; the last 300 m keep the sink rate gentle.
    const late = clamp((d - 150) / 600, 0, 1);
    const want = (keys.pull ? 1 : 0) - (keys.push ? 1 : 0);
    this.vyMan += (want * 2.5 * late - this.vyMan) * Math.min(1, dt * 2.5);
    // over the ramp (where the pass is no longer graded) aim the hook 30 cm high, a few metres down the deck, so a
    // hook that is a little low still skips wire 2 and takes wire 3
    const aim = d < 60 ? 0.3 * Math.min(1, (60 - d) / 60) : 0, aimRate = d < 60 && d > 0 ? 0.3 * Vc / 60 : 0;
    const vyMin = d > 1500 ? -10 : d > 700 ? -8 : d > 300 ? -7 : -6;
    const vyCmd = clamp(-Vc * Math.tan(LANDING.glide * D2R) - 0.3 * (ops.glideErr - aim) + aimRate + this.vyMan, vyMin, 3.5);
    const ev = vyCmd - ops.vUp;
    this.nI = clamp(this.nI + ev * 0.05 * dt, -0.15, 0.15);
    const dn = clamp(ev * 0.12 + this.nI, -0.35, 0.35);
    const pitch = ac.stickForG(neutralG(theta, phi) + dn);
    // lineup: steer so the jet is on the centre line, and tracking along it, by the time it is 200 m out (relative to
    // the deck, which slides sideways as the ship steams), allowing less and less bank near the ship so it touches down
    // wings-level. A/D nudges fade out near the deck.
    const bankMax = clamp(1.5 + (d - 100) * 0.0125, 1.5, 20) * D2R;
    const tgo = Math.max((d - 200) / Vc, 4);
    const aCmd = -6 * ops.latErr / (tgo * tgo) - 4 * ops.vLat / tgo;
    const auto = clamp(Math.atan2(aCmd, G0), -bankMax, bankMax);
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const manMax = Math.max(bankMax, 5 * D2R);
    if (dir) { this.manBank = clamp(this.manBank + dir * 30 * D2R * dt, -manMax, manMax); this.wMan = Math.min(1, this.wMan + dt * 4); }
    else { this.manBank -= Math.sign(this.manBank) * Math.min(Math.abs(this.manBank), 30 * D2R * dt); this.wMan = Math.max(0, this.wMan - dt * 0.8); }
    const wMan = this.wMan * clamp((d - 250) / 500, 0, 1);
    const bank = wMan * this.manBank + (1 - wMan) * auto;
    const roll = clamp(3.2 * wrap(bank - (phi + p * 0.2)) / Math.max(ac.rollRateMax(), 0.2), -1, 1);
    // auto-throttle: hold the on-speed airspeed (a little more in a bank), damped with the measured acceleration along
    // the flight path so it settles without overshooting; a slow trim on the angle of attack takes out what the
    // estimate misses (thrust carries a little of the weight, for one)
    const vAir = _va.copy(ac.s.v).sub(ac.env.wind);
    const accel = ac.k[0].dv.dot(vAir) / Math.max(vAir.length(), 1);
    this.vTrim = clamp(this.vTrim + (ac.alpha / D2R - ON_SPEED_AOA) * 0.003 * dt, -0.04, 0.04);
    const eV = clamp(onSpeedTAS(ac, ac.rho) * (1 + this.vTrim) * Math.sqrt(clamp(1 / Math.cos(phi), 1, 1.15)) - ac.tas, -12, 12);
    const thrCmd = this.thrI + 0.06 * eV - 0.15 * accel + dn * 0.4;
    if ((thrCmd < MIL || eV < 0) && (thrCmd > 0 || eV > 0)) this.thrI = clamp(this.thrI + 0.01 * eV * dt, 0, MIL);
    this.thr += clamp(clamp(thrCmd, 0, MIL) - this.thr, -0.5 * dt, 0.5 * dt);
    return { pitch, roll, yaw: 0, throttle: this.thr };
  }

  // bolter / wave-off: wings level, military power, climb away at about 2,000 ft/min and level off around 700 ft;
  // once safely away the throttle comes back so the jet doesn't race off with the gear down
  climb(ac) {
    const theta = ac.pitchDeg() * D2R, phi = ac.rollDeg() * D2R, p = -ac.s.w.z;
    let dn = clamp((clamp((220 - ac.s.p.y) * 0.12, 0, 10) - ac.s.v.y) * 0.1, -0.25, 0.4);
    if (theta > 15 * D2R) dn = Math.min(dn, 0);
    const pitch = ac.stickForG(neutralG(theta, phi) + dn);
    const roll = clamp(3.2 * wrap(-(phi + p * 0.2)) / Math.max(ac.rollRateMax(), 0.2), -1, 1);
    const throttle = this.t < 5 ? MIL : clamp(MIL - (ac.ias() * 1.944 - 200) * 0.02, 0.3, MIL);
    return { pitch, roll, yaw: 0, throttle };
  }
}

// the load factor the fly-by-wire treats as "stick centred" (see Aircraft.fcs)
function neutralG(theta, phi) {
  return Math.abs(phi) < 45 * D2R ? Math.cos(theta) / Math.max(Math.cos(phi), 0.45) : Math.cos(theta);
}
