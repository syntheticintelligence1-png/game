import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const game = new Game({ appendChild() { } }, { scenario: 'approach', loadout: 'air', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
game.opts.realistic = true; // these tests drive the stick directly
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
game.launch({ scenario: 'approach', loadout: 'air', weather: 'clear' });
const o = game.ops, sh = game.carrier;
let phase = 'approach', ix = 0, eng = null, tStop = null, peak = 0, startRel = 0;
I.updateAxes = () => {}; // drive axes directly
for (let i = 0; i < 60 * 80; i++) {
  const a = game.player.ac; const s = a.s;
  const vrel = s.v.clone().sub(sh.vel); const vs = vrel.y;
  if (!a.onGround && !o.wire) {
    const desVs = -3.7 - o.ball * 1.8;                         // fly the ball
    I.axes.pitch = THREE.MathUtils.clamp((desVs - vs) * 0.25, -0.6, 0.6);
    const tgt = THREE.MathUtils.clamp(0.45 + (a.alpha * 57.3 - 8.1) * 0.1 + (desVs - vs) * 0.04, 0.15, 0.79);
    a.ctl.throttle += THREE.MathUtils.clamp(tgt - a.ctl.throttle, -0.25 / 60, 0.25 / 60);
    const bankWant = THREE.MathUtils.clamp(-o.lineup * 8, -15, 15);
    I.axes.roll = THREE.MathUtils.clamp((bankWant - a.rollDeg()) * 0.06, -0.7, 0.7);
  } else { I.axes.pitch = 0; I.axes.roll = 0; if (o.wire) a.ctl.throttle = 0.79; }
  T += 1000 / 60; game.frame(T);
  if (o.wire) peak = Math.max(peak, -a.nz < 0 ? Math.abs(vrel.dot(sh.fwd)) : 0);
  if (i % 60 === 0 && !o.wire) console.log(`t=${game.time.toFixed(0)} rng=${o.rangeToTD | 0} ball=${o.ball.toFixed(2)} lu=${o.lineup.toFixed(2)} aoa=${(a.alpha * 57.3).toFixed(1)} vs=${vs.toFixed(1)} closure=${vrel.length().toFixed(1)} thr=${a.ctl.throttle.toFixed(2)} hookAng=${o.hookAngle.toFixed(2)}`);
  if (o.wire && !eng) { eng = { t: game.time, v: vrel.length(), wire: o.trap.wire }; startRel = s.p.clone(); console.log(`ENGAGED ${o.trap.wire}-wire at closure ${eng.v.toFixed(1)} m/s, touchdown vs ${vs.toFixed(1)}`); }
  if (eng && !tStop && vrel.length() < 0.6) { tStop = game.time; console.log(`STOPPED after ${(tStop - eng.t).toFixed(2)} s, rollout ${(s.p.distanceTo(startRel) - sh.vel.length() * (tStop - eng.t)).toFixed(0)} m (deck-relative approx), payout ${o.wirePayout.toFixed(1)} m, peak decel ${(a.maxG).toFixed(1)} g grade=${o.trap.grade}`); }
  if (a.crashed || !game.player.alive) { console.log('CRASH', a.crashed && a.crashed.kind, 'vs', vs.toFixed(1)); break; }
  if (tStop && game.time - tStop > 3) { console.log('messages:', game.msgs.map(m => m.text).join(' | ')); break; }
}
// decel profile check
