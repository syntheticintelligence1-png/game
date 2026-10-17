// Easy-controls feel and aiming check: what a key tap and a key hold do to the nose, and two keyboard "pilots" keeping
// the gun cross on a turning or weaving target 600 m ahead (a rough guide: real players adapt, these do not).
// `node test/aim.mjs [tap,hold,track] [realistic]`
import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const { isa } = await import('../src/sim/atmo.js');

const D2R = Math.PI / 180, KT = 1.943844;
const parts = new Set((process.argv[2] || 'tap,hold,track').split(','));
const realistic = process.argv[3] === 'realistic';
const game = new Game({ appendChild() { } }, { scenario: 'air', loadout: 'air', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
// EASY='{"fineBank":30}' tries other easy-control tuning without editing assist.js
const { EASY } = await import('../src/game/assist.js');
if (process.env.EASY) Object.assign(EASY, JSON.parse(process.env.EASY));
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const ac = () => game.player.ac;
const frames = (n, f) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); if (f && f(i) === false) return; } };
const tasFor = (kias, h) => kias / KT / Math.sqrt(isa(h).rho / 1.225);
const wrapD = (a) => ((a + 540) % 360) - 180;
const fmt = (x, n = 1, w = 5) => (x == null || !isFinite(x) ? '-' : x.toFixed(n)).padStart(w);
function start(kias = 350, alt = 3000) {
  game.opts.realistic = realistic;
  game.launch({ scenario: 'air', loadout: 'air', invulnerable: true });
  const a = ac(), s = a.s; s.p.set(0, alt, 30000); s.v.set(0, 0, -tasFor(kias, alt)); s.q.identity(); s.w.set(0, 0, 0);
  a.ctl.throttle = 0.8; a.rpm = 0.9; I.keys.clear();
  for (const j of game.aiJets) j.alive = false;
  frames(90, () => { s.v.setLength(tasFor(kias, alt)); });
}
// heading and climb angle of the flight path, degrees
const pathHdg = () => { const v = ac().s.v; return Math.atan2(v.x, -v.z) / D2R; };
const pathPitch = () => { const v = ac().s.v; return Math.asin(v.y / v.length()) / D2R; };

if (parts.has('tap')) {
  console.log(`=== ${realistic ? 'REALISTIC' : 'EASY'}: taps at 350 KIAS, 3000 m. Nose and flight-path change 2 s later; peak bank / G;`);
  console.log('    time banked over 5° after the key came up');
  const holds = (process.env.TAPS || '0.05,0.1,0.2,0.3,0.5').split(',').map(Number);
  for (const [key, label] of [['KeyD', 'D (right)'], ['KeyS', 'S (pull) ']]) {
    if (process.env.KEYS && !process.env.KEYS.includes(key.slice(3))) continue;
    for (const hold of holds) {
      start();
      const h0 = ac().heading(), p0 = ac().pitchDeg(), ph0 = pathHdg(), pp0 = pathPitch();
      let bank = 0, g = 1, nosePk = 0, banked = 0;
      I.keys.add(key);
      frames(Math.round(hold * 60), () => { bank = Math.max(bank, Math.abs(ac().rollDeg())); g = Math.max(g, ac().nz); });
      I.keys.delete(key);
      frames(120, (i) => {
        if (Math.abs(ac().rollDeg()) > 5) banked += 1 / 60;
        if (process.env.TRACE === `${key} ${hold}` && i % 6 === 0) { const F = game.assist.fine; console.log(`    t ${(i / 60).toFixed(1)} nose ${fmt(wrapD(ac().heading() - h0), 2)} path ${fmt(wrapD(pathHdg() - ph0), 2)} bank ${fmt(ac().rollDeg(), 1)} yaw ${fmt(ac().ctl.yaw, 2)} beta ${fmt(ac().beta / D2R, 2)} fine ${F ? fmt(wrapD(F.psi / D2R - ph0), 2) : '-'} tgt ${fmt(game.assist.bankTgt / D2R, 1)}`); }
        bank = Math.max(bank, Math.abs(ac().rollDeg())); g = Math.max(g, ac().nz);
        nosePk = Math.max(nosePk, Math.abs(key === 'KeyD' ? wrapD(ac().heading() - h0) : ac().pitchDeg() - p0));
      });
      const nose = key === 'KeyD' ? wrapD(ac().heading() - h0) : ac().pitchDeg() - p0;
      const path = key === 'KeyD' ? wrapD(pathHdg() - ph0) : pathPitch() - pp0;
      console.log(`  tap ${label} ${hold.toFixed(2)} s: nose ${fmt(nose, 2)}° (peak ${fmt(nosePk, 2)}°)  path ${fmt(path, 2)}°  peak bank ${fmt(bank, 0)}°  peak G ${fmt(g, 2)}  banked ${fmt(banked, 1)} s`);
    }
  }
}
if (parts.has('hold')) {
  console.log(`=== ${realistic ? 'REALISTIC' : 'EASY'}: key held 3 s. Heading after 0.25/0.5/1/2/3 s, turn rate 1-3 s, peak G, altitude change`);
  for (const kias of [300, 400, 500]) for (const keys of [['KeyD'], ['KeyD', 'KeyS']]) {
    start(kias);
    const h0 = pathHdg(), y0 = ac().s.p.y; const marks = {}; let g = 1, t = 0, h1 = null;
    for (const k of keys) I.keys.add(k);
    frames(180, () => {
      t += 1 / 60; g = Math.max(g, ac().nz);
      for (const m of [0.25, 0.5, 1, 2, 3]) if (marks[m] == null && t >= m - 1e-6) marks[m] = wrapD(pathHdg() - h0);
      if (h1 == null && t >= 1) h1 = pathHdg();
      if (process.env.TRACE === `${kias} ${keys.join('+')}` && Math.round(t * 60) % 6 === 0) console.log(`    t ${t.toFixed(1)} hdg ${fmt(wrapD(pathHdg() - h0), 1)} bank ${fmt(ac().rollDeg(), 0)} pitch ${fmt(ac().pitchDeg(), 1)} G ${fmt(ac().nz, 2)} aoa ${fmt(ac().alpha / D2R, 1)} stick ${fmt(ac().ctl.pitch, 2)} ${fmt(ac().ctl.roll, 2)} yaw ${fmt(ac().ctl.yaw, 2)} beta ${fmt(ac().beta / D2R, 1)}`);
    });
    const rate = wrapD(pathHdg() - h1) / 2;
    for (const k of keys) I.keys.delete(k);
    console.log(`  ${kias} kt ${keys.map(k => k.slice(3)).join('+').padEnd(3)}: ${[0.25, 0.5, 1, 2, 3].map(m => fmt(marks[m], 1)).join(' ')}°   rate ${fmt(rate, 1)}°/s  G ${fmt(g, 1)}  alt ${fmt(ac().s.p.y - y0, 0)} m  ${fmt(ac().ias() * KT, 0)} kt at the end`);
  }
}
if (parts.has('track')) {
  console.log(`=== ${realistic ? 'REALISTIC' : 'EASY'}: keyboard pilots keeping the gun cross on a target 600 m ahead, 350 KIAS. Both see the`);
  console.log('    target 0.15 s late and lead its drift by 0.3 s. "hold": holds a key while the target is over 0.5° off.');
  console.log('    "tap": holds a key for big errors (over 3°, until under 1.5°), taps 0.08 s and waits 0.25 s for small ones');
  // target: level turn at g G, reversing every `rev` s (0 = never); vertical weave of `vz` m/s amplitude
  for (const [label, gT, rev, vz] of [['steady 2 g turn', 2, 0, 0], ['steady 4 g turn', 4, 0, 0], ['2.5 g weave, 4 s', 2.5, 4, 0], ['3 g weave + bob', 3, 3, 15]]) for (const pilot of ['hold', 'tap']) {
    start();
    const ax2 = { x: { key: '', t: 0, wait: 0, big: 0 }, y: { key: '', t: 0, wait: 0, big: 0 } };
    // the "tap" pilot, one axis: e = error (deg) it acts on, plus / minus = the keys that move the nose that way
    const tapAxis = (A, e, plus, minus, dt) => {
      if (A.t > 0) { if ((A.t -= dt) <= 0) { A.key = ''; A.wait = 0.25; } return; }
      if (A.big) { if (e * A.big < 1.5) { A.big = 0; A.key = ''; A.wait = 0.2; } return; }
      if (A.wait > 0) { A.wait -= dt; return; }
      if (Math.abs(e) > 3) { A.big = Math.sign(e); A.key = e > 0 ? plus : minus; } else if (Math.abs(e) > 0.4) { A.key = e > 0 ? plus : minus; A.t = 0.08; }
    };
    const s = ac().s, V = s.v.length();
    const tp = s.p.clone().addScaledVector(s.v, 600 / V), tv = s.v.clone();
    const gunB = new THREE.Vector3(0, 0.0262, -1).normalize(), qi = new THREE.Quaternion(), lb = new THREE.Vector3();
    const hist = []; let t = 0, n = 0, in1 = 0, in2 = 0, se = 0, flips = 0, lastKey = '';
    frames(60 * 16, () => {
      const dt = 1 / 60; t += dt;
      const w = 9.81 * Math.sqrt(gT * gT - 1) / V * (rev ? (Math.floor(t / rev) % 2 ? -1 : 1) : 1);
      tv.applyAxisAngle(new THREE.Vector3(0, 1, 0), -w * dt); tv.y = vz * Math.cos(t * 1.3); tv.setLength(V);
      tp.addScaledVector(tv, dt);
      // where the target sits relative to the gun cross, degrees right / up
      qi.copy(ac().s.q).invert(); lb.copy(tp).sub(ac().s.p).normalize().applyQuaternion(qi);
      const ex = Math.atan2(lb.x, -lb.z) / D2R, ey = Math.atan2(lb.y, -lb.z) / D2R - Math.atan2(gunB.y, -gunB.z) / D2R;
      hist.push([ex, ey]);
      // what the pilot saw 0.15 s ago, plus how fast it was drifting, looked 0.3 s ahead
      const at = (k) => hist[Math.max(0, hist.length - 1 - k)];
      const [ax, ay] = at(9), [bx, by] = at(15);
      const dx = ax + (ax - bx) / 0.1 * 0.3, dy = ay + (ay - by) / 0.1 * 0.3;
      I.keys.delete('KeyA'); I.keys.delete('KeyD'); I.keys.delete('KeyS'); I.keys.delete('KeyW');
      let kx, ky;
      if (pilot === 'hold') { kx = dx > 0.5 ? 'KeyD' : dx < -0.5 ? 'KeyA' : ''; ky = dy > 0.5 ? 'KeyS' : dy < -0.5 ? 'KeyW' : ''; }
      else { tapAxis(ax2.x, dx, 'KeyD', 'KeyA', dt); tapAxis(ax2.y, dy, 'KeyS', 'KeyW', dt); kx = ax2.x.key; ky = ax2.y.key; }
      if (kx) I.keys.add(kx); if (ky) I.keys.add(ky);
      const kk = kx + ky; if (kk !== lastKey) { flips++; lastKey = kk; }
      if (t > 4) { const e = Math.hypot(ex, ey); n++; se += e * e; if (e < 1) in1++; if (e < 2) in2++; }
      if (process.env.TRACE === `${label} ${pilot}` && Math.round(t * 60) % 6 === 0) console.log(`    t ${t.toFixed(1)} err ${fmt(ex, 1)} ${fmt(ey, 1)}  keys ${kk.replace(/Key/g, '') || '-'}  bank ${fmt(ac().rollDeg(), 0)}  G ${fmt(ac().nz, 1)}  aoa ${fmt(ac().alpha / D2R, 1)}  range ${fmt(tp.distanceTo(ac().s.p), 0)}`);
    });
    I.keys.clear();
    console.log(`  ${label.padEnd(18)} ${pilot.padEnd(4)}: within 1° ${fmt(100 * in1 / n, 0, 3)}%  within 2° ${fmt(100 * in2 / n, 0, 3)}%  RMS ${fmt(Math.sqrt(se / n), 2)}°  key changes ${flips}  range at the end ${fmt(tp.distanceTo(ac().s.p), 0)} m`);
  }
}
