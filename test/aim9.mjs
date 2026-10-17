import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const game = new Game({ appendChild() { } }, { scenario: 'air', loadout: 'multirole', hour: 9.5, weather: 'clear', quality: 'low', invulnerable: true });
await game.init(() => {});
game.opts.realistic = true; // these tests drive the stick directly
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const frames = (n) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); } };
const press = (c) => { I.pressed.add(c); I.keys.add(c); frames(1); I.keys.delete(c); };
game.launch({ scenario: 'air', loadout: 'multirole', invulnerable: true, weather: 'clear' });
frames(10);
for (const flares of [false, true]) {
  const tgt = game.aiJets.find(j => j.alive);
  // reset target: straight & level, patrol, far from threats
  tgt.state = 'patrol'; tgt.threat = null; tgt.pos.set(0, 5000, 20000); tgt.vel.set(0, 0, -240); tgt.up.set(0, 1, 0); tgt.flares = flares ? 30 : 0;
  const s = game.player.ac.s; s.p.set(0, 5000, 22800); s.v.set(0, 0, -250); s.q.identity(); s.w.set(0, 0, 0);
  game.player.radar.stt = null; game.player.seeker9.lock = null; press('Digit1'); frames(30);
  console.log(`--- 9X vs target (flares ${flares}) lock=${game.player.seeker9.lock && game.player.seeker9.lock.name} tgtIR=${tgt.irIntensity(s.p).toFixed(2)}`);
  press('Space'); const m = game.lastMissile;
  for (let i = 0; i < 80 && !m.dead; i++) { frames(6); if (i % 4 === 0) console.log(`  t=${m.t.toFixed(1)} spd=${m.vel.length() | 0} R=${m.pos.distanceTo(tgt.pos).toFixed(0)} track=${m.track === tgt ? 'TARGET' : m.track && m.track.isFlare ? 'FLARE' : m.track ? 'other' : 'none'} sig=${m.signal.toFixed(2)} aCmd=${(m.aCmd.length() / 9.81).toFixed(1)}g tgtState=${tgt.state} tgtFlares=${tgt.flares}`); }
  console.log(`  result: ${m.reason} target hp=${tgt.hp} alive=${tgt.alive}`);
  if (!tgt.alive) break;
}
