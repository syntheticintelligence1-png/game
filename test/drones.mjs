// Drones and UAVs, headless: the recon UAV spots the player and dies to an AIM-120, an attack-drone raid and a
// cruise-missile raid against the carrier group (escorts shoot, leakers hit ships), the Reaper marks targets.
import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const { spawnDrone, launchRaid } = await import('../src/game/drones.js');
const { STRIKE } = await import('../src/game/mission.js');
const game = new Game({ appendChild() { } }, { scenario: 'air', loadout: 'air', hour: 10, weather: 'clear', quality: 'low' });
await game.init(() => {});
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const frames = (n, f) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); if (f && f(i)) return; } };
const secs = (s, f) => frames(Math.round(s * 60), f);
const press = (code) => { I.keys.add(code); I.pressed.add(code); frames(1); I.keys.delete(code); frames(1); };
const P = () => game.player, ac = () => game.player.ac;
const fly = (pos, hdgDeg, spd = 230) => { const s = ac().s; s.p.copy(pos); const h = hdgDeg * Math.PI / 180; s.v.set(Math.sin(h) * spd, 0, -Math.cos(h) * spd); s.q.setFromEuler(new THREE.Euler(0, -h, 0)); s.w.set(0, 0, 0); };
let fails = 0; const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) fails++; };

game.launch({ scenario: 'air', loadout: 'air', invulnerable: true }); game.opts.invulnerable = true;
frames(20);
// park the dogfight's fighters far away so they stay out of this
for (const j of game.aiJets) if (j.team === 'red') { j.pos.set(-60000, 9000, -60000); j.update = () => { }; }

// --- recon UAV: spots the player, shows on radar, dies to a missile
const cv = game.carrier.pos;
fly(new THREE.Vector3(cv.x, 5000, cv.z - 26000), 0);
const uav = spawnDrone(game, 'recon', { pos: new THREE.Vector3(cv.x + 1500, 4200, cv.z - 44000), heading: 90, orbit: { x: cv.x, z: cv.z - 44000 }, orbitR: 3000 });
secs(2);
check(game.gciSees, `recon UAV reports the player (gciSees=${game.gciSees}, sees=${uav.seesPlayer})`);
const mk = game.buildMarkers().filter(m => m.kind === 'drone'); check(mk.length === 1 && mk[0].arrow, `HUD marker for the UAV: ${mk.map(m => m.label + (m.arrow ? '→' : ''))}`);
// face it and lock it
const faceTo = (pt) => { const s = ac().s; const h = Math.atan2(pt.x - s.p.x, -(pt.z - s.p.z)) * 180 / Math.PI; fly(s.p.clone(), h, s.v.length()); };
faceTo(uav.pos); secs(1.2);
const seen = P().radar.contacts.some(c => c.e === uav); check(seen, `player radar sees the UAV at ${(uav.pos.distanceTo(P().pos) / 1000).toFixed(1)} km`);
press('KeyT'); frames(5);
check(P().radar.stt === uav, `locked: ${P().radar.stt && P().radar.stt.name}`);
while (P().sel !== 'aim120') press('Digit1');
press('Space'); const m1 = game.lastMissile;
secs(60, () => !uav.alive || !m1 || m1.dead);
check(!uav.alive, `AIM-120 vs UAV: ${m1 && m1.reason}, uav alive=${uav.alive}`);
secs(70, () => uav.done);
check(uav.done && !game.drones.includes(uav), `UAV wreck fell and was swept (done=${uav.done})`);

// --- attack-drone raid on the fleet
fly(new THREE.Vector3(cv.x - 30000, 7000, cv.z), 90); // well away, so only the ships fight
const hp0 = game.ships.map(s => s.entity.hp);
let impacts = 0, hits = 0;
const raid = launchRaid(game, { type: 'attack', n: 8, from: { x: cv.x + 3000, z: cv.z - 15000 }, onImpact: (h) => { impacts++; if (h) hits++; } });
console.log('raid', raid.length, 'drones; first targets', raid.map(d => d.target.name).join(','));
let t0 = game.time;
secs(420, () => raid.every(d => !d.alive));
const shot = raid.filter(d => !d.alive).length - impacts;
console.log(`  after ${(game.time - t0) | 0}s: shot down ${shot}, impacts ${impacts} (on ships ${hits}); ship hp`, game.ships.map((s, i) => `${s.name}:${hp0[i] | 0}->${s.entity.hp | 0}`).join(' '));
check(raid.every(d => !d.alive), 'every drone in the raid is gone');
check(shot >= 2, `escorts shot down ${shot} of 8`);
check(game.carrier.entity.alive, 'carrier survived 8 drones');

// --- cruise-missile raid
impacts = 0; hits = 0;
const vamp = launchRaid(game, { type: 'cruise', n: 4, from: { x: cv.x - 4000, z: cv.z - 32000 }, onImpact: (h) => { impacts++; if (h) hits++; } });
t0 = game.time;
secs(300, () => vamp.every(d => !d.alive));
console.log(`  cruise raid after ${(game.time - t0) | 0}s: shot down ${vamp.filter(d => !d.alive).length - impacts}, impacts ${impacts} (ships ${hits}); carrier hp ${game.carrier.entity.hp | 0}`);
check(vamp.every(d => !d.alive), 'every cruise missile is gone');

// --- the player guns a drone
const d2 = spawnDrone(game, 'attack', { pos: new THREE.Vector3(cv.x, 400, cv.z - 20000), heading: 180, target: game.carrier.entity });
fly(new THREE.Vector3(d2.pos.x, 420, d2.pos.z - 800), 180, 160);
// hold C (gun) while pointing at it from behind (a perfect pilot: the test only checks that bullets kill drones)
frames(60 * 20, () => {
  const s = ac().s; const to = d2.pos.clone().sub(s.p); const R = to.length(); to.normalize(); s.v.copy(to).multiplyScalar(d2.speed + 30);
  // the gun line sits 1.5 degrees above the nose; hold the nose under the drone by that plus the bullet drop
  // (time of flight with drag: x = ln(1 + k v0 t) / k)
  const k = 5.7e-4, v0 = 1030 + s.v.length(), tof = (Math.exp(k * R) - 1) / (k * v0);
  const aim = d2.pos.clone(); aim.y += 0.5 * 9.81 * tof * tof - R * 0.0262;
  s.q.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), aim.sub(s.p), new THREE.Vector3(0, 1, 0))); s.w.set(0, 0, 0);
  if (R < 500) I.keys.add('KeyC'); else I.keys.delete('KeyC'); return !d2.alive;
});
I.keys.delete('KeyC');
check(!d2.alive, `gun vs attack drone (alive=${d2.alive}, hp=${d2.hp | 0}, impact=${d2.done && d2.alive})`);

// --- Reaper over the city marks the air defenses
const reaper = spawnDrone(game, 'reaper', { pos: new THREE.Vector3(STRIKE.hq.x, 6400, STRIKE.hq.z + 8000), heading: 0, dest: { x: STRIKE.hq.x, z: STRIKE.hq.z }, orbitR: 3500 });
secs(5);
const spotted = game.world.entities.filter(e => e.spotted && e.alive);
console.log('  spotted:', spotted.map(e => e.tag || e.name).join(', '));
check(spotted.length >= 4, `Reaper marked ${spotted.length} targets`);
fly(new THREE.Vector3(STRIKE.hq.x, 5000, STRIKE.hq.z + 40000), 0);
frames(2);
const sm = game.buildMarkers().filter(m => m.kind === 'spotted');
check(sm.length >= 4, `spotted markers on the HUD from 40 km: ${sm.length}`);
check(game.buildMarkers().some(m => m.kind === 'friendly' && m.label === 'REAPER'), 'Reaper has a friendly marker');
check(reaper.alive && Math.abs(reaper.pos.y - 6400) < 300, `Reaper holding altitude ${reaper.pos.y | 0}`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
