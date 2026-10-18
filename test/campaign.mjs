// Operation Trident, headless: each of the five campaign stages sets the world up the way the earlier stages left
// it, carries the right weapons, wins (and the last one can be lost), and leaves nothing behind for the next.
// Also: time speed-up (J) and its automatic drop back, the theater map's autopilot (N).
import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const { STAGES, WAVES } = await import('../src/game/campaign.js');
const game = new Game({ appendChild() { } }, { scenario: 'carrier', loadout: 'auto', hour: 10, weather: 'clear', quality: 'low' });
await game.init(() => {});
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const frames = (n, f) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); if (f && f(i)) return; } };
const secs = (s, f) => frames(Math.round(s * 60), f);
const press = (code) => { I.keys.add(code); I.pressed.add(code); frames(1); I.keys.delete(code); frames(1); };
const P = () => game.player, M = game.mission;
let fails = 0; const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) fails++; };
let report = null; M.onEnd = (r) => { report = r; };
const kill = (e) => { if (e.isBunker) game.world.blast = { penetrator: true }; e.damage(1e6, game.player, e.pos.clone()); game.world.blast = null; };
const fly = (id) => { report = null; game.launch({ scenario: 'campaign', stage: STAGES.findIndex(s => s.id === id), loadout: 'auto', invulnerable: true }); frames(30); };
const count = (k) => P().count(k);
const redDrones = () => game.drones.filter(d => d.alive && d.team === 'red');
const endWithin = (s) => secs(s, () => report);

// ---- 1 CLEAR THE SKY
fly('air');
check(M.kind === 'dogfight' && M.ctl && M.ctl.id === 'air', `stage 1 kind ${M.kind}`);
check(M.jets.length === 5 && M.jets.filter(j => j.isDrone && j.type === 'recon').length === 1, `four fighters and a spy drone (${M.jets.map(j => j.name).join(', ')})`);
check(count('aim120') >= 6 && count('agm84') === 0, `air-to-air load: ${P().inventory().map(i => `${i.name}×${i.n}`).join(' ')}`);
check(game.wingman && game.wingman.weapons.aim120 > 0 && game.wingman.weapons.agm84 === 0, 'Spear 1-2 carries air-to-air');
check(Math.abs(P().pos.z - STAGES[0].start.z) < 600 && Math.abs(P().pos.y - STAGES[0].start.y) < 200, `airborne start ${P().pos.x | 0},${P().pos.y | 0},${P().pos.z | 0}`);
check(/STAGE 1/.test(M.objectiveText()), `objective: ${M.objectiveText()}`);
for (const j of M.jets.slice(0, 4)) kill(j);
frames(5);
check(!M.ended, 'four fighters down: not over while the spy drone flies');
kill(M.jets[4]); endWithin(10);
check(report && report.success && report.stage && report.stage.i === 0, `stage 1 won: ${report && report.headline} · ${report && report.grade}`);

// ---- 2 BLIND THEIR RADARS
fly('sead');
check(M.kind === 'strike' && M.state === 'sead' && M.defenses.length === 6, `stage 2: ${M.defenses.length} air-defense targets, state ${M.state}`);
check(count('agm88') === 4 && count('gbu39') === 8, `SEAD load: ${P().inventory().map(i => `${i.name}×${i.n}`).join(' ')}`);
check(game.drones.some(d => d.team === 'blue' && d.type === 'reaper'), 'a Reaper is on station');
check(!M.currentTargets().has(M.bunker), 'the bunker is not a stage 2 target');
check(game.aiJets.filter(j => j.team === 'red').length === 1, 'one enemy fighter left');
for (const e of M.defenses.slice()) kill(e);
endWithin(10);
check(report && report.success && /AIR DEFENSES/.test(report.headline) && M.bunker.alive, `stage 2 won: ${report && report.headline}; bunker still standing`);
check(report && report.items.every(i => !/BUNKER/.test(i.text)), 'debrief lists the defenses, not the bunker');

// ---- 3 HIT THE BUNKER
fly('bunker');
check(M.state === 'strike' && !M.samSite && M.pd && M.defenses.length === 3, `stage 3: SA-21 gone, SA-15 + 2 AAA back (${M.defenses.map(e => e.tag).join(', ')})`);
check(!game.sams.length, 'no SA-21 battery in the world');
const hammer = game.aiJets.filter(j => j.isStrikeWing);
check(hammer.length === 2 && hammer.every(h => h.team === 'blue' && h.order === 'hunt'), `Hammer flight: ${hammer.map(h => `${h.name} ${h.order}`).join(', ')}`);
check(count('gbu31') >= 2, `bunker busters: ${count('gbu31')}`);
const tg = [...M.currentTargets()]; check(tg.length === 1 && tg[0] === M.bunker, 'the bunker is the only target');
secs(80);
check(redDrones().filter(d => d.target).length > 0 || M.ctl.raidDone, `70 s in: drones go for the carrier (${redDrones().length} red drones, raid ${M.ctl.raidDone})`);
const hamBusy = hammer.filter(h => h.alive && (h.strike || h.state !== 'patrol' || h.kills > 0)).length;
console.log(`  hammer: ${hammer.map(h => `${h.name} alive=${h.alive} kills=${h.kills} strike=${!!h.strike} state=${h.state}`).join(' | ')}; defenses left ${M.defensesLeft}`);
check(hamBusy > 0 || M.defensesLeft < 3, 'Hammer flight is working the target area');
kill(M.bunker); endWithin(10);
check(report && report.success && /BUNKER/.test(report.headline), `stage 3 won: ${report && report.headline}`);
check(report && report.items.some(i => /HAMMER 2-1/.test(i.text)), 'debrief reports on Hammer flight');
const ham2 = hammer[0];

// ---- 4 SINK THE FLEET
fly('naval');
check(!game.aiJets.includes(ham2) && !game.aiJets.some(j => j.isStrikeWing), 'Hammer flight is gone after stage 3');
check(M.kind === 'naval' && M.fleet.length === 3 && M.defenses.length === 0, `stage 4: ${M.fleet.length} warships, ${M.defenses.length} air defenses`);
check(M.bunker && !M.bunker.alive && M.rubble.visible && !M.hqMesh.visible, 'the HQ is rubble');
check(count('agm84') === 5, `Harpoons: ${count('agm84')}`);
check(game.wingman.weapons.agm84 === 2, `Spear 1-2 Harpoons: ${game.wingman.weapons.agm84}`);
check(M.threatRings().filter(z => z.id === 'fleet').length === 3, 'warship SAM rings for the radio');
kill(M.fleet[0]); kill(M.fleet[1]); frames(5);
check(!M.ended && /SUNK 2\/3/.test(M.objectiveText()), `two down: ${M.objectiveText()}`);
kill(M.fleet[2]); endWithin(10);
check(report && report.success && /SURFACE GROUP/.test(report.headline), `stage 4 won: ${report && report.headline}`);

// ---- 5 HOLD THE LINE (lose it, then hold it)
fly('defense');
check(M.kind === 'defense' && !(M.fleet || []).length && !game.aiJets.some(j => j.team === 'red'), 'stage 5: no enemy ships or fighters, just what is coming');
const cv = game.carrier;
check(P().pos.distanceTo(new THREE.Vector3(cv.pos.x, P().pos.y, cv.pos.z - 6000)) < 800, `start 6 km north of the carrier (${(P().pos.distanceTo(cv.pos) / 1000).toFixed(1)} km away)`);
kill(cv.entity); endWithin(10);
check(report && !report.success && /CARRIER/.test(report.headline), `carrier sunk: ${report && report.headline}`);
fly('defense');
check(cv.entity.alive && cv.entity.hp === cv.entity.maxHp, `carrier back afloat for the retry (hp ${cv.entity.hp | 0})`);
// time speed-up: J twice -> x4; it drops back when the first wave is close to the ships
press('KeyJ'); check(game.timeScale === 2, `J: time x${game.timeScale}`);
press('KeyJ'); check(game.timeScale === 4, `J again: time x${game.timeScale}`);
const t0 = game.time; let wall = 0;
frames(60 * 30, () => { wall++; return game.timeScale === 1; });
check(game.timeScale === 1 && M.ctl.waveI === 1, `back to normal speed when wave 1 came (${(game.time - t0).toFixed(0)} s sim in ${(wall / 60).toFixed(1)} s, wave ${M.ctl.waveI})`);
check(redDrones().length === WAVES[0].groups[0].n, `wave 1: ${redDrones().length} attack drones`);
press('KeyJ'); check(game.timeScale === 1, 'J refused while drones close on the ships');
// theater map: the autopilot holds the jet
press('KeyN'); frames(30);
check(game.mapOpen && game.apActive, `N: map open, autopilot on (${game.apActive})`);
press('KeyN'); frames(2); check(!game.mapOpen, 'N again closes it');
// all three waves, the escorts and Spear 1-2 fighting; the player orbits out of the way
const hp0 = cv.entity.hp; let maxDrones = 0;
endWithin(600);
for (let i = 0; i < 2 && !report; i++) endWithin(60);
console.log(`  waves launched ${M.ctl.waveI}/${WAVES.length}; carrier ${hp0 | 0} -> ${cv.entity.hp | 0}; result ${report && report.headline}`);
check(M.ctl.waveI === WAVES.length, 'all three waves came');
check(report != null, `stage 5 ended: ${report && report.headline} (${report && report.success ? 'held' : 'lost'})`);
if (report) {
  console.log('  debrief:', report.items.map(i => `${i.ok ? '✓' : '✗'} ${i.text}`).join(' | '));
  check(report.items.some(i => /THREATS SHOT DOWN/.test(i.text)), 'debrief counts the threats shot down');
  check(report.stage && report.stage.last, 'stage 5 is the last stage');
}
void maxDrones;
// classic missions still work after the campaign
report = null; game.launch({ scenario: 'strike', loadout: 'auto', invulnerable: true }); frames(30);
check(M.kind === 'strike' && !M.stage && M.defenses.length === 6 && M.bunker.alive && M.fleet.length === 3 && game.drones.length === 0, `city strike after the campaign: ${M.defenses.length} defenses, ${M.fleet.length} ships, ${game.drones.length} drones`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
