// Missile-defence survivability: a pilot following the on-screen BREAK cue vs one doing nothing.
import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const game = new Game({ appendChild() { } }, { scenario: 'strike', loadout: 'strike', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const frames = (n, f) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); if (f && f(i)) return true; } return false; };
game.mission.onEnd = () => {};
const trial = (mode, threat) => {
  game.launch({ scenario: 'strike', loadout: 'strike', invulnerable: false }); game.opts.invulnerable = false;
  const P = game.player, ac = P.ac, s = ac.s;
  for (const j of game.aiJets) if (threat !== 'jet') j.alive = false; else j.pos.set(s.p.x, 6500, s.p.z - 28000);
  if (threat === 'sam') { const tgt = game.sams[0].track.pos; s.p.set(tgt.x + 3000, 5000, tgt.z + 19000); }
  if (threat === 'sa15') { const tgt = game.pointDef[0].e.pos; s.p.set(tgt.x + 1500, 2500, tgt.z + 10000); }
  if (threat === 'jet') { s.p.set(2500, 6000, 20000); }
  s.v.set(0, 0, -230); s.q.identity(); s.w.set(0, 0, 0); ac.ctl.throttle = 0.85;
  let launched = false, cmT = 0, t = 0, outcome = 'no launch';
  const keys = ['KeyA', 'KeyD', 'KeyS', 'KeyW'];
  frames(60 * 110, () => {
    t += 1 / 60; cmT -= 1 / 60;
    for (const k of keys) I.keys.delete(k);
    const th = game.threatInfo();
    if (th) launched = true;
    if (mode === 'defend' && th) {
      // follow the cue: break as told, keep the jet out of the ground, X whenever the cue says NOW
      const agl = s.p.y - Math.max(game.terrain.heightAt(s.p.x, s.p.z), 0), vs = s.v.y;
      if (th.turn < 0) I.keys.add('KeyA'); else if (th.turn > 0) I.keys.add('KeyD');
      if (agl < 1200 || vs < -60) I.keys.add('KeyS'); else if (th.radar && agl > 2500 && th.turn === 0 && vs > -40) I.keys.add('KeyW');
      if (th.cmNow && cmT <= 0) { I.keys.add('KeyX'); I.pressed.add('KeyX'); cmT = 0.7; }
    }
    if (!P.alive) { outcome = 'KILLED'; return true; }
    if (launched && !th && t > 5) { outcome = P.hp < 100 ? `survived, hp ${P.hp | 0}` : 'survived, untouched'; return true; }
    return false;
  });
  for (const k of keys) I.keys.delete(k); I.keys.delete('KeyX');
  if (outcome === 'no launch' && launched) outcome = 'survived, still evading';
  return outcome;
};
for (const threat of (process.env.ONLY ? [process.env.ONLY] : ["sam", "sa15", "jet"])) for (const mode of (process.env.MODE ? [process.env.MODE] : ["defend", "passive"])) {
  const res = []; for (let i = 0; i < 6; i++) res.push(trial(mode, threat));
  const alive = res.filter(r => r.startsWith('survived')).length, launched = res.filter(r => r !== 'no launch').length;
  console.log(`${threat.padEnd(5)} ${mode.padEnd(8)} survived ${alive}/${launched} launches | ${res.join(' · ')}`);
}
