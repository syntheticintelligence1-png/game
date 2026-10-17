// Diving into a hillside must explode cleanly: no NaN in the jet state, camera or HUD afterwards.
import { installDOM } from './headless_env.mjs';
installDOM();
const { Game } = await import('../src/game/game.js');
const game = new Game({ appendChild() { } }, { scenario: 'strike', loadout: 'strike', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
let T = 0; game.last = 0; game.acc = 0;
const FT = +(process.env.FT || 16.667); const frames = (n, f) => { for (let i = 0; i < n; i++) { T += FT; game.frame(T); if (f && f(i)) return true; } return false; };
game.mission.onEnd = () => {};
const P = game.player, ac = P.ac, s = ac.s;
const bad = (v) => !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z);
for (const [x, z, vy, vh] of [[-3000, 1700, -90, -140], [0, 0, -60, -200], [-6000, -2000, -150, -100], [3400, 6900, -40, -220]]) {
  game.launch({ scenario: 'strike', loadout: 'strike', invulnerable: false });
  const h = game.terrain.heightAt(x, z);
  s.p.set(x, Math.max(h, 0) + 260, z); s.v.set(0, vy, vh);
  let firstNaN = null, n = 0;
  frames(60 * 8, (i) => {
    n = i;
    if (!firstNaN && (bad(s.p) || bad(s.v) || bad(game.camera.position))) firstNaN = { i, alive: P.alive, p: s.p.toArray().map(v => +v.toFixed(1)), v: s.v.toArray().map(v => +v.toFixed(1)), cam: game.camera.position.toArray().map(v => +v.toFixed(1)), crashed: ac.crashed && ac.crashed.kind };
    return false;
  });
  console.log(`dive at ${x},${z} (ground ${h.toFixed(0)} m): alive=${P.alive} crashed=${ac.crashed && ac.crashed.kind} cam=${game.camera.position.toArray().map(v => v.toFixed(0))} ${firstNaN ? 'NaN at frame ' + JSON.stringify(firstNaN) : 'no NaN'}`);
}
