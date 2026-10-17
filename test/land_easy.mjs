// Carrier landing with the default easy controls, flown the way a beginner would: hands off, or with
// occasional key presses. Prints the approach every second and how it ended (wire / bolter / crash).
//   node test/land_easy.mjs            hands-off approach from the LANDING scenario start
//   node test/land_easy.mjs offsets    a grid of start offsets (high / low / left / right / fast / slow)
//   node test/land_easy.mjs offsets 3  just that one, printing every second
//   node test/land_easy.mjs mash       a "nervous beginner" who keeps tapping keys the whole way down
//   node test/land_easy.mjs mash 4     the same runs, printing every second of run 4 (and stopping there)
//   node test/land_easy.mjs return     coming back to the ship from free flight (downwind, ahead, beside, high and fast):
//                                      gear down, then follow the green circle (never touching the throttle)
//   node test/land_easy.mjs bolter     hook raised late: bolter, climb-out, then the green circle back round to a trap
// TRACE=t prints every frame after t seconds.
import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const { LANDING } = await import('../src/models/carrier.js');
const game = new Game({ appendChild() { } }, { scenario: 'approach', loadout: 'air', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
game.mission.onEnd = () => {};
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const mode = process.argv[2] || 'handsoff', only = process.argv[3] != null ? +process.argv[3] : null;
let quiet = mode !== 'handsoff' && only == null;
const TRACE = process.env.TRACE ? +process.env.TRACE : Infinity; // TRACE=240: print every frame after t = 240 s

// goAround: keep flying after a bolter / wave-off climb-out (for pilots that come back round for another try)
function fly(label, setup, pilot, maxT = 120, goAround = false) {
  game.launch({ scenario: 'approach', loadout: 'air', weather: 'clear', realistic: false });
  game.opts.realistic = false;
  I.keys.clear(); I.pressed.clear();
  const o = game.ops, sh = game.carrier, P = game.player, ac = P.ac;
  // after moving the jet, refresh the landing geometry the assist reads (it is otherwise updated after the next step)
  if (setup) { setup(ac, sh); o.updateLens(ac); }
  let res = 'TIMEOUT', maxSink = 0, maxBank = 0, tdV = null, onDeckT = null, boltered = false, at300 = '', at100 = '', climbWhy = null, captured = '';
  const t0 = game.time, events = [];
  let lastState = game.landAssist.state;
  for (let i = 0; i < 60 * maxT; i++) {
    const s = ac.s, vrel = s.v.clone().sub(sh.vel);
    if (pilot) pilot(i, ac, o);
    if (game.landAssist.state !== lastState) { lastState = game.landAssist.state; events.push(`${(game.time - t0).toFixed(0)} s ${lastState}${game.landAssist.why ? ` (${game.landAssist.why})` : ''}`); }
    if (!captured && game.landAssist.state === 'approach') captured = `captured after ${(game.time - t0).toFixed(0)} s at ${o.rangeToTD.toFixed(0)} m out, ${o.latErr.toFixed(0)} m right, ${o.glideErr.toFixed(0)} m high, ${(ac.ias() * 1.944).toFixed(0)} kt`;
    const r0 = o.rangeToTD;
    T += 1000 / 60; game.frame(T);
    const gap = () => `high ${o.glideErr.toFixed(1)} m, right ${o.latErr.toFixed(1)} m, aoa ${(ac.alpha / Math.PI * 180).toFixed(1)}`;
    if (r0 > 300 && o.rangeToTD <= 300) at300 = gap();
    if (r0 > 100 && o.rangeToTD <= 100) at100 = gap();
    if (!ac.onGround) { maxSink = Math.max(maxSink, -vrel.y); if (o.rangeToTD < 400 && o.rangeToTD > 0 && game.landAssist.state === 'approach') maxBank = Math.max(maxBank, Math.abs(ac.rollDeg())); }
    if (ac.onGround && tdV === null) { tdV = -vrel.y; onDeckT = game.time; }
    if (!quiet && (i % 60 === 0 || game.time > TRACE)) console.log(`  t=${game.time.toFixed(0).padStart(3)} rng=${String(o.rangeToTD | 0).padStart(5)} ball=${o.ball.toFixed(2).padStart(5)} lu=${o.lineup.toFixed(2).padStart(6)} aoa=${(ac.alpha * 57.3).toFixed(1)} ias=${(ac.ias() * 1.944).toFixed(0)}kt vs=${vrel.y.toFixed(1)} bank=${ac.rollDeg().toFixed(1)} thr=${ac.ctl.throttle.toFixed(2)} ${ac.onGround ? 'DECK' : ''}${o.wire ? ` WIRE ${o.wireState} payout ${(o.wirePayout || 0).toFixed(0)}` : ''} ${game.landAssist.state} ${game.landAssist.state === 'off' ? (game.landAssist.joinHint(game) || {}).text || '' : ''}`);
    if (o.bolterT != null) boltered = true;
    const LA = game.landAssist;
    if (LA.state === 'climb') climbWhy = LA.why;
    else if (climbWhy && LA.state === 'off' && !goAround) { res = `${climbWhy.toUpperCase()}, climbed away (${(s.p.y | 0)} m)`; break; }
    if (!P.alive || ac.crashed) {
      const by = P.lastHitBy; // a missile / gun round (with .shooter) or an entity
      res = ac.crashed ? `CRASH (${ac.crashed.kind})` : `SHOT DOWN by ${by ? (by.shooter ? `${by.shooter.name || by.shooter.kind} (${by.kind || by.def?.name || 'weapon'})` : by.name || by.kind || '?') : '?'}`;
      if (!quiet && ac.crashed) {
        const loc = ac.crashed.point.clone().sub(s.p).applyQuaternion(s.q.clone().invert());
        console.log(`  crash: part at jet-local (${loc.x.toFixed(1)}, ${loc.y.toFixed(1)}, ${loc.z.toFixed(1)}) speed ${ac.crashed.speed.toFixed(1)} m/s, rng ${o.rangeToTD.toFixed(0)}, right ${o.latErr.toFixed(1)} m, bank ${ac.rollDeg().toFixed(1)}, pitch ${ac.pitchDeg().toFixed(1)}, onGround ${ac.onGround}, wire ${!!o.wire}, assist ${game.landAssist.state}`);
      }
      break;
    }
    if (o.trap && o.trap.done) { res = `TRAP wire ${o.trap.wire} grade ${o.trap.grade}`; for (let k = 0; k < 240; k++) { T += 1000 / 60; game.frame(T); if (!P.alive) { res += ' THEN CRASH'; break; } } break; }
    if (boltered && !goAround && !ac.onGround && s.p.y > sh.root.position.y + 19.5 + 120) { res = 'BOLTER, climbed away safely'; break; }
  }
  console.log(`${label.padEnd(26)} ${res.padEnd(34)} touchdown sink ${tdV != null ? tdV.toFixed(1) : '-'} m/s, max sink ${maxSink.toFixed(1)}, max bank near deck ${maxBank.toFixed(0)}°`);
  console.log(`${''.padEnd(26)} at 300 m: ${at300 || '-'} | at 100 m: ${at100 || '-'}`);
  if (mode === 'return') console.log(`${''.padEnd(26)} ${captured || 'never captured'}`);
  if (goAround) console.log(`${''.padEnd(26)} assist: ${events.join(' → ')}`);
  return res;
}

// a beginner flying the green circle with the assist off: steers for it (keeps it in front, aims the flight path at
// it), does what the line at the top of the screen says (turn, climb or descend), never touches the throttle, and
// lets go once the landing assist has taken over
const D2R = Math.PI / 180;
function circlePilot(i, ac) {
  const LA = game.landAssist, want = new Set();
  if (LA.state === 'off' && LA.inPattern(game)) {
    const h = LA.joinHint(game), jp = LA.joinPoint(game, new THREE.Vector3()), f = ac.forward(new THREE.Vector3());
    let brg = (Math.atan2(jp.x - ac.s.p.x, -(jp.z - ac.s.p.z)) - Math.atan2(f.x, -f.z)) / D2R; brg = ((brg % 360) + 540) % 360 - 180;
    const vh = Math.hypot(ac.s.v.x, ac.s.v.z), fpa = Math.atan2(ac.s.v.y, vh) / D2R;
    const el = Math.atan2(jp.y - ac.s.p.y, Math.hypot(jp.x - ac.s.p.x, jp.z - ac.s.p.z)) / D2R;
    const turnDir = Math.abs(brg) > 3 ? Math.sign(brg) : 0;
    // far from the circle, just get to its height; close to it (or on the landing line), aim the flight path at it
    let vert = LA.leg === 'final' ? (Math.abs(el - fpa) > 0.7 ? Math.sign(el - fpa) : 0) : Math.abs(jp.y - ac.s.p.y) > 25 ? Math.sign(jp.y - ac.s.p.y) : 0;
    if (h && h.text.startsWith('Too high')) vert = -1; else if (h && h.text.startsWith('Too low')) vert = 1;
    if (turnDir) want.add(turnDir > 0 ? 'KeyD' : 'KeyA');
    if (vert > 0 && ac.s.v.y < 4) want.add('KeyS'); if (vert < 0 && ac.s.v.y > -6) want.add('KeyW');
    if (!quiet && i % 60 === 0) console.log(`    leg ${LA.leg} side ${LA.side} brg ${brg.toFixed(0)} el ${el.toFixed(1)} fpa ${fpa.toFixed(1)} dist ${(jp.distanceTo(ac.s.p) / 1000).toFixed(1)} km  x ${game.ops.rangeToTD.toFixed(0)} y ${game.ops.latErr.toFixed(0)} alt ${ac.s.p.y.toFixed(0)}`);
  }
  for (const k of [...I.keys]) if (!want.has(k)) I.keys.delete(k);
  for (const k of want) if (!I.keys.has(k)) { I.keys.add(k); I.pressed.add(k); }
}

const nudge = (dx, dy, dz) => (ac, sh) => {
  const dir = new THREE.Vector3(LANDING.dir.x, 0, LANDING.dir.y).applyQuaternion(sh.quat).normalize();
  const perp = new THREE.Vector3(LANDING.perp.x, 0, LANDING.perp.y).applyQuaternion(sh.quat).normalize();
  ac.s.p.addScaledVector(perp, dx).add(new THREE.Vector3(0, dy, 0)).addScaledVector(dir, dz);
};
// turn the jet (attitude and velocity) by deg about the vertical: + = to the left
const turn = (ac, deg) => {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg * Math.PI / 180);
  ac.s.q.premultiply(q); ac.s.v.applyQuaternion(q);
};

if (mode === 'handsoff') fly('hands off', null, null);
else if (mode === 'offsets') {
  const cases = [
    ['hands off', null], ['60 m high', nudge(0, 60, 0)], ['40 m low', nudge(0, -40, 0)], ['150 m left', nudge(-150, 0, 0)], ['150 m right', nudge(150, 0, 0)],
    ['300 m left + 50 high', nudge(-300, 50, 0)], ['1 km closer', nudge(0, -55, 1000)], ['10 kt fast', (ac, sh) => ac.s.v.addScaledVector(ac.s.v.clone().sub(sh.vel).normalize(), 5)],
    ['10 kt slow', (ac, sh) => ac.s.v.addScaledVector(ac.s.v.clone().sub(sh.vel).normalize(), -5)],
    ['5.6 km out, 150 m high', nudge(0, 150 + 3000 * Math.tan(3.5 * Math.PI / 180), -3000)],
    ['600 m left, cutting in 25°', (ac, sh) => { nudge(-600, 0, 0)(ac, sh); turn(ac, -25); }],
  ];
  cases.forEach(([l, f], k) => { if (only == null || only === k) fly(l, f, null); });
} else if (mode === 'mash') {
  // a nervous pilot: random taps on A/D/W/S and the throttle every second or so
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // the key sequence of each run depends on how long the runs before it lasted, so `mash N` replays runs 0..N
  for (let run = 0; run < (only != null ? only + 1 : 6); run++) {
    quiet = only !== run;
    let key = null, until = 0;
    fly(`mash run ${run}`, null, (i) => {
      if (i >= until) {
        if (key) I.keys.delete(key);
        key = rnd() < 0.55 ? ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ShiftLeft', 'ControlLeft'][Math.floor(rnd() * 6)] : null;
        if (key) { I.keys.add(key); I.pressed.add(key); }
        until = i + 10 + Math.floor(rnd() * 50);
        if (!quiet && key) console.log(`    key ${key} for ${until - i} frames`);
      }
    });
    I.keys.clear();
  }
} else if (mode === 'return') {
  // coming back to the ship from free flight: gear down, then fly the green circle (circlePilot)
  // start `back` m behind the touchdown point and `right` m to the side of the landing line, heading `hdg`° right
  // of the landing direction (180 = flying the opposite way, downwind)
  const place = (back, right, alt, hdg, kt) => (ac, sh) => {
    const dirW = new THREE.Vector3(LANDING.dir.x, 0, LANDING.dir.y).applyQuaternion(sh.quat).normalize();
    const perpW = new THREE.Vector3(LANDING.perp.x, 0, LANDING.perp.y).applyQuaternion(sh.quat).normalize();
    const p = game.approachPoint(back).addScaledVector(perpW, right); p.y = alt;
    const h = dirW.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -hdg * D2R);
    ac.reset(p, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), h), h.multiplyScalar(kt / 1.944));
    // gear and hook up, cruise power: the pilot lowers the gear on the first frame (that is what arms the guidance)
    ac.ctl.hookCmd = 0; game.ops.hookAngle = 0; ac.ctl.throttle = 0.6; ac.ctl.gearCmd = 0; ac.gear = 0;
  };
  const cases = [
    ['downwind, 2 km abeam', place(-1000, -2000, 300, 180, 220)],
    ['ahead of the ship, away', place(-6000, 0, 450, 0, 260)],
    ['from the side, 6 km', place(4000, 6000, 300, -90, 230)],
    ['high and fast, 12 km', place(12000, -1500, 1200, 10, 300)],
  ];
  const pilot = (i, ac) => { if (i === 0) I.pressed.add('KeyG'); else circlePilot(i, ac); };
  cases.forEach(([l, f], k) => { if (only == null || only === k) fly(l, f, pilot, 400); });
} else if (mode === 'bolter') {
  // the hook goes up late in an assisted approach (H), so the jet bolters: the assist climbs away, then the pilot
  // flies the green circle back round, and on the second approach the assist lowers the hook again
  let raised = false;
  fly('bolter, then round again', null, (i, ac, o) => {
    if (!raised && game.landAssist.state === 'approach' && o.rangeToTD < 400) { raised = true; I.pressed.add('KeyH'); return; }
    circlePilot(i, ac);
  }, 400, true);
}
