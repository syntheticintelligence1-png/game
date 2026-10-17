// Easy-controls handling check: bank/turn response, auto-level, taps, altitude hold in turns.
import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const game = new Game({ appendChild() { } }, { scenario: 'air', loadout: 'air', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const frames = (n, f) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); if (f) f(i); } };
const ac = () => game.player.ac;
const start = (realistic, spd = 154, alt = 3000) => {
  game.opts.realistic = realistic;
  game.launch({ scenario: 'air', loadout: 'air', invulnerable: true });
  const s = ac().s; s.p.set(0, alt, 30000); s.v.set(0, 0, -spd); s.q.identity(); s.w.set(0, 0, 0); ac().ctl.throttle = 0.8; ac().rpm = 0.9;
  for (const j of game.aiJets) j.alive = false;
  frames(60);
};
const hdg = () => ac().heading();
const report = (label, keys, holdS, after = 3) => {
  const h0 = hdg(), y0 = ac().s.p.y; let t30 = null, t60 = null, maxBank = 0, minY = y0, maxY = y0, maxG = 0, h05 = null, h10 = null;
  for (const k of keys) I.keys.add(k);
  let t = 0;
  frames(Math.round(holdS * 60), () => { t += 1 / 60; const b = Math.abs(ac().rollDeg()); maxBank = Math.max(maxBank, b); if (t30 == null && b >= 30) t30 = t; if (t60 == null && b >= 60) t60 = t; minY = Math.min(minY, ac().s.p.y); maxY = Math.max(maxY, ac().s.p.y); maxG = Math.max(maxG, ac().nz); if (h05 == null && t >= 0.5) h05 = ((hdg() - h0 + 540) % 360) - 180; if (h10 == null && t >= 1.0) h10 = ((hdg() - h0 + 540) % 360) - 180; });
  const dh = ((hdg() - h0 + 540) % 360) - 180, bankHeld = ac().rollDeg();
  for (const k of keys) I.keys.delete(k);
  let tLevel = null, over = 0; t = 0; const sgn = Math.sign(bankHeld) || 1;
  frames(Math.round(after * 60), () => { t += 1 / 60; const b = ac().rollDeg(); maxBank = Math.max(maxBank, Math.abs(b)); if (tLevel == null && Math.abs(b) < 3 && t > 0.1) tLevel = t; if (tLevel != null) over = Math.max(over, -sgn * b); });
  console.log(`${label.padEnd(30)} hold ${holdS}s: t30=${t30 == null ? '-' : t30.toFixed(2)} t60=${t60 == null ? '-' : t60.toFixed(2)} maxBank=${maxBank.toFixed(0)} hdg@0.5s=${h05 == null ? '-' : h05.toFixed(1)} @1s=${h10 == null ? '-' : h10.toFixed(1)} total=${dh.toFixed(0)}° alt ${(minY - y0).toFixed(0)}..+${(maxY - y0).toFixed(0)} m maxG=${maxG.toFixed(1)} | release: level after ${tLevel == null ? 'never' : tLevel.toFixed(2) + 's'} overshoot ${over.toFixed(1)}° final bank ${ac().rollDeg().toFixed(1)}`);
};
for (const realistic of [false, true]) {
  console.log(`=== ${realistic ? 'REALISTIC' : 'EASY'} controls @300 kt`);
  start(realistic); report('hold D (right turn)', ['KeyD'], 3);
  start(realistic); report('hold A 1.5 s', ['KeyA'], 1.5);
  start(realistic); report('tap D 0.1 s', ['KeyD'], 0.1, 2);
  start(realistic); report('tap D 0.25 s', ['KeyD'], 0.25, 2);
  start(realistic); report('hold D + S (hard turn)', ['KeyD', 'KeyS'], 3);
  start(realistic); { const p0 = ac().pitchDeg(); I.keys.add('KeyS'); frames(6); I.keys.delete('KeyS'); frames(60); console.log(`tap S 0.1 s: pitch change ${(ac().pitchDeg() - p0).toFixed(1)}°`); }
  start(realistic); { const p0 = ac().pitchDeg(); I.keys.add('KeyS'); frames(60); I.keys.delete('KeyS'); frames(30); console.log(`hold S 1 s: pitch change ${(ac().pitchDeg() - p0).toFixed(1)}°, g peak ${ac().maxG.toFixed(1)}`); }
}
console.log('=== EASY @200 kt (slow)'); start(false, 103, 2000); report('hold D', ['KeyD'], 3);
console.log('=== EASY @480 kt (fast)'); start(false, 247, 4000); report('hold D', ['KeyD'], 3);
