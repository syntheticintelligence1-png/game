import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const game = new Game({ appendChild() { } }, { scenario: 'strike', loadout: 'strike', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const frames = (n, f) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); if (f && f(i)) return true; } return false; };
const press = (code) => { I.keys.add(code); I.pressed.add(code); frames(1); I.keys.delete(code); frames(1); };
game.mission.onEnd = () => {};
const P = () => game.player, ac = () => game.player.ac;
const fly = (pos, hdg, spd = 240) => { const s = ac().s; s.p.copy(pos); const h = hdg * Math.PI / 180; s.v.set(Math.sin(h) * spd, 0, -Math.cos(h) * spd); s.q.setFromEuler(new THREE.Euler(0, -h, 0)); s.w.set(0, 0, 0); ac().ctl.throttle = 0.85; };
const bearingTo = (p) => Math.atan2(p.x - ac().s.p.x, -(p.z - ac().s.p.z)) * 180 / Math.PI;
// 1) glide reach from 6 km altitude at 240 m/s
game.launch({ scenario: 'strike', loadout: 'strike', invulnerable: true }); game.opts.invulnerable = true;
for (const e of game.aiJets) e.alive = false;
const M = game.mission; const tgt = M.launchers[0];
for (const dist of [12000, 18000, 24000, 30000]) {
  game.launch({ scenario: 'strike', loadout: 'strike', invulnerable: true }); for (const e of game.aiJets) e.alive = false;
  const t = game.mission.launchers[0];
  fly(new THREE.Vector3(t.pos.x, 6000, t.pos.z + dist), 0); frames(2);
  P().tgp.target = t; P().sel = 'gbu39';
  const L = P().jdamLAR(t.pos, 'gbu39');
  P().releaseSelected(); const b = game.lastMissile;
  frames(60 * 200, () => b.dead);
  const miss = Math.hypot(b.pos.x - t.pos.x, b.pos.z - t.pos.z);
  console.log(`release ${dist / 1000} km (LAR max ${(L.rMax / 1000).toFixed(1)}): ${b.reason} miss ${miss.toFixed(0)} m, target alive ${t.alive}`);
}
// 2) T picks the ground target nearest the nose and readies a weapon
game.launch({ scenario: 'strike', loadout: 'strike', invulnerable: true }); game.opts.invulnerable = true; for (const e of game.aiJets) e.alive = false;
const M2 = game.mission; const ew = M2.defenses[0];
fly(new THREE.Vector3(ew.pos.x + 300, 6000, ew.pos.z + 22000), 0); frames(2);
{ const s = ac().s; const h = bearingTo(ew.pos); fly(s.p.clone(), h); }
console.log('sel before T:', P().sel); press('KeyT'); console.log('after T: marked', P().tgp.target && (P().tgp.target.tag || P().tgp.target.name), '| sel', P().sel, '|', game.msgs.map(m => m.text).slice(-1)[0]);
press('KeyT'); console.log('T again: marked', P().tgp.target && (P().tgp.target.tag || P().tgp.target.name));
// 3) ripple: fly at the city and keep pressing Space when in range
game.launch({ scenario: 'strike', loadout: 'strike', invulnerable: true }); game.opts.invulnerable = true; for (const e of game.aiJets) e.alive = false;
const M3 = game.mission; const c = M3.defenses[4].pos;
fly(new THREE.Vector3(c.x, 6500, c.z + 26000), 0); frames(2);
{ const h = bearingTo(c); fly(ac().s.p.clone(), h); }
press('KeyT'); let rel = 0; const t0 = game.time;
frames(60 * 160, () => {
  const s = ac().s; // keep flying toward the city, level
  if (P().sel === 'gbu39' && P().tgp.target && P().tgp.target.alive && P().jdamLAR(P().tgp.target.pos, 'gbu39').inRange && P().count('gbu39')) { press('Space'); rel++; }
  if (!P().tgp.target || !P().tgp.target.alive) { if (P().count('gbu39')) { const h = bearingTo(c); const s2 = ac().s; fly(s2.p.clone(), h, s2.v.length()); press('KeyT'); } }
  return P().count('gbu39') === 0 && !game.world.missiles.some(m => !m.dead && m.key === 'gbu39');
});
console.log(`ripple: released ${8 - P().count('gbu39')} small bombs in ${(game.time - t0).toFixed(0)} s | defenses left ${M3.defensesLeft}/${M3.defensesTotal} | launchers left ${M3.launchers.filter(l => l.alive).length}/4 | kills ${game.kills}`);
// 4) T on a jet readies the radar missile
game.launch({ scenario: 'strike', loadout: 'strike', invulnerable: true });
const j = game.aiJets[0]; fly(new THREE.Vector3(j.pos.x, j.pos.y, j.pos.z + 20000), 0); frames(2); { const h = bearingTo(j.pos); fly(ac().s.p.clone(), h); }
P().sel = 'gbu39'; press('KeyT'); console.log('jet ahead, T: radar lock', P().radar.stt && P().radar.stt.name, '| sel', P().sel);
