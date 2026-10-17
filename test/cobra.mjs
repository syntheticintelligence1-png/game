import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const game = new Game({ appendChild() { } }, { scenario: 'air', loadout: 'air', hour: 9.5, weather: 'clear', quality: 'low', invulnerable: true });
await game.init(() => {});
game.opts.realistic = true; // these tests drive the stick directly
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
game.launch({ scenario: 'air', loadout: 'air', invulnerable: true });
const a = game.player.ac; const s = a.s;
I.updateAxes = () => {};
for (const [spd, pullT] of [[135, 1.6], [180, 1.2]]) {
  s.p.set(0, 3000, 30000); s.v.set(0, 0, -spd); s.q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 4 * Math.PI / 180); s.w.set(0, 0, 0);
  a.ctl.limiter = false; a.ctl.throttle = 0.8; a.rpm = 1; a.ab = 0;
  I.axes.pitch = 0; I.axes.roll = 0;
  for (let i = 0; i < 30; i++) { T += 1000 / 60; game.frame(T); }
  console.log(`--- Cobra entry ${spd} m/s (${(spd * 1.944) | 0} kt), pull ${pullT}s`);
  let maxA = 0, maxP = 0;
  for (let i = 0; i < 60 * 7; i++) {
    I.axes.pitch = i < pullT * 60 ? 1 : 0; I.axes.roll = 0;
    T += 1000 / 60; game.frame(T);
    maxA = Math.max(maxA, a.alpha * 57.3); maxP = Math.max(maxP, a.pitchDeg());
    if (i % 30 === 0) console.log(`  t=${(i / 60).toFixed(1)} aoa=${(a.alpha * 57.3).toFixed(0)} pitch=${a.pitchDeg().toFixed(0)} roll=${a.rollDeg().toFixed(0)} spd=${a.tas.toFixed(0)} alt=${s.p.y.toFixed(0)} nz=${a.nz.toFixed(1)}`);
  }
  console.log(`  max AoA ${maxA.toFixed(0)}  max pitch ${maxP.toFixed(0)}  final aoa ${(a.alpha * 57.3).toFixed(0)} roll ${a.rollDeg().toFixed(0)}`);
}
