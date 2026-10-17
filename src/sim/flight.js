// 6-DOF rigid-body flight model (RK4) for the player fighter.
//  - Aero: CL(alpha) with stall break and post-stall flat-plate lift, parasite + induced + transonic wave drag,
//    high-alpha drag, sideslip, full stability & control derivatives (pitch/roll/yaw damping, dihedral,
//    weathercock), stall wing-drop, buffet, degraded high-alpha directional stability.
//  - Engine: spool lag, military power 0-80% throttle, staged afterburner 81-100% with exponential fuel flow,
//    density/Mach thrust lapse, IR signature.
//  - FCS: nonlinear dynamic inversion fly-by-wire with G-limiter / AoA-limiter (toggleable for post-stall),
//    roll-rate command, yaw damper + turn coordination, airbrake pitch compensation, hands-off cat launch.
//  - Gear: spring/damper struts + tire friction on moving surfaces (carrier deck), nosewheel steering, brakes.
import * as THREE from 'three';
import { isa, G0 } from './atmo.js';
import { JET_GEOM } from '../models/fighter.js';

const D2R = Math.PI / 180;
export const JET = {
  S: 46.45, b: 13.62, c: 3.9,
  massEmpty: 14550, fuelMax: 6560,
  Ip: 235000, Iy: 270000, Ir: 48000,
  thrMilSL: 2 * 58000, thrMaxSL: 2 * 98000,
};
const smooth = (e0, e1, x) => { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// pitch-loop gains, gear up: G-error gain (with its cap, rad/s) and pitch-rate gain; G limiter gain and lead (s). The
// gear-down powered-approach law keeps the gentler 2.2 / 6 the carrier-landing assist was tuned with
export const FCS = { kn: 4.5, cap: 1.0, kq: 8.0, kg: 12, lg: 0.08 };
// induced-drag factor and the AoA band (deg) over which the separated-flow drag builds up
export const AERO = { k: 0.10, a0: 18, a1: 36 };

export function clBasic(a) {
  const ad = Math.abs(a) / D2R, s = a < 0 ? -1 : 1;
  let attached;
  if (ad <= 16) attached = 0.08 * (a / D2R);
  // past 16 deg the vortices off the leading-edge extensions keep the lift climbing, more slowly, to about 1.95 at 32 deg
  else if (ad <= 32) { const t = (ad - 16) / 16; attached = s * (1.28 + 0.67 * Math.sin(t * Math.PI / 2)); }
  else if (ad <= 44) { const t = (ad - 32) / 12; attached = s * (1.95 - 0.5 * t * t * (3 - 2 * t)); }
  else attached = s * 1.45;
  const fp = 1.15 * Math.sin(2 * a);
  const w = smooth(44, 58, ad);
  return attached * (1 - w) + fp * w;
}
function cd0(M) {
  let w = 0;
  if (M > 0.8) { if (M < 1.05) { const t = (M - 0.8) / 0.25; w = 0.034 * t * t; } else w = 0.034 - 0.012 * Math.min(1, (M - 1.05) / 0.7); }
  return 0.0195 + w;
}
function kInd(M) { return M < 0.85 ? AERO.k : AERO.k + 0.14 * Math.min(1, (M - 0.85) / 0.65); }
function cmStatic(a) {
  const ad = Math.abs(a), s = a < 0 ? -1 : 1;
  let cm = -0.22 * a;
  if (ad > 0.55) cm += s * 0.22 * Math.min(ad - 0.55, 0.35);
  if (ad > 0.95) cm -= s * 0.9 * Math.sin(Math.min(ad - 0.95, 1.2));
  return cm;
}

class State {
  constructor() { this.p = new THREE.Vector3(); this.v = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.w = new THREE.Vector3(); }
  copy(s) { this.p.copy(s.p); this.v.copy(s.v); this.q.copy(s.q); this.w.copy(s.w); return this; }
}
class Deriv {
  constructor() { this.dp = new THREE.Vector3(); this.dv = new THREE.Vector3(); this.dq = new THREE.Quaternion(0, 0, 0, 0); this.dw = new THREE.Vector3(); }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);

const CRASH_POINTS = [
  [0, 0, -9.5], [0, 0.4, 8.6], [-6.35, -0.25, 3.6], [6.35, -0.25, 3.6], [0, -1.15, -2.5], [0, -1.05, 2.5],
  [-2.1, 3.3, 6.5], [2.1, 3.3, 6.5], [0, 1.25, -4.8], [-0.56, -0.6, 8.6], [0.56, -0.6, 8.6],
].map(a => new THREE.Vector3(...a));

export class Aircraft {
  constructor(env) {
    this.env = env; // { surfaceAt(p, out), wind: Vector3, time }
    this.s = new State();
    this.k = [new Deriv(), new Deriv(), new Deriv(), new Deriv()];
    this.tmp = new State();
    this.ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, airbrake: 0, limiter: true, gearCmd: 1, hookCmd: 0 };
    this.de = 0; this.da = 0; this.dr = 0; this.flap = 0;
    this.rpm = 0.7; this.ab = 0; this.fuel = JET.fuelMax * 0.85; this.storesMass = 0; this.storesDrag = 0;
    this.gear = 1; this.hook = 0; this.airbrakePos = 0;
    this.alpha = 0; this.beta = 0; this.mach = 0; this.tas = 0; this.qbar = 0; this.nz = 1; this.ny = 0; this.rho = 1.225;
    this.onGround = false; this.wow = [0, 0, 0]; this.contactSurface = null; this.steer = 0;
    this.health = 100; this.engineHealth = 1; this.crashed = null; this.dropRandom = 0; this.dropTimer = 0;
    this.buffet = 0; this.overG = 0; this.maxG = 1; this.handsOff = 0;
    this.extForce = null; // function(state, F_world, T_body) adding external forces (arresting wire)
    this.kinematic = null; // function(dt) overriding the state (catapult)
    this.ir = 1; this.thrust = 0; this.fuelFlow = 0; this.touchdownV = 0; this.lastSurfaceVel = new THREE.Vector3();
    this._contactF = new THREE.Vector3(); this._contactT = new THREE.Vector3();
    this.gearPts = [JET_GEOM.noseGear, JET_GEOM.mainL, JET_GEOM.mainR];
    this.gearK = [190000, 420000, 420000]; this.gearC = [36000, 70000, 70000];
    this.compress = [0, 0, 0];
  }
  get mass() { return JET.massEmpty + this.fuel + this.storesMass; }

  reset(p, q, v, w = new THREE.Vector3()) {
    this.s.p.copy(p); this.s.q.copy(q).normalize(); this.s.v.copy(v); this.s.w.copy(w);
    this.crashed = null; this.extForce = null; this.kinematic = null;
  }

  // ------------- engine -------------
  updateEngine(dt) {
    const thr = this.ctl.throttle;
    const coreDemand = thr <= 0.8 ? 0.7 + 0.3 * (thr / 0.8) : 1.0;
    const abDemand = thr > 0.805 ? (thr - 0.8) / 0.2 : 0;
    const dem = this.fuel > 0 && this.engineHealth > 0 ? coreDemand : 0.0;
    const up = dem > this.rpm;
    const tau = up ? (this.rpm < 0.86 ? 2.4 : 1.0) : 1.3;
    this.rpm += (dem - this.rpm) * (1 - Math.exp(-dt / tau));
    const abT = this.rpm > 0.965 && this.fuel > 0 ? abDemand : 0;
    this.ab += (abT - this.ab) * (1 - Math.exp(-dt / (abT > this.ab ? 0.45 : 0.22)));
    if (this.ab < 0.002) this.ab = 0;
    const core = this.rpm < 0.7 ? 0 : Math.pow((this.rpm - 0.7) / 0.3, 1.6);
    this.fuelFlow = (0.22 + 1.85 * core + 8.4 * Math.pow(this.ab, 1.6)) * (this.engineHealth > 0 ? 1 : 0);
    this.fuel = Math.max(0, this.fuel - this.fuelFlow * dt);
    this.ir = 0.25 + 1.2 * core + 9.0 * this.ab + Math.max(0, this.mach - 1.2) * 0.8;
  }
  thrustAt(rho, M) {
    const sig = rho / 1.225;
    const core = this.rpm < 0.7 ? 0 : Math.pow((this.rpm - 0.7) / 0.3, 1.6);
    if (this.rpm < 0.3) return 0;
    const Tm = JET.thrMilSL * (0.07 + 0.93 * core) * Math.pow(sig, 0.82) * (1 + 0.22 * M);
    const Ta = (JET.thrMaxSL - JET.thrMilSL) * this.ab * Math.pow(sig, 0.72) * (1 + 0.55 * M);
    const lapse = M > 1.6 ? Math.max(0.3, 1 - (M - 1.6) * 0.8) : 1;
    return (Tm + Ta) * lapse * (0.35 + 0.65 * this.engineHealth);
  }

  // ------------- aerodynamic coefficients -------------
  aeroCoeffs(alpha, beta, M, p, q, r, V, out) {
    const ad = Math.abs(alpha);
    const hat = V > 1 ? 1 / (2 * V) : 0;
    const qc = q * JET.c * hat, pb = p * JET.b * hat, rb = r * JET.b * hat;
    const stall = smooth(26 * D2R, 38 * D2R, ad);
    let CL = clBasic(alpha) + 0.32 * this.flap * (1 - stall) + 3.2 * qc + 0.42 * this.de * (1 - 0.5 * stall);
    const K = kInd(M);
    const clA = Math.min(Math.abs(CL), 1.7);
    const sinA = Math.sin(alpha);
    let CD = cd0(M) + this.storesDrag + K * clA * clA * (1 - stall) + 1.35 * sinA * sinA * smooth(AERO.a0 * D2R, AERO.a1 * D2R, ad)
      + 0.024 * this.gear + 0.06 * this.airbrakePos + 0.05 * this.flap + 0.45 * Math.sin(beta) ** 2 + 0.02 * this.hook;
    const CY = -0.85 * beta + 0.16 * this.dr;
    // roll
    let Clp = -0.42 * (1 - 1.25 * smooth(28 * D2R, 42 * D2R, ad));
    const Cl = -0.075 * beta + 0.16 * this.da + Clp * pb + 0.06 * rb + 0.012 * this.dr + this.dropRandom * smooth(28 * D2R, 36 * D2R, ad);
    // pitch
    const Cm = cmStatic(alpha) - 1.1 * this.de - 5.5 * qc + 0.03 * this.airbrakePos - 0.025 * this.flap + 0.006 * this.gear;
    // yaw
    const Cnb = 0.11 * (1 - 0.85 * smooth(26 * D2R, 46 * D2R, ad));
    const Cn = Cnb * beta + 0.075 * this.dr - 0.28 * rb - 0.006 * this.da - 0.03 * pb;
    out.CL = CL; out.CD = CD; out.CY = CY; out.Cl = Cl; out.Cm = Cm; out.Cn = Cn;
    return out;
  }

  // ------------- dynamics -------------
  surfaceContacts(s, F, T, record) {
    // gear struts + crash points; F world force, T body torque (accumulated)
    const env = this.env;
    const gearOut = this.gear > 0.97;
    let onGround = false;
    for (let i = 0; i < 3; i++) {
      const rb = this.gearPts[i];
      const pW = _v1.copy(rb).applyQuaternion(s.q).add(s.p);
      const surf = env.surfaceAt(pW);
      if (!surf) { if (record) { this.wow[i] = 0; this.compress[i] = 0; } continue; }
      const depth = _v2.copy(surf.point).sub(pW).dot(surf.n);
      if (depth <= 0 || !gearOut || surf.kind === 'water') { if (record) { this.wow[i] = 0; this.compress[i] = Math.max(0, this.compress[i] - 0.05); } continue; }
      onGround = true;
      // contact point velocity
      const wr = _v3.copy(s.w).cross(rb).applyQuaternion(s.q);
      const vRel = _v4.copy(s.v).add(wr).sub(surf.vel);
      const vn = vRel.dot(surf.n);
      const d = Math.min(depth, 0.6);
      let Fn = this.gearK[i] * d - this.gearC[i] * vn;
      if (depth > 0.6) Fn += 3e6 * (depth - 0.6);
      if (Fn < 0) Fn = 0;
      // wheel frame
      const fwd = _v5.set(0, 0, -1).applyQuaternion(s.q);
      fwd.addScaledVector(surf.n, -fwd.dot(surf.n)).normalize();
      if (i === 0 && this.steer !== 0) fwd.applyAxisAngle(surf.n, -this.steer);
      const side = _v2.copy(fwd).cross(surf.n);
      const vf = vRel.dot(fwd), vs = vRel.dot(side);
      const mu = this.ctl.brake > 0 && i > 0 ? 0.55 * this.ctl.brake : 0.025;
      const Ff = -mu * Fn * Math.tanh(vf / 0.35);
      // cornering force builds with slip ANGLE (vs/vf), not raw side speed: tyres skid and yaw at speed instead of acting like rails
      // nose wheel: steering engaged at taxi speeds (or with pedal), free-castering at landing/takeoff speeds
      const muS = i === 0 ? 0.06 + 0.54 * Math.max(1 - smooth(10, 24, Math.abs(vf)), Math.min(1, Math.abs(this.ctl.yaw) * 3) * (1 - smooth(30, 45, Math.abs(vf)))) : 0.6;
      const Fs = -muS * Fn * Math.tanh(vs / Math.max(Math.abs(vf), 2.5) / 0.16);
      const Fw = _v3.copy(surf.n).multiplyScalar(Fn).addScaledVector(fwd, Ff).addScaledVector(side, Fs);
      F.add(Fw);
      // torque in body frame: r x F_body
      _qi.copy(s.q).invert();
      const Fb = Fw.applyQuaternion(_qi);
      T.add(_v4.copy(rb).cross(Fb));
      if (record) {
        this.wow[i] = Fn; this.compress[i] = d; this.contactSurface = surf.kind; this.contactShip = surf.ship || null;
        this.lastSurfaceVel.copy(surf.vel);
      }
    }
    return onGround;
  }

  derivative(s, out, record) {
    const env = this.env; const m = this.mass;
    _qi.copy(s.q).invert();
    // air-relative velocity in body axes
    const vAir = _v1.copy(s.v).sub(env.wind);
    const vb = vAir.applyQuaternion(_qi);
    const V = vb.length();
    const atm = isa(s.p.y);
    const M = V / atm.a; const qbar = 0.5 * atm.rho * V * V;
    let alpha = 0, beta = 0;
    if (V > 2) { alpha = Math.atan2(-vb.y, -vb.z); beta = Math.asin(clamp(vb.x / V, -1, 1)); }
    const p = -s.w.z, q = s.w.x, r = -s.w.y;
    const co = this._co || (this._co = {});
    this.aeroCoeffs(alpha, beta, M, p, q, r, V, co);
    const S = JET.S;
    const L = qbar * S * co.CL, D = qbar * S * co.CD, Y = qbar * S * co.CY;
    const Fb = _v2.set(0, 0, 0);
    if (V > 0.5) {
      const vhat = _v3.copy(vb).multiplyScalar(1 / V);
      const ld = _v4.copy(X_AXIS).cross(vhat);
      const ll = ld.length(); if (ll > 1e-4) ld.multiplyScalar(1 / ll); else ld.set(0, 1, 0);
      Fb.addScaledVector(ld, L).addScaledVector(vhat, -D);
      Fb.x += Y;
    }
    const T = this.thrustAt(atm.rho, M);
    Fb.z -= T;
    // buffet (deterministic noise so RK4 stays consistent within a step)
    const tau = _v5.set(qbar * S * JET.c * co.Cm, -qbar * S * JET.b * co.Cn, -qbar * S * JET.b * co.Cl);
    if (this.buffet > 0) { const bf = this.buffet * qbar * S * 0.012; tau.x += bf * this._bufN[0] * JET.c; tau.z += bf * this._bufN[1] * JET.b * 0.3; Fb.y += bf * this._bufN[2]; }
    // specific force (for G)
    if (record) {
      this.nz = Fb.y / (m * G0); this.ny = Fb.x / (m * G0);
      this.alpha = alpha; this.beta = beta; this.mach = M; this.tas = V; this.qbar = qbar; this.rho = atm.rho; this.thrust = T;
      this.aSound = atm.a;
    }
    // world force (copy out of the shared temporaries before contact evaluation reuses them)
    out.dv.copy(Fb.applyQuaternion(s.q));
    const tauA = this._tauA || (this._tauA = new THREE.Vector3());
    tauA.copy(tau);
    const Tb = this._contactT.set(0, 0, 0);
    const Fc = this._contactF.set(0, 0, 0);
    const ground = this.surfaceContacts(s, Fc, Tb, record);
    if (this.extForce) this.extForce(s, Fc, Tb, record);
    if (record) {
      this.onGround = ground;
      // contact forces contribute to felt G
      _qi.copy(s.q).invert();
      const fcb = _v4.copy(Fc).applyQuaternion(_qi);
      this.nz += fcb.y / (m * G0);
    }
    out.dp.copy(s.v);
    out.dv.add(Fc).multiplyScalar(1 / m); out.dv.y -= G0;
    // quaternion derivative: 0.5 * q * (w,0)
    const qw = s.q, wx = s.w.x, wy = s.w.y, wz = s.w.z;
    out.dq.set(
      0.5 * (qw.w * wx + qw.y * wz - qw.z * wy),
      0.5 * (qw.w * wy + qw.z * wx - qw.x * wz),
      0.5 * (qw.w * wz + qw.x * wy - qw.y * wx),
      -0.5 * (qw.x * wx + qw.y * wy + qw.z * wz));
    // Euler's equations, principal axes: x=pitch, y=yaw, z=roll
    const Ix = JET.Ip, Iy = JET.Iy, Iz = JET.Ir;
    const tx = tauA.x + Tb.x, ty = tauA.y + Tb.y, tz = tauA.z + Tb.z;
    out.dw.set(
      (tx - (Iz - Iy) * wy * wz) / Ix,
      (ty - (Ix - Iz) * wz * wx) / Iy,
      (tz - (Iy - Ix) * wx * wy) / Iz);
  }

  addScaled(dst, s, d, h) {
    dst.p.copy(s.p).addScaledVector(d.dp, h);
    dst.v.copy(s.v).addScaledVector(d.dv, h);
    dst.q.set(s.q.x + d.dq.x * h, s.q.y + d.dq.y * h, s.q.z + d.dq.z * h, s.q.w + d.dq.w * h).normalize();
    dst.w.copy(s.w).addScaledVector(d.dw, h);
    return dst;
  }

  // ------------- flight control system -------------
  fcs(dt) {
    const c = this.ctl, s = this.s;
    const V = Math.max(this.tas, 1);
    const qbar = Math.max(this.qbar, 50);
    const S = JET.S, b = JET.b, cc = JET.c;
    const p = -s.w.z, q = s.w.x, r = -s.w.y;
    // attitude
    const fwd = _v1.set(0, 0, -1).applyQuaternion(s.q), up = _v2.set(0, 1, 0).applyQuaternion(s.q);
    const theta = Math.asin(clamp(fwd.y, -1, 1));
    const right = _v3.set(1, 0, 0).applyQuaternion(s.q);
    const phi = Math.atan2(-right.y, up.y);
    const gearDown = this.gear > 0.5;
    const lim = c.limiter;
    // auto flaps
    // landing configuration: full flaps below ~210 kts (blown back above), else auto maneuvering flaps
    const flapT = gearDown ? clamp((230 - V * 1.944) / 25, 0.3, 1) : clamp((this.alpha / D2R - 8) / 12, 0, 0.6) * (V < 200 ? 1 : 0);
    this.flap += (flapT - this.flap) * Math.min(1, dt * 1.5);
    // pitch: G command (stick neutral = 1g, bank compensated in moderate bank)
    const nMax = lim ? 7.5 : 11.0, nMin = lim ? -3.0 : -5.0;
    let nNeutral = Math.cos(theta);
    if (Math.abs(phi) < (gearDown ? 45 : 70) * D2R) nNeutral = Math.cos(theta) / Math.max(Math.cos(phi), 0.45);
    const sp = c.pitch;
    let nCmd = sp >= 0 ? nNeutral + sp * (nMax - nNeutral) : nNeutral + sp * (nNeutral - nMin);
    // powered-approach law (gear down): gentle flight-path command, +/-1.2 g about flight-path hold
    if (gearDown && lim) nCmd = nNeutral + sp * 1.2;
    const nMeas = this.nz, ctc = Math.cos(theta) * Math.cos(phi);
    const qSS = G0 * (nCmd - ctc) / V;
    // the G-error term is capped: at low speed the jet can't make the commanded G, and an unbounded pitch-rate demand
    // threw the nose far past the AoA limit into a slow pitch bobble
    let qDes = qSS + (gearDown ? 2.2 * (nCmd - nMeas) * G0 / V : clamp(FCS.kn * (nCmd - nMeas) * G0 / V, -FCS.cap, FCS.cap));
    // hands-off catapult rotation: hold ~12 deg pitch
    if (this.handsOff > 0) { this.handsOff -= dt; if (Math.abs(sp) < 0.2) qDes = 1.2 * (12 * D2R - theta); }
    if (lim) {
      // AoA limiter with lead: the pitch rate that holds the present AoA (the flight path's own turn rate) plus a pull
      // toward the limit, applied to the AoA predicted a quarter second ahead so a fast pull stops at the limit. The G
      // limits become AoA limits too (the AoA where the jet would reach them, from the G it makes per degree now), so
      // a hard pull at high speed doesn't overshoot the G limit either
      const qHold = G0 * (nMeas - ctc) / V, aDot = q - qHold, aPred = this.alpha + aDot * 0.25;
      let qHi = qHold + 2.5 * ((gearDown ? 15 : 30) * D2R - aPred), qLo = qHold + 2.5 * (-9 * D2R - aPred);
      const zA = Math.max(qbar * S * 4.58 / (this.mass * G0), 2);
      qHi = Math.min(qHi, qHold + FCS.kg * ((nMax - nMeas) / zA - aDot * FCS.lg));
      qLo = Math.max(qLo, qHold + FCS.kg * ((nMin - nMeas) / zA - aDot * FCS.lg));
      qDes = clamp(qDes, qLo, qHi);
    } else {
      // override: big pitch-rate authority; neutral stick lets the nose fall back out of post-stall (Cobra recovery)
      const aExcess = Math.abs(this.alpha) - 22 * D2R;
      if (Math.abs(sp) > 0.05) qDes = sp * 0.9;
      else qDes = aExcess > 0 ? -Math.sign(this.alpha) * Math.min(1.6, 2.2 * aExcess + 0.3) : qDes * 0.5;
    }
    const qDot = (lim ? (gearDown ? 6.0 : FCS.kq) : 9.0) * (qDes - q);
    // required pitching moment
    const co = this._co2 || (this._co2 = {});
    const de0 = this.de; this.de = 0;
    this.aeroCoeffs(this.alpha, this.beta, this.mach, p, q, r, V, co);
    this.de = de0;
    const Mreq = JET.Ip * qDot + (JET.Ir - JET.Iy) * s.w.y * s.w.z;
    let deCmd = (co.Cm - Mreq / (qbar * S * cc)) / 1.1;
    // roll: rate command
    const pMax = this.rollRateMax();
    const pCmd = c.roll * pMax;
    const pDot = 5.5 * (pCmd - p);
    const Lreq = JET.Ir * pDot;
    const da0 = this.da; this.da = 0; this.aeroCoeffs(this.alpha, this.beta, this.mach, p, q, r, V, co); this.da = da0;
    let daCmd = (Lreq / (qbar * S * b) - co.Cl) / 0.16;
    // yaw: coordination + sideslip suppression + pedal
    const rCoord = G0 * Math.sin(phi) * Math.cos(theta) / V;
    const betaCmd = -c.yaw * 9 * D2R; // right pedal (E) = nose right = negative sideslip
    const rDes = rCoord + 2.5 * (this.beta - betaCmd);
    const rDot = 4.0 * (rDes - r);
    const Nreq = JET.Iy * rDot;
    const dr0 = this.dr; this.dr = 0; this.aeroCoeffs(this.alpha, this.beta, this.mach, p, q, r, V, co); this.dr = dr0;
    let drCmd = (Nreq / (qbar * S * b) - co.Cn) / 0.075;
    // low speed / weight on wheels: direct mechanical mapping blend (the real FCS switches gains on WOW, so the
    // sideslip-suppression and g-command loops don't fight the tyres and the hook on the deck)
    this.wowBlend = this.onGround ? 1 : Math.max(0, (this.wowBlend || 0) - dt * 2.5);
    const direct = Math.max(1 - smooth(32, 55, V), this.wowBlend);
    // roll keeps its rate-damping loop on the deck at speed (only the low-speed taxi range is purely mechanical)
    const directRoll = Math.max(1 - smooth(32, 55, V), this.wowBlend * (1 - smooth(25, 45, V)));
    deCmd = deCmd * (1 - direct) + (-sp * 0.42) * direct;
    daCmd = daCmd * (1 - directRoll) + (c.roll * 0.45) * directRoll;
    drCmd = drCmd * (1 - direct) + (c.yaw * 0.52) * direct;
    // actuator limits & rates
    const rate = (cur, cmd, lim1, rt) => { cmd = clamp(cmd, -lim1, lim1); const d = clamp(cmd - cur, -rt * dt, rt * dt); return cur + d; };
    this.de = rate(this.de, deCmd, 0.42, 1.6);
    this.da = rate(this.da, daCmd, 0.45, 2.0);
    this.dr = rate(this.dr, drCmd, 0.52, 1.8);
    // nosewheel steering
    const vg = this.onGround ? this.tas : 0;
    this.steer = this.onGround ? c.yaw * (vg < 12 ? 1.1 : vg < 30 ? 0.3 : 0.08) : 0;
    this.phi = phi; this.theta = theta;
  }

  step(dt, t) {
    this.updateEngine(dt);
    // gear / hook / airbrake actuators
    this.gear += clamp((this.ctl.gearCmd ? 1 : 0) - this.gear, -dt / 3.5, dt / 3.5);
    this.airbrakePos += clamp((this.ctl.airbrake ? 1 : 0) - this.airbrakePos, -dt / 1.2, dt / 1.2);
    // stall wing-drop random walk & buffet noise
    this.dropTimer -= dt;
    if (this.dropTimer < 0) { this.dropTimer = 0.6 + Math.random() * 1.2; this._dropTarget = (Math.random() - 0.5) * 0.06; }
    this.dropRandom += ((this._dropTarget || 0) - this.dropRandom) * Math.min(1, dt * 2);
    const ad = Math.abs(this.alpha);
    this.buffet = smooth(16 * D2R, 30 * D2R, ad) * smooth(1500, 9000, this.qbar) + (this.mach > 0.92 && this.mach < 1.06 ? 0.25 : 0);
    this._bufN = this._bufN || [0, 0, 0];
    this._bufN[0] = (Math.random() - 0.5) * 2; this._bufN[1] = (Math.random() - 0.5) * 2; this._bufN[2] = (Math.random() - 0.5) * 2;
    if (this.kinematic) { this.kinematic(dt, t); this.derivative(this.s, this.k[0], true); return; }
    this.fcs(dt);
    const s = this.s, k = this.k, tmp = this.tmp;
    this.derivative(s, k[0], true);
    this.derivative(this.addScaled(tmp, s, k[0], dt / 2), k[1], false);
    this.derivative(this.addScaled(tmp, s, k[1], dt / 2), k[2], false);
    this.derivative(this.addScaled(tmp, s, k[2], dt), k[3], false);
    const h6 = dt / 6;
    s.p.addScaledVector(k[0].dp, h6).addScaledVector(k[1].dp, 2 * h6).addScaledVector(k[2].dp, 2 * h6).addScaledVector(k[3].dp, h6);
    s.v.addScaledVector(k[0].dv, h6).addScaledVector(k[1].dv, 2 * h6).addScaledVector(k[2].dv, 2 * h6).addScaledVector(k[3].dv, h6);
    s.q.set(
      s.q.x + h6 * (k[0].dq.x + 2 * k[1].dq.x + 2 * k[2].dq.x + k[3].dq.x),
      s.q.y + h6 * (k[0].dq.y + 2 * k[1].dq.y + 2 * k[2].dq.y + k[3].dq.y),
      s.q.z + h6 * (k[0].dq.z + 2 * k[1].dq.z + 2 * k[2].dq.z + k[3].dq.z),
      s.q.w + h6 * (k[0].dq.w + 2 * k[1].dq.w + 2 * k[2].dq.w + k[3].dq.w)).normalize();
    s.w.addScaledVector(k[0].dw, h6).addScaledVector(k[1].dw, 2 * h6).addScaledVector(k[2].dw, 2 * h6).addScaledVector(k[3].dw, h6);
    // angular velocity sanity clamp (numerical safety)
    if (s.w.lengthSq() > 64) s.w.setLength(8);
    this.maxG = Math.max(this.maxG, this.nz);
    this.checkCrash();
  }

  checkCrash() {
    if (this.crashed) return;
    const s = this.s;
    for (const rb of CRASH_POINTS) {
      const pW = _v1.copy(rb).applyQuaternion(s.q).add(s.p);
      const surf = this.env.surfaceAt(pW);
      if (!surf) continue;
      const depth = _v2.copy(surf.point).sub(pW).dot(surf.n);
      if (depth > 0.05) {
        const vRel = _v3.copy(s.v).sub(surf.vel);
        if (vRel.length() > 9 || surf.kind === 'water' || depth > 0.8) { this.crashed = { kind: surf.kind, point: pW.clone(), speed: vRel.length() }; return; }
        // gentle scrape: push out
        s.p.addScaledVector(surf.n, depth);
        const vn = vRel.dot(surf.n); if (vn < 0) s.v.addScaledVector(surf.n, -vn);
      }
    }
    // gear collapse on very hard landing
    if (this.onGround) {
      const surfV = this.lastSurfaceVel;
      const vs = -(s.v.y - surfV.y);
      if (vs > 8.5) this.crashed = { kind: 'hard landing', point: s.p.clone(), speed: vs };
    }
  }

  // FCS roll-rate authority at the current flight condition (full lateral stick)
  rollRateMax() {
    const qf = Math.sqrt(clamp(Math.max(this.qbar, 50) / 14000, 0.05, 1));
    return (this.gear > 0.5 ? 110 : 230) * D2R * qf * (this.ctl.limiter ? Math.max(0.35, 1 - Math.abs(this.alpha) / (40 * D2R)) : 1);
  }
  // inverse of the FCS pitch law: the stick position that commands load factor n (used by the easy-controls assist)
  stickForG(n) {
    const q = this.s.q;
    const fwd = _v1.set(0, 0, -1).applyQuaternion(q), up = _v2.set(0, 1, 0).applyQuaternion(q), right = _v3.set(1, 0, 0).applyQuaternion(q);
    const theta = Math.asin(clamp(fwd.y, -1, 1)), phi = Math.atan2(-right.y, up.y);
    const gearDown = this.gear > 0.5, lim = this.ctl.limiter;
    let nNeutral = Math.cos(theta);
    if (Math.abs(phi) < (gearDown ? 45 : 70) * D2R) nNeutral = Math.cos(theta) / Math.max(Math.cos(phi), 0.45);
    if (gearDown && lim) return clamp((n - nNeutral) / 1.2, -1, 1);
    const nMax = lim ? 7.5 : 11.0, nMin = lim ? -3.0 : -5.0;
    return clamp(n >= nNeutral ? (n - nNeutral) / (nMax - nNeutral) : (n - nNeutral) / (nNeutral - nMin), -1, 1);
  }

  // utility accessors
  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.s.q); }
  up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.s.q); }
  right(out = new THREE.Vector3()) { return out.set(1, 0, 0).applyQuaternion(this.s.q); }
  heading() { const f = this.forward(_v1); return (Math.atan2(f.x, -f.z) / D2R + 360) % 360; }
  pitchDeg() { return Math.asin(clamp(this.forward(_v1).y, -1, 1)) / D2R; }
  rollDeg() { const r = this.right(_v1), u = this.up(_v2); return Math.atan2(-r.y, u.y) / D2R; }
  ias() { return this.tas * Math.sqrt(this.rho / 1.225); }
}
