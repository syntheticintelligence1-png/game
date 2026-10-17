import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const { LANDING, DECK_Y } = await import('../src/models/carrier.js');
const game = new Game({ appendChild() { } }, { scenario: 'approach', loadout: 'air', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
game.opts.realistic = true; // these tests drive the stick directly
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
game.launch({ scenario: 'approach', loadout: 'air', weather: 'clear' });
const o = game.ops, sh = game.carrier;
I.updateAxes = () => {};
// start 450 m out on centerline and glidepath
{
  const { landingPoint } = await import('../src/models/carrier.js');
  const ac = game.player.ac; const T0 = landingPoint(LANDING.targetS); const back = 450;
  const dirL = new THREE.Vector3(LANDING.dir.x, 0, LANDING.dir.y);
  const local = new THREE.Vector3(T0.x, DECK_Y, T0.y).addScaledVector(dirL, -back); local.y += back * Math.tan(3.5 * Math.PI / 180) + 3.6;
  const p = sh.toWorld(local); const fw = dirL.clone().applyQuaternion(sh.quat).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), fw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 4.5 * Math.PI / 180));
  ac.reset(p, q, fw.clone().multiplyScalar(66).add(sh.vel).add(new THREE.Vector3(0, -3.9, 0)));
  ac.ctl.throttle = 0.42; ac.rpm = 0.86;
}
const along = (p) => (p.x - LANDING.ramp.x) * LANDING.dir.x + (p.z - LANDING.ramp.y) * LANDING.dir.y;
const lat = (p) => (p.x - LANDING.ramp.x) * LANDING.perp.x + (p.z - LANDING.ramp.y) * LANDING.perp.y;
for (let i = 0; i < 60 * 60; i++) {
  const a = game.player.ac; const vrel = a.s.v.clone().sub(sh.vel); const vs = vrel.y;
  if (!a.onGround && !o.wire) {
    const desVs = -3.7 - o.ball * 1.8;
    I.axes.pitch = THREE.MathUtils.clamp((desVs - vs) * 0.25, -0.6, 0.6);
    const tgt = THREE.MathUtils.clamp(0.45 + (a.alpha * 57.3 - 8.1) * 0.1 + (desVs - vs) * 0.04, 0.15, 0.79);
    a.ctl.throttle += THREE.MathUtils.clamp(tgt - a.ctl.throttle, -0.25 / 60, 0.25 / 60);
    // lineup on the landing area centerline using lateral position (not angle) near the deck
    const tip = o.hookTipLocal; const latErr = lat(tip);
    const bankWant = THREE.MathUtils.clamp(-latErr * 0.5 - o.lineup * 2, -12, 12);
    I.axes.roll = THREE.MathUtils.clamp((bankWant - a.rollDeg()) * 0.06, -0.7, 0.7);
  } else { I.axes.pitch = 0; I.axes.roll = 0; a.ctl.throttle = 0.79; }
  T += 1000 / 60; game.frame(T);
  const tip = o.hookTipLocal;
  const s = along(tip);
  if (s > 40 && s < 190 && i % 6 === 0) console.log(`s=${s.toFixed(1)} lat=${lat(tip).toFixed(1)} tipH=${(tip.y - DECK_Y).toFixed(2)} hook=${o.hookAngle.toFixed(2)} gnd=${a.onGround} wow=${a.wow.map(w => (w / 1000) | 0).join('/')} wire=${o.wire ? o.trap.wire : '-'} vs=${vs.toFixed(1)}`);
  if (o.wire && o.wireState !== 'arresting') { console.log('STOPPED, payout', o.wirePayout.toFixed(1), 'maxG', a.maxG.toFixed(2), o.trap.grade); break; }
  if (a.crashed || s > 200) { console.log('end', a.crashed && a.crashed.kind, 's', s.toFixed(0)); break; }
}
