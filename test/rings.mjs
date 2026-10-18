// Ring course, headless: an empty range (no enemies, no wingman, a clean jet), rings that clear the terrain, a
// simple pilot flies all fourteen with the real flight model inside a sane time, then: a missed ring stays the next
// ring, Enter starts over without leaking rings, practice respawns at the last ring, a crash ends the run.
import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const { RING_R, fmtRace } = await import('../src/game/rings.js');
const game = new Game({ appendChild() { } }, { scenario: 'carrier', loadout: 'auto', hour: 10, weather: 'clear', quality: 'low' });
await game.init(() => {});
const { Guide } = await import('../src/ui/guide.js');
const el = () => ({ hidden: true, innerHTML: '', classList: { toggle() {} } });
const els = { coach: el(), 'keys-card': el() };
const guide = new Guide(game, { getElementById: (id) => els[id] });
game.onFrame = (dt) => guide.update(dt);
const coach = () => els.coach.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const frames = (n, f) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); if (f && f(i)) return true; } return false; };
const secs = (s, f) => frames(Math.round(s * 60), f);
const press = (code) => { I.keys.add(code); I.pressed.add(code); frames(1); I.keys.delete(code); frames(1); };
const P = () => game.player, M = game.mission, R = () => game.mission.ctl;
let fails = 0; const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) fails++; };
let report = null; M.onEnd = (r) => { report = r; };
const ringMeshes = () => game.scene.children.filter(o => o.geometry && o.geometry.type === 'TorusGeometry').length;
const fly = (o = {}) => { report = null; game.launch({ scenario: 'rings', loadout: 'auto', invulnerable: false, realistic: true, ...o }); frames(30); };

// ---- an empty range
fly();
check(M.kind === 'rings' && R() && R().id === 'rings' && M.state === 'race', `kind ${M.kind}, state ${M.state}`);
check(R().rings.length === 14 && ringMeshes() === 14, `14 rings in the scene (${ringMeshes()})`);
check(!game.wingman, 'no wingman');
check(!game.aiJets.some(j => j.alive && j.team === 'red') && !(game.drones || []).some(d => d.alive), 'no enemy jets or drones');
check(!(M.defenses || []).length && !(M.fleet || []).length && !game.sams.length, 'no air defenses, no warships');
const inv = P().inventory().map(i => `${i.name}×${i.n}`).join(' ');
check(P().count('aim9x') === 2 && P().inventory().filter(i => i.key !== 'C').length === 1, `clean jet: ${inv}`);
const r0 = R().rings[0].pos, toR0 = r0.clone().sub(P().pos).normalize(), fwd = P().ac.s.v.clone().normalize();
check(fwd.dot(toR0) > 0.97, `starts pointing at ring 1 (${(Math.acos(Math.min(1, fwd.dot(toR0))) * 57.3).toFixed(1)}° off)`);
check(/RING 1\/14/.test(M.objectiveText()), `objective: ${M.objectiveText()}`);
check(/Ring course: ring 1 of 14/.test(coach()), `coach: ${coach().slice(0, 160)}`);
const mk = game.buildMarkers();
check(mk.some(m => m.kind === 'join' && /RING 1\/14/.test(m.label)) && mk.some(m => m.kind === 'ring2'), 'HUD marks ring 1 and the ring after it');
// clearance: every ring floats above the ground under it, every straight leg clears the hills
const TR = game.terrain;
let lowRing = 1e9, lowLeg = 1e9, lowAt = '';
R().rings.forEach((r, i) => {
  lowRing = Math.min(lowRing, r.pos.y - RING_R - Math.max(0, TR.heightAt(r.pos.x, r.pos.z)));
  const a = i ? R().rings[i - 1].pos : P().pos;
  for (let k = 1; k < 40; k++) {
    const t = k / 40, x = a.x + (r.pos.x - a.x) * t, z = a.z + (r.pos.z - a.z) * t, y = a.y + (r.pos.y - a.y) * t;
    const cl = y - Math.max(0, TR.heightAt(x, z)); if (cl < lowLeg) { lowLeg = cl; lowAt = `leg ${i}→${i + 1}`; }
  }
});
check(lowRing > 60, `lowest ring bottom ${lowRing | 0} m above the ground`);
check(lowLeg > 80, `straight legs clear the ground by ${lowLeg | 0} m (closest ${lowAt})`);
console.log(`  course ${(R().length / 1000).toFixed(1)} km, par ${fmtRace(R().par)}; ring heights ${R().rings.map(r => r.pos.y | 0).join(' ')}`);

// ---- a simple pilot flies the whole course with the real flight model (realistic controls, stick driven directly)
const V = THREE.Vector3, saved = I.updateAxes; I.updateAxes = () => {};
const pilot = () => {
  const ac = P().ac, s = ac.s, C = R(), ring = C.next();
  const p = s.p, v = s.v.clone().normalize();
  const u = new V(0, 1, 0).applyQuaternion(s.q), r = new V(1, 0, 0).applyQuaternion(s.q);
  // aim short of the ring along its axis while far out, so the jet arrives lined up with it; past the finish, level
  // off at 600 m straight ahead
  const along = ring ? ring.pos.clone().sub(p).dot(ring.n) : 0;
  const aim = ring ? ring.pos.clone().addScaledVector(ring.n, -THREE.MathUtils.clamp(along * 0.35, 0, 900))
    : p.clone().add(new V(v.x, 0, v.z).normalize().multiplyScalar(4000)).setY(600);
  // terrain look-ahead: never let the flight path dip under 90 m above anything in the next 3 s
  let need = 0;
  for (const k of [0.5, 1, 1.5, 2, 3]) { const q = p.clone().addScaledVector(s.v, k); need = Math.max(need, Math.max(0, TR.heightAt(q.x, q.z)) + 90 - q.y); }
  if (need > 0) aim.y = Math.max(aim.y, p.y + need * 3 + 200);
  const t = aim.sub(p).normalize();
  const ang = Math.acos(THREE.MathUtils.clamp(t.dot(v), -1, 1));
  // lift wanted = turn toward the aim point + hold up against gravity; roll the lift onto it, then pull. Sustained
  // high g blacks the pilot out (player.js physiology), so the pull eases off as the G stress builds.
  const gs = P().gStress, gMax = gs > 0.75 ? 4.2 : gs > 0.45 ? 5.2 : 6.8;
  const lat = t.clone().addScaledVector(v, -t.dot(v));
  const L = lat.lengthSq() > 1e-8 ? lat.normalize().multiplyScalar(Math.min(ang * 28, gMax) * 9.81) : new V();
  L.add(new V(0, 9.81, 0).addScaledVector(v, -9.81 * v.y));
  const nzW = Math.min(L.length() / 9.81, gMax), phi = Math.atan2(L.dot(r), L.dot(u));
  I.axes.roll = THREE.MathUtils.clamp(phi * 2.5, -1, 1);
  const nzC = Math.abs(phi) < 0.8 ? nzW * Math.cos(phi) : 1;
  I.axes.pitch = THREE.MathUtils.clamp(nzC >= 1 ? (nzC - 1) / 6.5 : (nzC - 1) / 4, -0.5, 1);
  // about 485 kt: quick, but slow enough to make the canyon turns
  const spd = s.v.length();
  ac.ctl.throttle = spd > 262 ? 0.45 : spd < 238 ? 0.95 : 0.78;
};
fly();
const t0 = game.time, passT = []; let lastI = 0, minClear = 1e9, vSum = 0, vN = 0;
const done = secs(R().par * 2.5, () => {
  pilot();
  const p = P().pos; minClear = Math.min(minClear, p.y - Math.max(0, TR.heightAt(p.x, p.z)));
  vSum += P().ac.s.v.length(); vN++;
  if (R().i !== lastI) { lastI = R().i; passT.push((game.time - t0).toFixed(0)); }
  return report || !P().alive;
});
I.updateAxes = saved; I.axes.pitch = 0; I.axes.roll = 0;
// hands off after the finish: the easy controls level the wings and hold the nose up
game.opts.realistic = false;
console.log(`  pilot: rings ${R().i}/14 at ${passT.join(' ')} s, misses ${R().misses}, lowest ${minClear | 0} m, mean ${(vSum / Math.max(1, vN) * 1.944) | 0} kt, alive ${P().alive}, at ${P().pos.y | 0} m, climbing ${P().ac.s.v.y | 0} m/s`);
check(done && report && report.success, `the pilot finished: ${report && report.headline} · ${report && report.grade}`);
check(report && report.kind === 'rings' && report.rings && report.rings.n === 14 && report.rings.of === 14, `report rings ${report && JSON.stringify(report.rings)}`);
check(report && Math.abs(report.time - R().elapsed()) < 0.01 && report.time < R().par * 2.5, `time ${report && fmtRace(report.time)} (par ${fmtRace(R().par)})`);
check(report && report.items.some(i => /ALL 14 RINGS/.test(i.text)) && report.items.some(i => /NEW BEST TIME/.test(i.text)), `debrief: ${report && report.items.map(i => i.text).join(' | ')}`);
const stop = R().elapsed(); secs(2);
check(Math.abs(R().elapsed() - stop) < 0.01, 'the clock stops at the finish');
check(R().rings.every(r => !r.mesh.visible), 'flown rings are hidden');
check(/Course complete/.test(coach()) && /Enter/.test(coach()), `coach after the finish: ${coach().slice(0, 200)} (alive ${P().alive}, ${P().pos.y | 0} m)`);
// the next run knows the record
game.ringBest = report ? report.time : 0;

// ---- a missed ring stays the next ring
fly();
check(R().best === game.ringBest && game.ringBest > 0, `best time carried into the next run (${fmtRace(R().best)})`);
const put = (pos, dir, v = 200) => {
  const q = new THREE.Quaternion().setFromUnitVectors(new V(0, 0, -1), dir.clone().normalize());
  P().ac.reset(pos, q, dir.clone().normalize().multiplyScalar(v)); R().prevD = null;
};
const g0 = R().rings[0];
const side = new V().crossVectors(g0.n, new V(0, 1, 0)).normalize();
put(g0.pos.clone().addScaledVector(g0.n, -400).addScaledVector(side, 300), g0.n);
secs(4);
check(R().i === 0 && R().misses === 1, `flew past ring 1 outside it: still ring ${R().i + 1}, misses ${R().misses}`);
check(game.msgs.some(m => /MISSED RING 1/.test(m.text)), 'MISSED RING message');
put(g0.pos.clone().addScaledVector(g0.n, -400), g0.n);
secs(4, () => R().i === 1);
check(R().i === 1, `came back through it: next is ring ${R().i + 1}`);
check(game.msgs.some(m => /RING 1\/14/.test(m.text)), 'ring passed message');
secs(3);

// ---- Enter starts over, no rings left behind
press('Enter'); frames(30);
check(R().i === 0 && R().elapsed() < 1.5 && ringMeshes() === 14, `Enter: back to ring 1, clock ${R().clock()}, ${ringMeshes()} rings in the scene`);

// ---- practice: a crash puts the jet back just past the last ring flown, clock still running
fly({ invulnerable: true });
const g1 = R().rings[1];
put(R().rings[0].pos.clone().addScaledVector(R().rings[0].n, -300), R().rings[0].n); secs(3);
put(g1.pos.clone().addScaledVector(g1.n, -300), g1.n); secs(3);
check(R().i === 2, `two rings flown (${R().i})`);
const gx = R().rings[1].pos.clone(); gx.y = Math.max(0, TR.heightAt(gx.x, gx.z)) + 40;
put(gx, new V(0, -1, 0.2), 150);
const crashed = secs(5, () => !P().alive);
check(crashed, 'flew into the ground');
secs(8, () => P().alive);
const back = P().pos.distanceTo(g1.pos.clone().addScaledVector(g1.n, 250));
const toNext = R().rings[2].pos.clone().sub(P().pos).normalize();
check(P().alive && back < 60 && P().ac.s.v.clone().normalize().dot(toNext) > 0.95, `respawned ${back | 0} m from just past ring 2, pointing at ring 3`);
check(!M.ended && R().i === 2 && R().elapsed() > 10, `run continues: ring ${R().i + 1}, clock ${R().clock()}`);

// ---- for real: a crash ends the run
fly();
const gz = R().rings[0].pos.clone(); gz.y = 30;
put(gz, new V(0, -1, 0.1), 150);
secs(16, () => report);
check(report && !report.success && report.kind === 'rings' && report.rings.n === 0, `crash: ${report && report.headline}, success ${report && report.success}`);
check(!game.wingman && ringMeshes() === 14, 'still no wingman, rings intact until the next run');

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
