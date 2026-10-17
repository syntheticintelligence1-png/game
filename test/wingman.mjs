// Spear 1-2, the wingman, headless: formation flying (straight, turning, catching up), the O order menu, "attack my
// target" on a SAM radar, a warship and a locked jet, hunting the air defenses, the bunker refusal, going home, a
// carrier start from catapult 2, none in landing practice, despawn on relaunch, getting shot down.
// Usage: node test/wingman.mjs [form,sead,ship,air,cat,misc]   (default: all). Failed checks are listed at the end.
import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const which = (process.argv[2] || 'all').split(',');
const has = (k) => which.includes('all') || which.includes(k);
const game = new Game({ appendChild() { } }, { scenario: 'strike', loadout: 'strike', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
// the picture and HUD every 4th frame only (speed); the game logic runs every frame
const render0 = game.render.bind(game); let rn = 0; game.render = (dt) => { if (rn++ % 4 === 0) render0(dt); };
const frames = (n, f) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); if (f && f(i)) return true; } return false; };
const secs = (s, f) => frames(Math.round(s * 60), f);
const press = (c) => { I.keys.add(c); I.pressed.add(c); frames(1); I.keys.delete(c); frames(1); };
const order = (n) => { press('KeyO'); press(`Digit${n}`); };
const fails = []; const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
const calls = []; const call0 = game.comms.call.bind(game.comms);
game.comms.call = (who, text, plain, o = {}) => { calls.push({ t: game.time, who: o.from || who, text }); return call0(who, text, plain, o); };
const wingSaid = (since) => calls.filter(c => c.who === 'wing' && c.t >= since).map(c => c.text.replace(/^Spear 1-2, /, ''));
let report = null; game.mission.onEnd = (r) => { report = r; };
const P = () => game.player, M = () => game.mission;
const km = (a, b) => (a.distanceTo(b) / 1000).toFixed(1);
const msgs = () => game.msgs.map(m => m.text).join(' | ');
const fly = (pos, hdgDeg, spd = 230) => { const s = P().ac.s; s.p.copy(pos); const h = hdgDeg * Math.PI / 180; s.v.set(Math.sin(h) * spd, 0, -Math.cos(h) * spd); s.q.setFromEuler(new THREE.Euler(0, -h, 0)); s.w.set(0, 0, 0); P().sync(); };
// the leader holds a bank with the easy controls (D pressed while the bank is below the goal)
const banked = (deg) => { if (Math.abs(P().ac.rollDeg()) < deg) I.keys.add('KeyD'); else I.keys.delete('KeyD'); };
const orbit = (s, f, deg = 45) => { const r = secs(s, (i) => { banked(deg); return f && f(i); }); I.keys.delete('KeyD'); return r; };
// a jet's bank angle from its up vector: positive = right wing down
const bankOf = (j) => { const f = j.vel.clone().normalize(), r = f.clone().cross(j.up).normalize(); return Math.asin(THREE.MathUtils.clamp(-r.y, -1, 1)) * 180 / Math.PI; };
// every weapon the wingman fires, printed with how it ended
const shotLog = (w) => {
  const out = []; const f0 = w.fire.bind(w);
  w.fire = (key, t) => {
    const m = f0(key, t), s = `${key}→${t.tag || t.name} @${km(w.pos, t.pos)}km`;
    out.push({ key, tgt: t, R: w.pos.distanceTo(t.pos), at: game.time, toString: () => `${s} (${m.dead ? m.reason : 'flying'} at ${m.t.toFixed(0)} s${m.dead ? `, ${m.pos.y.toFixed(0)} m up, ${km(m.pos, t.pos)} km from it` : ''})` });
    return m;
  };
  return out;
};
const threatsOn = (w) => game.world.missiles.filter(m => m.team === 'red' && m.target === w).length;
const start = (scenario, loadout) => { report = null; game.launch({ scenario, loadout, invulnerable: true }); game.opts.invulnerable = true; frames(3); return game.wingman; };
process.on('uncaughtException', (e) => { console.error('UNCAUGHT', e); process.exit(1); });

if (has('form')) {
  console.log('\n=== FORMATION AND THE ORDER MENU (city strike, airborne start) ===');
  const w = start('strike', 'strike');
  check(!!w && w.alive && w.team === 'blue' && game.aiJets.includes(w) && game.world.entities.includes(w), 'wingman spawned: blue, alive, in the world and the AI jet list');
  console.log(`  loadout: ${w.ammoText()} | status: ${w.statusText()}`);
  for (const j of game.aiJets) if (j.team === 'red') { j.alive = false; j.root.visible = false; } // no bandits in this part
  fly(P().pos.clone(), 180); w.placeInSlot(); // away from the city's SAMs
  secs(3);
  check(w.mode === 'form' && w.slotErr < 20, `in formation after 3 s: ${w.slotErr.toFixed(1)} m from the slot, ${P().pos.distanceTo(w.pos).toFixed(0)} m from lead`);
  let mx = 0, sum = 0, n = 0;
  secs(20, () => { mx = Math.max(mx, w.slotErr); sum += w.slotErr; n++; });
  check(mx < 15, `straight 20 s: slot error mean ${(sum / n).toFixed(1)} m, max ${mx.toFixed(1)} m`);
  mx = 0; sum = 0; n = 0; let wb = 0, pb = 0; const h0 = P().ac.heading();
  orbit(25, () => { mx = Math.max(mx, w.slotErr); sum += w.slotErr; n++; wb = Math.max(wb, bankOf(w)); pb = Math.max(pb, Math.abs(P().ac.rollDeg())); }, 60);
  check(mx < 60 && w.mode === 'form', `60° bank turn 25 s (heading ${h0.toFixed(0)}→${P().ac.heading().toFixed(0)}): slot error mean ${(sum / n).toFixed(1)} m, max ${mx.toFixed(1)} m; bank wingman ${wb.toFixed(0)}° / lead ${pb.toFixed(0)}°`);
  secs(8);
  check(w.mode === 'form' && w.slotErr < 25, `rolled out: ${w.slotErr.toFixed(1)} m from the slot, bank ${bankOf(w).toFixed(0)}°`);
  // full afterburner for 15 s
  P().ac.ctl.throttle = 1; game.abArmed = true; mx = 0;
  secs(15, () => { P().ac.ctl.throttle = 1; mx = Math.max(mx, w.slotErr); });
  check(mx < 30 && w.mode === 'form', `afterburner 15 s (${P().ac.tas.toFixed(0)} m/s): slot error max ${mx.toFixed(1)} m, wingman burner ${w.ab.toFixed(2)}`);
  P().ac.ctl.throttle = 0.75;
  // catching up from 6 km behind
  w.pos.addScaledVector(P().vel.clone().normalize(), -6000); w.vel.copy(P().vel); w.mode = 'join'; w.slotOk = false;
  let joinT = null; const t0 = game.time;
  secs(150, () => { if (w.mode === 'form') { joinT = game.time - t0; return true; } return false; });
  check(joinT != null, `caught up from 6 km behind in ${joinT == null ? '-' : joinT.toFixed(0)} s (lead ${P().ac.tas.toFixed(0)} m/s)`);
  // the O menu
  const sel0 = P().sel, t1 = game.time;
  press('KeyO'); check(game.wingMenu, `O opens the order menu (HUD menu ${game.wingMenu ? 'shown' : 'hidden'})`);
  press('Digit2'); check(!game.wingMenu && w.order === 'cover' && P().sel === sel0, `O, 2: order ${w.order}, menu closed, weapon still ${P().sel}; message: ${msgs()}`);
  press('Digit2'); check(w.order === 'cover' && /SELECTED|NONE OF THOSE/.test(msgs()), `2 without the menu selects a weapon (now ${P().sel})`);
  P().sel = sel0;
  press('KeyO'); secs(10.5); check(!game.wingMenu, 'the menu closes by itself after 10 s');
  press('KeyO'); press('KeyO'); check(!game.wingMenu, 'O twice closes it');
  P().tgp.target = null; P().radar.stt = null; order(1);
  check(w.order !== 'attack' && /LOCK OR MARK/.test(msgs()), `O, 1 with no target: refused (${msgs()})`);
  P().sel = 'gbu31'; P().tgp.target = M().bunker; order(1);
  check(w.order !== 'attack' && !w.strike, `O, 1 on the bunker: refused, says "${wingSaid(t1).slice(-1)[0]}"`);
  P().tgp.target = null;
  // go home, then rejoin
  order(5); const c0 = w.pos.distanceTo(game.carrier.pos);
  secs(20); check(w.order === 'home' && w.pos.distanceTo(game.carrier.pos) < c0 - 3000, `O, 5: flying home (${(c0 / 1000).toFixed(1)}→${km(w.pos, game.carrier.pos)} km from the ship), status "${w.statusText()}"`);
  order(4); joinT = null; const t2 = game.time;
  secs(200, () => { if (w.order === 'cover' && w.mode === 'form') { joinT = game.time - t2; return true; } return false; });
  check(joinT != null, `O, 4: back on the wing after ${joinT == null ? '-' : joinT.toFixed(0)} s, status "${w.statusText()}"`);
  console.log('  radio:', wingSaid(t1).join(' / '));
  check(Number.isFinite(w.pos.x + w.pos.y + w.pos.z + w.quat.x), 'no NaN in the wingman state');
}

if (has('sead')) {
  console.log('\n=== ATTACK MY TARGET (SAM radar), THEN HUNT (city strike) ===');
  const w = start('strike', 'strike'), m = M(), shots = shotLog(w), t0 = game.time;
  secs(2);
  console.log('  defenses:', m.defenses.map(e => `${e.tag} ${km(e.pos, P().pos)}km${e.radar ? ' radar' : ''}`).join(', '));
  const tgt = m.defenses.find(e => e.tag === 'SAM TRACKING RADAR');
  P().sel = 'gbu31'; P().tgp.target = tgt; order(1);
  check(w.order === 'attack' && w.strike && w.strike.tgt === tgt, `O, 1 on the ${tgt.tag}: attacking with ${w.strike && w.strike.key}; status "${w.statusText()}"`);
  P().tgp.target = null;
  let maxThreat = 0;
  orbit(180, () => { maxThreat = Math.max(maxThreat, threatsOn(w)); return !tgt.alive; });
  check(!tgt.alive && m.stats.wing >= 1, `${tgt.tag} destroyed ${(game.time - t0).toFixed(0)} s in; wingman kills ${m.stats.wing}; shots ${shots.join(', ')}; wingman ${w.alive ? 'alive' : 'SHOT DOWN'}`);
  let joinT = null; const t1 = game.time;
  orbit(150, () => { if (w.order === 'cover' && w.mode === 'form') { joinT = game.time - t1; return true; } return !w.alive; });
  check(joinT != null, `back on the wing ${joinT == null ? '-' : joinT.toFixed(0)} s after the kill, status "${w.statusText()}"`);
  // hunting the rest of the air defenses
  order(3); check(w.order === 'hunt', `O, 3: ${w.order}`);
  const left0 = m.defensesLeft, t2 = game.time; let shotAt = 0; const seen = new Set();
  orbit(600, () => { for (const x of game.world.missiles) if (x.team === 'red' && x.target === w && !seen.has(x)) { seen.add(x); shotAt++; } return m.state !== 'sead' || !w.alive || w.order !== 'hunt'; });
  console.log(`  hunting ${(game.time - t2).toFixed(0)} s: defenses ${left0}→${m.defensesLeft} left, mission state ${m.state}, wingman kills ${m.stats.wing}, ${shotAt} enemy missiles fired at him, ${w.alive ? 'alive' : 'SHOT DOWN'}, order ${w.order}, status "${w.statusText()}", ammo ${w.ammoText()}`);
  console.log('  shots:', shots.join(', '));
  console.log('  left:', m.defenses.filter(e => e.alive).map(e => e.tag).join(', ') || 'none');
  check(m.defensesLeft <= left0 - 3, `the hunter took out at least 3 more air defenses (${left0 - m.defensesLeft})`);
  console.log('  objective:', game.objectiveText());
  console.log('  radio:', wingSaid(t0).join(' / '));
}

if (has('ship')) {
  console.log('\n=== ATTACK MY TARGET (warship) ===');
  const w = start('strike', 'strike'), m = M(), shots = shotLog(w), t0 = game.time;
  for (const j of game.aiJets) if (j.team === 'red') { j.alive = false; j.root.visible = false; }
  const ship = m.fleet.find(e => e.tag === (process.env.SHIP || 'ENEMY FRIGATE'));
  P().sel = 'gbu31'; P().tgp.target = ship; order(1);
  check(w.strike && w.strike.key === 'agm84', `O, 1 on the ${ship.tag} (${km(P().pos, ship.pos)} km): attacking with ${w.strike && w.strike.key}`);
  P().tgp.target = null;
  const ms = []; const f1 = w.fire; w.fire = (k, t) => { const x = f1(k, t); if (k === 'agm84') ms.push({ x, t: game.time }); return x; };
  orbit(300, () => !ship.alive || !w.alive || (!w.strike && ms.length && ms.every(s => s.x.dead)));
  // each missile hit, or the ship's defenses shot it down near the ship (not lost in the sea on the way)
  const reached = ms.filter(s => s.x.dead && s.x.pos.distanceTo(ship.pos) < (s.x.reason === 'detonated' ? 300 : 10000)).length;
  check(ms.length === 2 && reached === 2, `salvo of ${ms.length}${ms.length === 2 ? ` ${(ms[1].t - ms[0].t).toFixed(1)} s apart` : ''}, ${reached} reached the ship; ${ship.tag} ${ship.alive ? `afloat, ${ship.hp | 0}/${ship.maxHp} hp` : 'SUNK'} after ${(game.time - t0).toFixed(0)} s`);
  const def = game.shipDefs.find(d => d.e === ship);
  console.log(`  shots ${shots.join(', ')}; ship SAMs left ${def.ammo}/${def.maxAmmo}; wingman ${w.alive ? 'alive' : 'SHOT DOWN'}, order ${w.order}, kills ${m.stats.wing}`);
  console.log('  radio:', wingSaid(t0).join(' / '));
}

if (has('air')) {
  console.log('\n=== DOGFIGHT: ATTACK MY TARGET (locked jet), THEN COVER ===');
  const w = start('air', 'air'), m = M(), shots = shotLog(w), t0 = game.time;
  console.log(`  loadout: ${w.ammoText()} | ${m.jets.length} bandits at ${m.jets.map(j => km(j.pos, P().pos)).join(', ')} km`);
  const j0 = m.jets.slice().sort((a, b) => a.pos.distanceTo(P().pos) - b.pos.distanceTo(P().pos))[0];
  P().sel = 'aim120'; P().radar.stt = j0; order(1);
  check(w.order === 'attack' && w.foe === j0, `O, 1 with ${j0.name} locked: order ${w.order}, after ${w.foe && w.foe.name}`);
  // the leader circles where the fight starts (flying straight on would take both of them over the city's SAMs).
  // Bandits that turn away dodge most missiles (the player's too), so kills are reported, not required.
  let wDef = 0;
  orbit(150, () => { if (w.state === 'defend') wDef++; return !j0.alive || !w.alive; });
  const atJ0 = shots.filter(s => s.tgt === j0);
  check(atJ0.length > 0 && atJ0[0].at - t0 < 90 && shots.every(s => s.key !== 'aim120' || s.R < 30000),
    `fired at ${j0.name} ${atJ0.length ? `${(atJ0[0].at - t0).toFixed(0)} s in` : 'never'}, radar missiles from ${shots.filter(s => s.key === 'aim120').map(s => (s.R / 1000).toFixed(0)).join(', ') || '-'} km (under 30)`);
  console.log(`  ${j0.name} ${j0.alive ? 'still flying' : `down (hit by ${j0.lastHitBy === w ? 'the wingman' : j0.lastHitBy && j0.lastHitBy.name})`} after ${(game.time - t0).toFixed(0)} s; wingman defended ${(wDef / 60).toFixed(0)} s, ${w.alive ? 'alive' : 'SHOT DOWN'}`);
  P().radar.stt = null;
  orbit(240, () => !w.alive || m.ended);
  console.log(`  cover 240 s: bandits left ${m.jets.filter(j => j.alive).length}, wingman kills ${m.stats.wing}, ${w.alive ? 'alive' : 'SHOT DOWN'}, status "${w.statusText()}", ammo ${w.ammoText()}, mission ${m.ended ? (m.success ? 'WON' : 'lost') : 'going'}`);
  console.log('  shots:', shots.join(', '));
  check(shots.length >= 2 && Number.isFinite(w.pos.x + w.pos.y + w.pos.z), `kept fighting: ${shots.length} missiles fired in ${(game.time - t0).toFixed(0)} s`);
  console.log('  radio:', wingSaid(t0).slice(0, 24).join(' / '));
  if (m.ended) { secs(9); console.log('  report:', report && report.items.map(i => `${i.ok ? '+' : '-'}${i.text}`).join(', ')); }
}

if (has('cat')) {
  console.log('\n=== CARRIER START: CATAPULT 2 ===');
  const w = start('carrier', 'multirole'), C = game.carrier, t0 = game.time;
  const loc = C.toLocal(w.pos.clone());
  check(!!w.deck && w.landed, `on deck: local x ${loc.x.toFixed(1)} y ${loc.y.toFixed(2)} z ${loc.z.toFixed(1)}, status "${w.statusText()}"`);
  check(!w.canFight || !game.aiJets.some(j => j.team === 'red' && j.canFight(w)), 'enemy jets cannot target him on deck');
  I.keys.add('ShiftLeft'); secs(2.2); I.keys.delete('ShiftLeft'); frames(12);
  press('KeyF'); secs(2.2);
  check(w.deck && w.deck.launchAt != null, `player's catapult shot: wingman launch at +${w.deck ? (w.deck.launchAt - game.time).toFixed(1) : '-'} s`);
  secs(2.0); I.keys.add('KeyS'); secs(1.5); I.keys.delete('KeyS'); press('KeyG');
  let minY = Infinity, off = null;
  secs(20, () => { if (!w.deck && off == null) off = game.time; if (off != null) minY = Math.min(minY, w.pos.y); });
  check(!w.deck && off != null && minY > 15 && w.alive, `wingman launched (${off == null ? '-' : (off - t0).toFixed(0)} s in), lowest ${minY.toFixed(0)} m, now ${w.pos.y.toFixed(0)} m at ${w.vel.length().toFixed(0)} m/s, gear ${w.gearK.toFixed(2)}`);
  console.log(`  player: ${P().pos.y.toFixed(0)} m, ${P().ac.tas.toFixed(0)} m/s, gear ${P().ac.gear.toFixed(2)}`);
  let joinT = null; const t1 = game.time;
  secs(120, () => { if (w.mode === 'form') { joinT = game.time - t1; return true; } return false; });
  check(joinT != null, `joined the leader ${joinT == null ? '-' : joinT.toFixed(0)} s after launch+20 s (${P().pos.distanceTo(w.pos).toFixed(0)} m), gear ${w.gearK.toFixed(2)}`);
  console.log('  radio:', wingSaid(t0).join(' / '));
}

if (has('misc')) {
  console.log('\n=== LANDING PRACTICE, RELAUNCH, SHOT DOWN ===');
  let w = start('approach', 'air');
  check(!w && !game.aiJets.some(j => j.isWingman), 'landing practice: no wingman');
  press('KeyO'); check(/NO WINGMAN/.test(msgs()), `O says: ${msgs()}`);
  const a = start('strike', 'strike'), r0 = game.world.radars.length;
  const b = start('strike', 'strike');
  check(a !== b && !game.aiJets.includes(a) && !game.world.entities.includes(a) && !game.scene.children.includes(a.root) && !game.world.radars.includes(a.radar) && game.world.radars.length === r0,
    `relaunch: the old wingman is gone (radars ${r0}→${game.world.radars.length}), one wingman flying (${game.aiJets.filter(j => j.isWingman).length})`);
  game.enterAttract(); frames(3); check(!game.wingman && !game.aiJets.some(j => j.isWingman), 'main menu: no wingman');
  w = start('air', 'air'); const t0 = game.time;
  const b1 = M().jets[1]; b1.damage(999, w, b1.pos); frames(3);
  check(!b1.alive && M().stats.wing === 1 && /YOUR WINGMAN SHOT DOWN/.test(msgs()) && wingSaid(t0).some(s => /splash one/.test(s)), `his kill is credited: wingman kills ${M().stats.wing}, "${msgs()}"`);
  const bandit = M().jets[0]; w.damage(999, bandit, w.pos);
  frames(5);
  check(!w.alive && /SHOT DOWN/.test(msgs()), `shot down: ${msgs()}`);
  console.log('  radio:', calls.filter(c => c.t >= t0).map(c => `${c.who}: ${c.text}`).join(' / '));
  press('KeyO'); check(!game.wingMenu && /FLY ALONE/.test(msgs()), 'O after he is lost: explains');
  check(w.statusText() === 'SHOT DOWN', `HUD status: ${w.statusText()}`);
  for (const j of M().jets) j.damage(999, P(), j.pos);
  secs(9);
  check(!!report && report.items.some(i => /WINGMAN SPEAR 1-2 SHOT DOWN/.test(i.text)), `debrief: ${report && report.items.map(i => `${i.ok ? '+' : '-'}${i.text}`).join(', ')}`);
  // practice: a lost wingman comes back with the player's respawn
  w = start('air', 'air'); w.damage(999, M().jets[0], w.pos); frames(3);
  game.opts.invulnerable = true; game.practiceRespawn(); frames(3);
  check(game.wingman && game.wingman !== w && game.wingman.alive && game.wingman.mode === 'form', 'practice respawn brings a new wingman, in formation');
  // gear down near the ship: he waits overhead instead of following the leader into the landing
  w = start('strike', 'strike'); for (const j of game.aiJets) if (j.team === 'red') { j.alive = false; j.root.visible = false; }
  const C = game.carrier; fly(C.pos.clone().add(new THREE.Vector3(0, 1200 - C.pos.y, 9000)), 0, 180); w.placeInSlot();
  P().ac.ctl.gearCmd = 1; secs(30);
  check(w.holding() && /SHIP/.test(w.statusText()) && w.pos.distanceTo(P().pos) > 500, `gear down near the ship: wingman "${w.statusText()}", ${km(w.pos, P().pos)} km from lead, ${km(w.pos, C.pos)} km from the ship`);
}

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall wingman checks passed');
process.exit(0);
