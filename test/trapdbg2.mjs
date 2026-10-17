import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const { DECK_Y } = await import('../src/models/carrier.js');
const game = new Game({ appendChild() { } }, { scenario: 'approach', loadout: 'air', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
game.opts.realistic = true; // these tests drive the stick directly
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const runs = +(process.argv[2] || 1);
for (let run = 0; run < runs; run++) {
  game.launch({ scenario: 'approach', loadout: 'air' });
  const o = game.ops; let tr = 0; let eng = null;
  const a0 = game.player.ac;
  const CP = [[0, 0, -9.5], [0, 0.4, 8.6], [-6.35, -0.25, 3.6], [6.35, -0.25, 3.6], [0, -1.15, -2.5], [0, -1.05, 2.5], [-2.1, 3.3, 6.5], [2.1, 3.3, 6.5], [0, 1.25, -4.8], [-0.56, -0.6, 8.6], [0.56, -0.6, 8.6]].map(a => new THREE.Vector3(...a));
  let out = '';
  for (let i = 0; i < 60 * 70; i++) {
    const a = game.player.ac;
    if (!a.onGround && !o.wire) {
      a.ctl.throttle = Math.min(0.79, Math.max(0.2, 0.62 + (a.alpha * 57.3 - 8.1) * 0.06 + (-o.ball) * 0.12 - (a.s.v.y - game.carrier.vel.y + 3.8) * 0.02));
      const pitchCmd = THREE.MathUtils.clamp(-o.ball * 0.6 - (a.s.v.y - game.carrier.vel.y + 3.6) * 0.15, -0.6, 0.6);
      I.axes.pitch = pitchCmd;
      const bankWant = THREE.MathUtils.clamp(-o.lineup * 6, -20, 20); I.axes.roll = THREE.MathUtils.clamp((bankWant - a.rollDeg()) * 0.05, -0.8, 0.8);
    } else { I.axes.pitch = 0; I.axes.roll = 0; a.ctl.throttle = o.wire ? 0 : a.ctl.throttle; }
    const save = { ...I.axes }; T += 1000 / 60; I.updateAxes = () => { I.axes.pitch = save.pitch; I.axes.roll = save.roll; I.axes.yaw = 0; };
    game.frame(T);
    if (o.wire && !eng) eng = i;
    if (eng !== null && (i - eng) % 3 === 0 && i - eng < 200) {
      const s = a.s; const deckY = game.carrier.root.position.y + DECK_Y;
      let worst = 9, wi = -1;
      CP.forEach((c, k) => { const p = c.clone().applyQuaternion(s.q).add(s.p); const h = p.y - deckY; if (h < worst) { worst = h; wi = k; } });
      const vrel = s.v.clone().sub(game.carrier.vel);
      out += `dt=${((i - eng) / 60).toFixed(2)} v=${vrel.length().toFixed(1)} vs=${vrel.y.toFixed(1)} pitch=${a.pitchDeg().toFixed(1)} roll=${a.rollDeg().toFixed(1)} q=${(s.w.x*57.3).toFixed(0)} lowCP#${wi}=${worst.toFixed(2)} wow=${a.wow.map(w => (w / 1000) | 0).join('/')} nz=${a.nz.toFixed(1)} payout=${(o.wirePayout||0).toFixed(0)}\n`;
    }
    if (a.crashed || !game.player.alive) { out += 'CRASH ' + JSON.stringify(a.crashed && { k: a.crashed.kind, sp: a.crashed.speed.toFixed(1), p: a.crashed.point.toArray().map(v => v.toFixed(1)) }) + '\n'; break; }
    if (o.trap && o.trap.done) { out += `STOPPED payout=${o.wirePayout.toFixed(1)} maxG=${a.maxG.toFixed(2)}\n`; break; }
  }
  console.log(`--- run ${run}\n` + out.split('\n').slice(-40).join('\n'));
}
