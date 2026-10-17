// Flight-test card for the player's jet (src/sim/flight.js), flown by simple autopilots on the bare flight model:
// sustained and instantaneous turn rates, roll rates, G onset, acceleration, top speed and climb.
// `node test/flight_probe.mjs [str,itr,pull,roll,pitch,accel]` (default all). Air-to-air load (2 AIM-9X + 7 AIM-120), 85% fuel.
import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Aircraft } = await import('../src/sim/flight.js');
const { isa } = await import('../src/sim/atmo.js');

const D2R = Math.PI / 180, KT = 1.943844, DT = 1 / 120;
const parts = new Set((process.argv[2] || 'str,itr,pull,roll,pitch,accel').split(','));
const env = { surfaceAt: () => null, wind: new THREE.Vector3(), time: 0 };
const tasFor = (kias, h) => kias / KT / Math.sqrt(isa(h).rho / 1.225);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function makeJet(h, kias, bankDeg = 0) {
  const ac = new Aircraft(env);
  ac.storesMass = 2 * 85 + 7 * 152; ac.storesDrag = 2 * (0.127 * 0.004 + 0.0008) + 7 * (0.178 * 0.004 + 0.0008);
  ac.ctl.gearCmd = 0; ac.gear = 0; ac.ctl.throttle = 0.8; ac.rpm = 1; ac.tas = tasFor(kias, h);
  const V = tasFor(kias, h);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -bankDeg * D2R);
  ac.reset(new THREE.Vector3(0, h, 0), q, new THREE.Vector3(0, 0, -V));
  // settle into trimmed level flight (speed frozen) before the test starts
  for (let i = 0; i < 240; i++) { level(ac, h, bankDeg * D2R); ac.step(DT, i * DT); ac.s.v.setLength(V); ac.s.p.y = h; }
  return ac;
}
// wings at `bank`, holding altitude h
function level(ac, h, bank = 0) {
  const s = ac.s, phi = ac.rollDeg() * D2R, p = -s.w.z;
  ac.ctl.roll = clamp(3 * wrap(bank - (phi + 0.2 * p)) / Math.max(ac.rollRateMax(), 0.2), -1, 1);
  const n = (1 + 0.004 * (h - s.p.y) - 0.04 * s.v.y) / Math.max(Math.cos(phi), 0.2);
  ac.ctl.pitch = ac.stickForG(n);
}
const ias = (ac) => ac.ias() * KT;
const fmt = (x, n = 1) => (x == null || !isFinite(x) ? '  -  ' : x.toFixed(n).padStart(5));

// excess power in a level turn at load factor n (stick for n, or full aft stick with n = null) at a pinned airspeed:
// mean (thrust - drag) / mass along the flight path once settled, the G reached and the angle of attack
function turnAt(h, kias, thr, n) {
  const ac = makeJet(h, kias); ac.ctl.throttle = thr;
  const V = tasFor(kias, h); let ex = 0, g = 0, a = 0, k = 0;
  const vh = new THREE.Vector3();
  for (let i = 0; i < 120 * 4; i++) {
    const s = ac.s;
    const cphi = clamp((1 + 0.004 * (h - s.p.y) - 0.04 * s.v.y) / Math.max(n || ac.nz, 1), 0.1, 1);
    const phi = ac.rollDeg() * D2R, p = -s.w.z, bank = Math.acos(cphi);
    ac.ctl.roll = clamp(3 * wrap(bank - (phi + 0.2 * p)) / Math.max(ac.rollRateMax(), 0.2), -1, 1);
    ac.ctl.pitch = n ? Math.min(1, ac.stickForG(n)) : 1;
    ac.step(DT, i * DT);
    if (i > 120 * 2.5) { vh.copy(ac.s.v).normalize(); ex += ac.k[0].dv.dot(vh) + 9.80665 * vh.y; g += ac.nz; a += ac.alpha; k++; }
    ac.s.v.setLength(V);
  }
  return { ex: ex / k, g: g / k, a: a / k / D2R, V };
}
// sustained turn: the load factor where excess power is zero. Flag 'L' = angle-of-attack limited, 'G' = G-limited
// (power to spare at the limit), '' = thrust-limited.
function str(h, kias, thr) {
  const top = turnAt(h, kias, thr, null);
  const rate = (n, V) => 9.80665 * Math.sqrt(Math.max(0, n * n - 1)) / V / D2R;
  if (top.ex >= 0) return { rate: rate(top.g, top.V), g: top.g, a: top.a, flag: top.g > 7.2 ? 'G' : 'L' };
  let lo = 1, hi = top.g, r = null;
  if (turnAt(h, kias, thr, 1).ex < 0) return { rate: 0, g: 1, a: 0, flag: '' };
  for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; r = turnAt(h, kias, thr, mid); if (r.ex > 0) lo = mid; else hi = mid; }
  return { rate: rate(r.g, r.V), g: r.g, a: r.a, flag: '' };
}
// instantaneous turn: rolled to 80° at speed, then full aft stick; peak rate of the velocity vector and the speed lost
function itr(h, kias) {
  const ac = makeJet(h, kias, 80); ac.ctl.throttle = 1; ac.rpm = 1;
  let peak = 0, gPk = 0, aPk = 0, tPk = 0; const v0 = new THREE.Vector3(); let k2 = null, k4 = null;
  for (let i = 0; i < 120 * 4; i++) {
    const s = ac.s, phi = ac.rollDeg() * D2R, p = -s.w.z;
    ac.ctl.roll = clamp(3 * wrap(80 * D2R - (phi + 0.2 * p)) / Math.max(ac.rollRateMax(), 0.2), -1, 1);
    ac.ctl.pitch = 1;
    v0.copy(s.v); ac.step(DT, i * DT);
    const r = v0.angleTo(ac.s.v) / DT / D2R;
    if (r > peak) { peak = r; gPk = ac.nz; aPk = ac.alpha / D2R; tPk = i * DT; }
    if (i === 240) k2 = ias(ac); if (i === 479) k4 = ias(ac);
  }
  return { peak, gPk, aPk, tPk, k2, k4 };
}
// full aft stick in a level turn at a pinned airspeed: how far the angle of attack overshoots, how steady the G is
// (turn = true: banked for a level turn; false: from wings level straight up into a loop, the stick only pulled)
function pull(h, kias, turn) {
  const ac = makeJet(h, kias, turn ? 60 : 0); ac.ctl.throttle = 1; const V = tasFor(kias, h);
  let aMax = 0, sg = 0, sg2 = 0, k = 0;
  for (let i = 0; i < 120 * 5; i++) {
    const s = ac.s, phi = ac.rollDeg() * D2R, p = -s.w.z;
    const bank = Math.acos(clamp((1 + 0.004 * (h - s.p.y) - 0.04 * s.v.y) / Math.max(ac.nz, 1), 0.1, 1));
    ac.ctl.roll = turn ? clamp(3 * wrap(bank - (phi + 0.2 * p)) / Math.max(ac.rollRateMax(), 0.2), -1, 1) : 0;
    ac.ctl.pitch = 1; ac.step(DT, i * DT); ac.s.v.setLength(V);
    aMax = Math.max(aMax, ac.alpha / D2R);
    if (i > 120 * 2) { sg += ac.nz; sg2 += ac.nz * ac.nz; k++; }
  }
  const m = sg / k;
  return { aMax, g: m, gSd: Math.sqrt(Math.max(0, sg2 / k - m * m)), aEnd: ac.alpha / D2R };
}
// full lateral stick from wings level: peak roll rate and time to 90° / 360°
function roll(h, kias) {
  const ac = makeJet(h, kias); let pk = 0, t90 = null, t360 = null, ang = 0;
  for (let i = 0; i < 120 * 4; i++) {
    ac.ctl.roll = 1; ac.ctl.pitch = 0; ac.step(DT, i * DT);
    const p = -ac.s.w.z; pk = Math.max(pk, p / D2R); ang += p * DT;
    if (t90 == null && ang >= 90 * D2R) t90 = i * DT; if (t360 == null && ang >= 2 * Math.PI) t360 = i * DT;
  }
  return { pk, t90, t360 };
}
// stick step to the command for 5 g (or the most available) from level 1 g: G onset times and overshoot
function pitchStep(h, kias, nT) {
  const ac = makeJet(h, kias); let t50 = null, t90 = null, pk = 0;
  for (let i = 0; i < 120 * 3; i++) {
    ac.ctl.pitch = Math.min(1, ac.stickForG(nT)); ac.ctl.roll = 0; ac.step(DT, i * DT);
    pk = Math.max(pk, ac.nz);
    if (t50 == null && ac.nz >= 1 + 0.5 * (nT - 1)) t50 = i * DT; if (t90 == null && ac.nz >= 1 + 0.9 * (nT - 1)) t90 = i * DT;
  }
  return { t50, t90, pk };
}
// level acceleration from 250 KIAS: time to 400 / 500 KIAS, top speed after 4 minutes
function accel(h, thr) {
  const ac = makeJet(h, 250); ac.ctl.throttle = thr; let t400 = null, t500 = null;
  const atm = isa(h); let ps = null;
  for (let i = 0; i < 120 * 240; i++) {
    level(ac, h); ac.step(DT, i * DT);
    const k = ias(ac);
    if (ps == null && k >= 350) { const vh = ac.s.v.clone().normalize(); ps = ac.k[0].dv.dot(vh) * ac.s.v.length() / 9.81; }
    if (t400 == null && k >= 400) t400 = i * DT; if (t500 == null && k >= 500) t500 = i * DT;
  }
  return { t400, t500, top: ias(ac), mach: ac.s.v.length() / atm.a, ps };
}

if (parts.has('str')) {
  console.log('SUSTAINED TURN (level, speed held)          rate °/s     G    AoA°');
  for (const h of [1000, 5000]) for (const thr of [1, 0.8]) {
    const row = [];
    for (const k of [200, 250, 300, 350, 400, 450, 500]) { const r = str(h, k, thr); row.push(`${k}kt ${fmt(r.rate)}${r.flag || ' '}/${fmt(r.g)}g/${fmt(r.a, 0)}°`); }
    console.log(`  ${h} m ${thr === 1 ? 'AB ' : 'MIL'}: ${row.join('  ')}`);
  }
}
if (parts.has('itr')) {
  console.log('INSTANTANEOUS TURN (80° bank, full aft stick, AB)  peak °/s @ G, AoA; KIAS after 2 s / 4 s');
  for (const h of [1000, 5000]) for (const k of [200, 250, 300, 350, 400, 450, 500]) {
    const r = itr(h, k);
    console.log(`  ${h} m ${k} kt: ${fmt(r.peak)}°/s at ${fmt(r.gPk)} g, α ${fmt(r.aPk)}° (t ${r.tPk.toFixed(2)} s)  → ${fmt(r.k2, 0)} / ${fmt(r.k4, 0)} kt`);
  }
}
if (parts.has('pull')) {
  console.log('FULL AFT STICK at pinned speed: peak AoA, mean G ± wobble (2-5 s), AoA at the end;  level turn | loop from wings level');
  for (const h of [1000, 5000]) for (const k of [150, 200, 250, 300, 350, 450]) {
    const r = pull(h, k, true), l = pull(h, k, false);
    console.log(`  ${h} m ${k} kt: peak α ${fmt(r.aMax)}°  G ${fmt(r.g, 2)} ± ${fmt(r.gSd, 2)}  α end ${fmt(r.aEnd)}°  |  peak α ${fmt(l.aMax)}°  G ${fmt(l.g, 2)} ± ${fmt(l.gSd, 2)}  α end ${fmt(l.aEnd)}°`);
  }
}
if (parts.has('roll')) {
  console.log('ROLL (full stick)   peak °/s, time to 90°, time to 360°');
  for (const k of [150, 200, 300, 400, 500]) { const r = roll(3000, k); console.log(`  3000 m ${k} kt: ${fmt(r.pk, 0)}°/s  t90 ${fmt(r.t90, 2)} s  t360 ${fmt(r.t360, 2)} s`); }
}
if (parts.has('pitch')) {
  console.log('PITCH (stick step to 5 g)   t50, t90, peak G');
  for (const k of [250, 350, 450]) { const r = pitchStep(3000, k, 5); console.log(`  3000 m ${k} kt: t50 ${fmt(r.t50, 2)} s  t90 ${fmt(r.t90, 2)} s  peak ${fmt(r.pk, 2)} g`); }
}
if (parts.has('accel')) {
  console.log('LEVEL ACCELERATION from 250 KIAS: time to 400 / 500 KIAS, after 4 min, Ps at 350 kt');
  for (const h of [100, 5000, 10000]) for (const thr of [1, 0.8]) {
    const r = accel(h, thr);
    console.log(`  ${h} m ${thr === 1 ? 'AB ' : 'MIL'}: 400 kt in ${fmt(r.t400, 0)} s, 500 kt in ${fmt(r.t500, 0)} s, top ${fmt(r.top, 0)} KIAS (M ${r.mach.toFixed(2)}), Ps ${fmt(r.ps, 0)} m/s`);
  }
}
