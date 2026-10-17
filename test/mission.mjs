// City strike + dogfight mission flow, headless.
import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const { Guide } = await import('../src/ui/guide.js');
const { STRIKE } = await import('../src/game/mission.js');
const el = () => ({ hidden: true, innerHTML: '', classList: { toggle() {} } });
const els = { coach: el(), 'keys-card': el() };
const game = new Game({ appendChild() { } }, { scenario: 'strike', loadout: 'strike', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
const guide = new Guide(game, { getElementById: (id) => els[id] });
game.onFrame = (dt) => guide.update(dt);
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const frames = (n, f) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); if (f && f(i)) return; } };
const secs = (s, f) => frames(Math.round(s * 60), f);
const press = (code) => { I.keys.add(code); I.pressed.add(code); frames(1); I.keys.delete(code); frames(1); };
const coach = () => els.coach.innerHTML.replace(/<li class="(\w+)"><i>.<\/i>/g, '\n   [$1] ').replace(/<div class="c-alert (\w+)">/g, '\n  !$1! ').replace(/<div class="c-title">/, '\n  # ').replace(/<div class="c-tip">/, '\n   tip: ').replace(/<kbd>([^<]*)<\/kbd>/g, '[$1]').replace(/<[^>]+>/g, ' ').replace(/ +/g, ' ');
let report = null; game.mission.onEnd = (r) => { report = r; };
const P = () => game.player, ac = () => game.player.ac;
const fly = (pos, hdgDeg, spd = 230) => { const s = ac().s; s.p.copy(pos); const h = hdgDeg * Math.PI / 180; s.v.set(Math.sin(h) * spd, 0, -Math.cos(h) * spd); s.q.setFromEuler(new THREE.Euler(0, -h, 0)); s.w.set(0, 0, 0); };
const faceTo = (pt) => { const s = ac().s; const h = Math.atan2(pt.x - s.p.x, -(pt.z - s.p.z)) * 180 / Math.PI; fly(s.p.clone(), h, s.v.length()); };

game.launch({ scenario: 'strike', loadout: 'strike', invulnerable: true }); game.opts.invulnerable = true;
frames(20);
const M = game.mission;
console.log('mission', M.kind, M.state, '| defenses', M.defensesTotal, '| bunker hp', M.bunker.hp, '| fleet', M.fleet.length, '| jets', M.jets.length, '| sams', game.sams.length, 'pd', game.pointDef.length, 'flak', game.flak.length, 'shipDefs', game.shipDefs.length);
console.log('objective:', game.objectiveText());
console.log('coach at start:' + coach());
const mk = game.buildMarkers(); console.log('markers:', mk.map(m => `${m.kind}:${m.label}${m.arrow ? '→' : ''}`).join(' | '));
// --- SEAD: HARMs from ~22 km, one per radar
press('Digit5'); console.log('selected', P().sel, P().count('agm88'), 'HARMs');
const radarsFirst = M.defenses.filter(e => e.radar);
let fired = 0;
for (const tgt of radarsFirst) {
  if (!tgt.alive || P().count('agm88') === 0) continue;
  const dir = new THREE.Vector3(STRIKE.hq.x, 0, STRIKE.hq.z);
  const away = tgt.pos.clone().sub(dir); // approach from the south
  fly(new THREE.Vector3(tgt.pos.x + 2000, 5200, tgt.pos.z + 21000), 0); faceTo(tgt.pos);
  P().tgp.target = tgt; // aim the HARM at this one
  press('Space'); const m = game.lastMissile; fired++;
  secs(70, () => !m || m.dead);
  console.log(`  HARM ${fired} -> ${tgt.tag || tgt.name}: ${m && m.reason} | alive=${tgt.alive}`);
}
// clean up whatever is left (AA guns) with the cluster bomb / gun cheat if needed
for (const e of M.defenses) if (e.alive) { console.log('  finishing', e.tag, 'by gun/CBU (test shortcut)'); game.world.blast = null; e.damage(9999, P(), e.pos); }
frames(10);
console.log('state after SEAD:', M.state, '|', game.objectiveText());
console.log('coach phase 2:' + coach());
// --- bunker buster
while (P().sel !== 'gbu31') press('Digit4');
fly(new THREE.Vector3(STRIKE.hq.x - 600, 5200, STRIKE.hq.z + 16000), 0); faceTo(M.bunker.pos); frames(5);
press('KeyT'); console.log('marked:', P().tgp.target && P().tgp.target.name);
frames(12); console.log('coach marked:' + coach());
let tries = 0; while (game.lastMissile?.key !== 'gbu31' && tries++ < 3000) { frames(1); if (P().jdamLAR(M.bunker.pos).inRange) press('Space'); }
const bb = game.lastMissile; console.log('released at', (P().jdamLAR(M.bunker.pos).range / 1000).toFixed(1), 'km, bomb', bb && bb.key);
secs(70, () => !bb || bb.dead);
console.log('bomb result', bb.reason, 'impact', bb.pos.toArray().map(v => v | 0), 'bunker hp', M.bunker.hp, 'alive', M.bunker.alive, '| state', M.state);
secs(6);
console.log('report:', report && JSON.stringify({ s: report.success, h: report.headline, t: report.time | 0, grade: report.grade, items: report.items.length }));
// --- conventional bomb on a fresh bunker: no effect
report = null; game.launch({ scenario: 'strike', loadout: 'multirole', invulnerable: true }); frames(5);
game.world.blast = { penetrator: false }; game.mission.bunker.damage(1600, P(), game.mission.bunker.pos); game.world.blast = null;
console.log('after a Mk-84-sized hit on the bunker: hp', game.mission.bunker.hp, '(hardened)');
// --- failure path
game.playerKilled('SHOT DOWN'); secs(5); console.log('fail report:', report && JSON.stringify({ s: report.success, h: report.headline }));
// --- fleet engages when close
report = null; game.launch({ scenario: 'strike', loadout: 'strike', invulnerable: true }); game.opts.invulnerable = true; frames(5);
const D = game.mission.fleet[0]; fly(new THREE.Vector3(D.pos.x, 3000, D.pos.z + 11000), 0); secs(12);
console.log('fleet shots at player:', game.world.missiles.filter(m => m.team === 'red' && m.shooter && m.shooter.kind === 'ship').length);
// --- dogfight
report = null; game.launch({ scenario: 'air', loadout: 'air', invulnerable: true }); frames(5);
console.log('dogfight jets', game.mission.jets.length, '| objective:', game.objectiveText(), '| coach title:', coach().split('\n')[1]);
for (const j of game.mission.jets) j.damage(999, P(), j.pos); secs(6);
console.log('dogfight report:', report && JSON.stringify({ s: report.success, h: report.headline, items: report.items.length }));
