import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const game = new Game({ appendChild() { } }, { scenario: 'strike', loadout: 'cas', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const frames = (n, f) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); if (f && f(i)) return true; } return false; };
const press = (code) => { I.keys.add(code); I.pressed.add(code); frames(1); I.keys.delete(code); frames(1); };
game.mission.onEnd = () => {};
game.launch({ scenario: 'strike', loadout: 'cas', invulnerable: true }); game.opts.invulnerable = true;
for (const j of game.aiJets) j.alive = false;
const P = game.player, ac = P.ac, s = ac.s;
const tank = game.tanks.find(t => t.team === 'red' && t.e.alive).e;
// start banked and descending toward the hills, then fire a Maverick and ride it
s.p.set(tank.pos.x - 300, 1400, tank.pos.z + 7000); s.v.set(0, -25, -210); s.q.setFromEuler(new THREE.Euler(-0.1, 0, 0.6)); s.w.set(0, 0, 0);
for (let k = 0; k < 4 && P.sel !== 'agm65'; k++) press('Digit3');
press('KeyT'); press('Space'); const m = game.lastMissile;
console.log('fired', m && m.def.name, '| cam', game.rig.mode, '| marked', P.tgp.target && P.tgp.target.name);
let minAgl = 1e9; const alt0 = s.p.y;
frames(60 * 40, () => {
  const agl = s.p.y - Math.max(game.terrain.heightAt(s.p.x, s.p.z), 0); minAgl = Math.min(minAgl, agl);
  return game.rig.mode !== 'seeker';
});
console.log(`missile ${m.reason} | camera back to: ${game.rig.mode} | jet alt ${alt0 | 0} -> ${s.p.y | 0} m, lowest above ground ${minAgl | 0} m, bank ${ac.rollDeg().toFixed(0)}°, alive ${P.alive}`);
console.log('detection status:', P.detect, '| rcs', P.rcs.toFixed(1));
