// Weapons per mission (missionLoadout in src/game/player.js): every menu pick on every mission, the bunker busters a
// city strike always carries (also after F on the deck rearms the jet), and catapult shots with the strike load.
//   node test/loadout.mjs        Failed checks are listed at the end.
import { installDOM } from './headless_env.mjs';
installDOM();
const { Game } = await import('../src/game/game.js');
const { LOADOUTS } = await import('../src/game/player.js');
const game = new Game({ appendChild() { } }, { scenario: 'carrier', loadout: 'auto', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const frames = (n, f) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); if (f) f(i); } };
const secs = (s, f) => frames(Math.round(s * 60), f);
const press = (c) => { I.keys.add(c); I.pressed.add(c); frames(1); I.keys.delete(c); frames(1); };
const hold = (c, s) => { I.keys.add(c); secs(s); I.keys.delete(c); };
const fails = []; const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
game.mission.onEnd = () => {};
const P = game.player, M = game.mission;
const sigOf = (L) => Object.values(L).flatMap((k) => { const m = /x(\d)$/.exec(k); return Array(m ? +m[1] : 1).fill(m ? k.slice(0, -2) : k); }).sort().join();
const sig = () => P.stores.map(s => s.key).sort().join();
const list = () => P.inventory().filter(it => it.key !== 'C').map(it => `${it.n} ${it.name}`).join(', ');
const PICKS = ['auto', 'multirole', 'strike', 'air', 'cas'];

console.log('=== CITY STRIKE (carrier takeoff, air start, taxi start) ===');
for (const scenario of ['carrier', 'strike', 'deck']) {
  for (const pick of PICKS) {
    game.launch({ scenario, loadout: pick, invulnerable: true }); frames(3);
    const want = pick === 'auto' ? 'strike' : pick === 'air' ? 'multirole' : pick;
    const ok = pick === 'cas' ? P.count('agm65') === 4 && P.count('mk84') === 1 : sig() === sigOf(LOADOUTS[want]);
    check(M.kind === 'strike' && ok && P.count('gbu31') === 2, `${scenario} + ${pick}: ${list()}`);
    if (scenario === 'deck') continue;
    // both bunker busters dropped in the bunker phase, then land: F on the deck after the trap rearms
    M.state = 'strike';
    for (const s of P.stores.filter(s => s.key === 'gbu31')) { P.model.root.remove(s.mesh.root); P.stores.splice(P.stores.indexOf(s), 1); }
    game.ops.cat.state = 'none'; game.ops.trap = { done: true }; P.ac.onGround = true;
    const took = game.ops.actionKey(P.ac);
    check(took && P.count('gbu31') === 2 && game.msgs.some(m => /REARMED/.test(m.text)), `   landed with none, F: ${P.count('gbu31')} bunker busters, on the catapult: ${game.ops.cat.state}`);
  }
}
console.log('\n=== DOGFIGHT and CARRIER LANDING ===');
for (const scenario of ['air', 'approach']) {
  for (const pick of PICKS) {
    game.launch({ scenario, loadout: pick, invulnerable: true }); frames(3);
    const want = pick !== 'auto' ? pick : scenario === 'air' ? 'air' : 'multirole';
    check(sig() === sigOf(LOADOUTS[want]), `${scenario} + ${pick}: ${list()}`);
  }
}

console.log('\n=== CATAPULT SHOT, easy controls, hands off after the shot ===');
for (const pick of ['multirole', 'auto']) {
  game.launch({ scenario: 'carrier', loadout: pick, invulnerable: false }); game.opts.invulnerable = false; frames(30);
  hold('ShiftLeft', 2.5); hold('ShiftLeft', 0.8); press('KeyF');
  let minY = Infinity, t0 = null; const deckY = P.ac.s.p.y;
  secs(16, () => { if (game.ops.cat.state === 'none' && t0 == null) t0 = game.time; if (t0 != null && game.time - t0 > 0.5) minY = Math.min(minY, P.ac.s.p.y); });
  const kg = Math.round(P.ac.storesMass);
  check(P.alive && !P.ac.crashed && minY > 15, `${pick}: ${kg} kg of weapons, lowest ${minY.toFixed(0)} m (deck ${deckY.toFixed(0)} m), now ${P.ac.s.p.y.toFixed(0)} m at ${(P.ac.ias() * 1.944).toFixed(0)} kt`);
}

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall loadout checks passed');
process.exit(fails.length ? 1 : 0);
