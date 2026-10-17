import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const game = new Game({ appendChild() { } }, { scenario: 'air', loadout: 'air', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
let T = 0; game.last = 0; game.acc = 0;
const frames = (n) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); } };
let rep = null; game.mission.onEnd = (r) => { rep = r; };
for (const practice of [true, false]) {
  game.launch({ scenario: 'strike', loadout: 'strike', invulnerable: practice }); game.opts.invulnerable = practice; frames(5);
  const s = game.player.ac.s; s.p.set(0, 300, 20000); s.v.set(0, -120, -150); s.q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.6);
  let t = 0; while (game.player.alive && t < 20) { frames(6); t += 0.1; }
  console.log(`practice=${practice}: died after ${t.toFixed(1)} s | crater/fires: ${game.fx.emitters.length} | msg: ${game.msgs.map(m => m.text).slice(-1)}`);
  frames(60 * 5);
  console.log(`   5 s later: alive=${game.player.alive} visible=${game.player.root.visible} | debrief=${rep ? rep.headline : 'none'}`); rep = null;
}
// shot down in the air -> falling wreck
game.launch({ scenario: 'strike', loadout: 'strike', invulnerable: false }); game.opts.invulnerable = false; frames(5);
const s = game.player.ac.s; s.p.set(0, 3000, 20000); s.v.set(0, 0, -200);
game.player.damage(500, null); frames(2);
console.log('shot down: wreck falling', !!game.player.wreck, 'model visible', game.player.root.visible);
let t = 0; while (game.player.wreck && t < 60) { frames(30); t += 0.5; }
console.log('wreck hit the ground after', t.toFixed(1), 's; model visible', game.player.root.visible);
