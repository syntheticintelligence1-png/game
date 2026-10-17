// Radio calls: drive each scenario through its main events and print what MAGIC / MOTHER / PADDLES / you say.
import { installDOM } from './headless_env.mjs';
installDOM();
const { Game } = await import('../src/game/game.js');
const game = new Game({ appendChild() { } }, { scenario: 'strike', loadout: 'strike', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
let T = 0; game.last = 0; game.acc = 0;
const frames = (n, f) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); if (f && f(i)) return true; } return false; };
game.mission.onEnd = () => {};
const seen = new Set(); let count = 0;
const dump = () => { for (const it of game.comms.history) if (!seen.has(it.id)) { seen.add(it.id); count++; console.log(`  [${game.time.toFixed(1).padStart(5)}] ${it.from.padEnd(9)} ${it.text}${it.plain ? `\n                    ↳ ${it.plain}` : ''}`); } };
const run = (sec, f) => frames(Math.round(60 * sec), () => { dump(); return f ? f() : false; });
const P = game.player;

console.log('— CITY STRIKE (airborne start)');
game.launch({ scenario: 'strike', loadout: 'strike', invulnerable: true });
run(12);
const M = game.mission;
// fly into the SA-21 ring
P.ac.s.p.set(2400, 4800, 28500); run(14);
// knock the defenses out one by one, as if by your weapons
for (const e of M.defenses.slice()) { e.damage(1e5, P); run(3.5); }
// a Maverick on the bunker: no effect; then the bunker buster
game.world.blast = { penetrator: false }; M.bunker.damage(400, P); game.world.blast = null; run(4);
game.world.blast = { penetrator: true }; M.bunker.damage(1200, P); game.world.blast = null; run(4);
game.world.blast = { penetrator: true }; M.bunker.damage(5000, P); game.world.blast = null; run(7);
game.comms.rtb(); run(8);

console.log('\n— CARRIER TAKEOFF');
game.launch({ scenario: 'carrier', loadout: 'multirole', invulnerable: true });
run(6); game.onCatShot(); run(14);

console.log('\n— DOGFIGHT');
game.launch({ scenario: 'air', loadout: 'air', invulnerable: false });
run(8);
const j = game.mission.jets[0]; P.ac.s.p.set(j.pos.x, j.pos.y, j.pos.z + 6000); run(6);
j.damage(1e4, P); run(6);
// a bandit behind you
const j2 = game.mission.jets[1]; j2.pos.set(P.pos.x, P.pos.y, P.pos.z + 3000); j2.vel.set(0, 0, -250); run(3);
P.damage(1e4, null); run(4);

console.log('\n— CARRIER LANDING');
game.launch({ scenario: 'approach', loadout: 'multirole', invulnerable: true });
run(9);
console.log(`\n${count} calls, ${game.comms.q.length} still queued`);
