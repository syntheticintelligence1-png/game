// Friendly escorts: an armed bandit flies at the carrier group (does the fleet shoot, does the bandit break off?), then
// an enemy missile chases the player past the ships (do they fire at it?). Also checks the helicopters and prints
// the escorts' radio calls.
import { installDOM } from './headless_env.mjs';
installDOM();
const { Game } = await import('../src/game/game.js');
const { AIJet } = await import('../src/game/ai.js');
const { Missile } = await import('../src/sim/weapons.js');
const game = new Game({ appendChild() { } }, { scenario: 'strike', loadout: 'strike', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
let T = 0; game.last = 0; game.acc = 0;
const frames = (n, f) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); if (f && f(i)) return true; } return false; };
game.mission.onEnd = () => {};
game.launch({ scenario: 'strike', loadout: 'strike', invulnerable: true }); game.opts.invulnerable = true;
const P = game.player, s = P.ac.s, C = game.carrier;
const calls = [], call0 = game.comms.call.bind(game.comms);
game.comms.call = (who, text, plain, o = {}) => { calls.push(`${o.from || who}: ${text}`); return call0(who, text, plain, o); };
const escorts = game.shipDefs.filter(d => d.team === 'blue');
console.log(`ships ${game.ships.map(x => x.name).join(' ')} | escort air defenses ${escorts.length}`);

// 1) a bandit (2 radar + 2 heat-seeking missiles) flying at the fleet, the player between it and the ships
for (const j of game.aiJets) j.alive = false;
const c = C.pos.clone();
s.p.set(c.x + 9000, 1500, c.z + 1500); s.v.set(-230, 0, 0); s.q.set(0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4));
const j = new AIJet(game, { name: 'FLANKER X', pos: c.clone().add({ x: 11500, y: 1600 - c.y, z: 1500 }), heading: 270, speed: 260, cap: c.clone().setY(1500), capAlt: 1500, r77: 2, r73: 2 });
game.world.add(j); game.aiJets.push(j);
const shots = new Set(), redM = new Set(); let t = 0, killedAt = null, defendT = 0, firstShotT = null;
frames(60 * 90, () => {
  t += 1 / 60;
  for (const m of game.world.missiles) {
    if (m.team === 'blue' && m.shooter && m.shooter.kind === 'ship') shots.add(m);
    if (m.team === 'red') redM.add(m);
  }
  if (shots.size && firstShotT == null) firstShotT = t;
  if (j.state === 'defend') defendT += 1 / 60;
  if (!j.alive && killedAt == null) killedAt = t;
  if (Math.round(t * 60) % 600 === 0) console.log(`  t=${t.toFixed(0)} bandit ${j.state}, hp ${j.hp | 0}, ${(j.pos.distanceTo(C.pos) / 1000).toFixed(1)} km from the carrier`);
  return t > 60 || (killedAt != null && t > killedAt + 3);
});
console.log(`bandit: first escort shot at t=${firstShotT == null ? '-' : firstShotT.toFixed(1)} s, ${shots.size} escort SAMs (${[...shots].filter(x => x.target === j).length} at the jet, ${[...shots].filter(x => x.target && x.target.isMissile).length} at its missiles), bandit defending ${defendT.toFixed(0)} of ${t.toFixed(0)} s, fired ${redM.size} missiles, ${j.alive ? 'still alive' : `shot down at t=${killedAt.toFixed(1)} s`}; player hp ${P.hp | 0}`);

// 2) an enemy radar missile chasing the player past the fleet
s.p.set(c.x - 1500, 1200, c.z + 3000); s.v.set(-200, 0, 0);
const m = new Missile(game, 'r77', { team: 'red', shooter: j, target: P, pos: P.pos.clone().add({ x: 14000, y: 1500, z: 0 }), vel: P.vel.clone().set(-600, -40, 0) });
m.active = true; game.world.missiles.push(m);
const shots2 = new Set();
frames(60 * 30, () => { for (const x of game.world.missiles) if (x.team === 'blue' && x.shooter && x.shooter.kind === 'ship' && !shots.has(x)) shots2.add(x); return m.dead; });
console.log(`missile: ${shots2.size} escort SAMs fired at it, missile ${m.dead ? `gone (${m.reason})` : 'still flying'}, player hp ${P.hp | 0}`);

for (const h of game.helos) console.log(`helicopter ${(h.pos.distanceTo(h.o.ship.pos) / 1000).toFixed(2)} km from ${h.o.ship.name}, ${h.pos.y.toFixed(0)} m up, ${h.vel.length().toFixed(0)} m/s, ${Number.isFinite(h.pos.x + h.pos.z + h.root.rotation.z) ? 'ok' : 'NaN!'}`);
console.log('radio:\n  ' + calls.filter(x => /HALSEY|KIDD|CONSTELLATION|umbrella/i.test(x)).join('\n  '));
