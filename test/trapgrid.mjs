// Arrested-landing robustness grid: touchdown with lateral offset / heading error / sink rate variations
import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const { LANDING, DECK_Y } = await import('../src/models/carrier.js');
const { JET_GEOM } = await import('../src/models/fighter.js');
const game = new Game({ appendChild() { } }, { scenario: 'approach', loadout: 'air', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
game.opts.realistic = true; // these tests drive the stick directly
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
I.updateAxes = () => { I.axes.pitch = 0; I.axes.roll = 0; I.axes.yaw = 0; };
const cases = [];
for (const e of [0, -2, 2, -4, 4]) for (const psi of [0, -2.5, 2.5]) cases.push({ e, psi, vs: 3.6, v: 68 });
cases.push({ e: 0, psi: 0, vs: 6.0, v: 68 }, { e: 0, psi: 0, vs: 3.6, v: 76 }, { e: 3, psi: -3, vs: 4.5, v: 72 }, { e: 0, psi: 0, vs: 3.6, v: 62 }, { e: -7, psi: 0, vs: 3.6, v: 68 }, { e: 7, psi: 4, vs: 3.6, v: 68 });
if (process.env.CALM) game.carrier.motionScale = 0;
// warm-up so every case starts from an identical, moving-ship state
game.launch({ scenario: 'approach', loadout: 'air', weather: 'clear' }); for (let i = 0; i < 30; i++) { T += 1000 / 60; game.frame(T); }
const only = process.argv[2] ? cases.slice(+process.argv[2], +process.argv[2] + 1) : cases;
for (const c of only) {
  game.launch({ scenario: 'approach', loadout: 'air', weather: 'clear' });
  const sh = game.carrier, o = game.ops, ac = game.player.ac;
  ac.ctl.hookCmd = 1; o.hookAngle = 1.12; ac.gear = 1; ac.ctl.gearCmd = 1;
  const dirL = new THREE.Vector3(LANDING.dir.x, 0, LANDING.dir.y), perp = new THREE.Vector3(LANDING.perp.x, 0, LANDING.perp.y);
  const sTip = -60, hTip = (70 - -60) * c.vs / c.v; // on a glide path that puts the hook down at s~70 (between 2 and 3 wire)
  // e / psi are the lineup error and heading error AT touchdown (s~70): back-propagate the start point along the crabbed track
  const tipLocal = new THREE.Vector3(LANDING.ramp.x, DECK_Y + hTip, LANDING.ramp.y).addScaledVector(dirL, sTip).addScaledVector(perp, c.e + 130 * Math.sin(c.psi * Math.PI / 180));
  const tipW = sh.toWorld(tipLocal.clone());
  const hdg = dirL.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -c.psi * Math.PI / 180).applyQuaternion(sh.quat).normalize();
  const gamma = Math.atan2(c.vs, c.v), pitch = 8.1 * Math.PI / 180 - gamma;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), hdg).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
  const pv = JET_GEOM.hookPivot, L = JET_GEOM.hookLen, a = 1.12;
  const tipB = new THREE.Vector3(pv.x, pv.y - Math.sin(a) * L, pv.z + Math.cos(a) * L);
  const p = tipW.clone().sub(tipB.clone().applyQuaternion(q));
  const v = hdg.clone().multiplyScalar(c.v).add(sh.vel).add(new THREE.Vector3(0, -c.vs, 0));
  ac.reset(p, q, v); ac.ctl.throttle = 0.45; ac.rpm = 0.86; ac.gear = 1; ac.ctl.hookCmd = 1; o.hookAngle = 1.12; o.prevTipLocal = null; ac.maxG = 0;
  let eng = null, maxRoll = 0, minClear = 9, latMax = 0, res = 'NO WIRE', engV = 0, yawMax = 0;
  let prevV = 0;
  for (let i = 0; i < 60 * 8; i++) {
    const vrel = ac.s.v.clone().sub(sh.vel);
    if (ac.onGround || o.wire) ac.ctl.throttle = 0.79;
    T += 1000 / 60; game.frame(T);
    if (o.wire && eng === null) { eng = i; engV = prevV; }
    prevV = ac.s.v.clone().sub(sh.vel).length();
    if (eng !== null) {
      maxRoll = Math.max(maxRoll, Math.abs(ac.rollDeg()));
      const tl = o.hookTipLocal; const lat = (tl.x - LANDING.ramp.x) * LANDING.perp.x + (tl.z - LANDING.ramp.y) * LANDING.perp.y; latMax = Math.max(latMax, Math.abs(lat));
      const f = ac.forward(new THREE.Vector3()); const fl = f.applyQuaternion(sh.quat.clone().invert());
      const yawErr = Math.atan2(fl.x * LANDING.dir.y - fl.z * LANDING.dir.x, fl.x * LANDING.dir.x + fl.z * LANDING.dir.y) * 57.3; yawMax = Math.max(yawMax, Math.abs(yawErr));
    }
    const fl0 = ac.forward(new THREE.Vector3()).applyQuaternion(sh.quat.clone().invert()); const yawE = Math.atan2(fl0.x * LANDING.dir.y - fl0.z * LANDING.dir.x, fl0.x * LANDING.dir.x + fl0.z * LANDING.dir.y) * 57.3;
    if (process.env.TRACE && (eng !== null || ac.onGround || o.hookTipLocal.y < DECK_Y + 0.5) && i % 3 === 0) console.log(`  t=${((i - (eng ?? i)) / 60).toFixed(2)} yawE=${yawE.toFixed(1)} wire=${o.wire ? 1 : 0} vrel=${ac.s.v.clone().sub(sh.vel).length().toFixed(1)} payout=${(o.wirePayout || 0).toFixed(1)} state=${o.wireState} roll=${ac.rollDeg().toFixed(1)} pitch=${ac.pitchDeg().toFixed(1)} wow=${ac.wow.map(w => (w / 1000) | 0).join('/')} nz=${ac.nz.toFixed(2)} hook=${o.hookAngle.toFixed(2)} lat=${((o.dbgLat || 0) / 1000).toFixed(0)}k tyres=${(ac.dbgT || []).map(t => t ? (t[0] / 1000).toFixed(0) + 'k@' + t[1].toFixed(1) : '-').join(' ')} p=${(-ac.s.w.z * 57.3).toFixed(0)} r=${(-ac.s.w.y * 57.3).toFixed(0)} beta=${(ac.beta * 57.3).toFixed(1)} da=${ac.da.toFixed(2)} dr=${ac.dr.toFixed(2)}`);
    if (ac.crashed || !game.player.alive) { res = 'CRASH ' + (ac.crashed && ac.crashed.kind); break; }
    if (o.trap && o.trap.done) { res = `STOP w${o.trap.wire} t=${((i - eng) / 60).toFixed(2)}s payout=${o.wirePayout.toFixed(0)}`; break; }
    if (!o.wire && i > 120 && !ac.onGround && eng === null && ac.s.p.y > sh.root.position.y + DECK_Y + 8) { res = 'BOLTER'; break; }
  }
  console.log(`e=${String(c.e).padStart(2)} psi=${String(c.psi).padStart(2)} vs=${c.vs} v=${c.v} | ${res.padEnd(30)} engV=${engV.toFixed(1)} peakG=${ac.maxG.toFixed(2)} maxRoll=${maxRoll.toFixed(1)} maxYawErr=${yawMax.toFixed(1)} maxLat=${latMax.toFixed(1)}`);
}
