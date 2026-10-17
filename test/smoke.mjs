// Headless end-to-end run of the real game code: boots the world, then flies scripted scenarios and prints telemetry.
import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const { DEFS } = await import('../src/sim/weapons.js');

const which = (process.argv[2] || 'all').split(',');
const has = (k) => which.includes('all') || which.includes(k);
const game = new Game({ appendChild() { } }, { scenario: 'carrier', loadout: 'multirole', hour: 9.5, weather: 'scattered', quality: 'medium', invulnerable: false });
const t0 = Date.now();
await game.init((m, f) => { if (process.env.V) console.log('[init]', Math.round(f * 100) + '%', m); });
game.opts.realistic = true; // these tests drive the stick directly
console.log(`init ${Date.now() - t0} ms, programs compiled: ${game.renderer.getContext().__counts.programs}`);
let T = 0; game.last = 0; game.acc = 0;
const I = game.input;
function frames(n, each) { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); I.endFrame?.(); if (each) each(i); } }
const secs = (s, each) => frames(Math.round(s * 60), each);
const press = (code) => { I.pressed.add(code); I.keys.add(code); frames(1); I.keys.delete(code); };
const hold = (code, s, each) => { I.keys.add(code); secs(s, each); I.keys.delete(code); };
const ac = () => game.player.ac;
const fmt = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : String(v));
const tele = (label) => { const a = ac(), s = a.s; console.log(`${label.padEnd(16)} t=${fmt(game.time)} alt=${fmt(s.p.y)}m spd=${fmt(a.tas)}m/s ias=${fmt(a.ias() * 1.944, 0)}kt M${fmt(a.mach, 2)} pitch=${fmt(a.pitchDeg())} roll=${fmt(a.rollDeg())} hdg=${fmt(a.heading(), 0)} aoa=${fmt(a.alpha * 57.3)} nz=${fmt(a.nz, 2)} thr=${fmt(a.ctl.throttle, 2)} rpm=${fmt(a.rpm, 2)} ab=${fmt(a.ab, 2)} gear=${fmt(a.gear, 2)} gnd=${a.onGround} ${a.contactSurface || ''} crashed=${a.crashed ? a.crashed.kind : 'no'} hp=${fmt(game.player.hp, 0)}`); };
const msgs = () => game.msgs.map(m => m.text).join(' | ');
process.on('uncaughtException', (e) => { console.error('UNCAUGHT', e); process.exit(1); });

try {
  // ---------- attract ----------
  game.enterAttract(); frames(90);
  console.log('attract ok; draws/frame ~', game.renderer.getContext().__counts.draw / 91 | 0);

  if (has('cat')) {
    console.log('\n=== CATAPULT LAUNCH ===');
    game.launch({ scenario: 'carrier', loadout: 'multirole', hour: 9.5, weather: 'scattered' });
    frames(30); tele('on cat');
    hold('ShiftLeft', 2.5); tele('throttle mil'); frames(2); console.log('  msgs:', msgs());
    hold('ShiftLeft', 0.8); tele('throttle AB');
    press('KeyF'); console.log('  cat state:', game.ops.cat.state, msgs());
    secs(2.05); console.log('  cat state after salute delay:', game.ops.cat.state);
    for (let i = 0; i < 6; i++) { secs(0.5); tele('stroke/climb'); }
    for (let i = 0; i < 8; i++) { secs(1); tele('climb out'); }
    press('KeyG'); hold('ControlLeft', 0.6); secs(6); tele('gear up');
    secs(10); tele('cruise');
    // roll and pull
    const r0 = ac().rollDeg(); hold('KeyD', 1.0); tele('after 1s roll'); console.log('  roll change', fmt(ac().rollDeg() - r0));
    hold('KeyA', 0.9); secs(2); tele('level');
    let maxNz = 0; hold('KeyS', 3, () => { maxNz = Math.max(maxNz, ac().nz); }); tele('after pull'); console.log('  max nz during pull', fmt(maxNz, 2), 'maxG', fmt(ac().maxG, 2));
    secs(4); tele('release');
  }

  if (has('fm')) {
    console.log('\n=== FLIGHT MODEL: level flight / speed sweep ===');
    game.launch({ scenario: 'air', loadout: 'air', invulnerable: true });
    secs(1); tele('start');
    for (const thr of [0.8, 1.0]) { ac().ctl.throttle = thr; for (let i = 0; i < 6; i++) { secs(5); } tele('thr ' + thr); }
    ac().ctl.throttle = 0.6; secs(10); tele('thr 0.6');
    // stall / limiter test
    ac().ctl.throttle = 0.3; let maxA = 0; hold('KeyS', 8, () => { maxA = Math.max(maxA, ac().alpha * 57.3); }); tele('stall attempt'); console.log('  max AoA with limiter', fmt(maxA));
    secs(4); ac().ctl.throttle = 0.85; secs(10); tele('recover');
    press('KeyK'); ac().ctl.throttle = 0.5; maxA = 0; hold('KeyS', 3, () => { maxA = Math.max(maxA, ac().alpha * 57.3); }); tele('cobra pull'); console.log('  max AoA limiter OFF', fmt(maxA));
    secs(6); tele('after cobra'); press('KeyK');
  }

  if (has('aam')) {
    console.log('\n=== AIR-TO-AIR: AIM-120 + AIM-9X ===');
    game.launch({ scenario: 'air', loadout: 'multirole', invulnerable: true });
    secs(1); press('Digit2'); press('KeyT'); console.log('  lock:', game.player.radar.stt ? game.player.radar.stt.name : 'none', '|', msgs());
    const jets = game.aiJets.filter(j => j.alive);
    console.log('  AI jets:', jets.map(j => `${j.name} ${j.state} d=${(j.pos.distanceTo(game.player.pos) / 1000).toFixed(1)}km alt=${j.pos.y | 0}`).join('; '));
    if (game.player.radar.stt) {
      press('Space'); const m = game.lastMissile; console.log('  fired', m && m.def.name);
      for (let i = 0; i < 70 && m && !m.dead; i++) { secs(1); if (i % 5 === 0 || m.dead) console.log(`   t+${i + 1}s ${m.def.name} spd=${m.vel.length() | 0} alt=${m.pos.y | 0} R=${m.target ? (m.pos.distanceTo(m.target.pos) | 0) : '-'} active=${m.active} link=${m.datalink} track=${m.track ? (m.track.isChaff ? 'CHAFF' : m.track.name || 'obj') : 'none'} dead=${m.dead} ${m.reason || ''}`); }
      console.log('  target alive?', m.target.alive, 'hp', m.target.hp, '| AI state', m.target.state, '| msgs:', msgs());
    }
    // AIM-9X: put the player 2.5 km behind a live AI jet
    const tgt = game.aiJets.find(j => j.alive);
    if (tgt) {
      const s = ac().s; const back = tgt.vel.clone().normalize().multiplyScalar(-2500);
      s.p.copy(tgt.pos).add(back); s.v.copy(tgt.vel); s.q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), tgt.vel.clone().normalize()); s.w.set(0, 0, 0);
      game.player.radar.stt = null; press('Digit1'); secs(0.6); console.log('  9X lock:', game.player.seeker9.lock ? game.player.seeker9.lock.name : 'none');
      press('Space'); const m = game.lastMissile;
      for (let i = 0; i < 20 && m && !m.dead; i++) { secs(0.5); }
      console.log('  9X result:', m && m.reason, 'target alive', tgt.alive, 'hp', tgt.hp, 'flares left', tgt.flares);
    }
    console.log('  player alive', game.player.alive, 'hp', game.player.hp);
    // guns
    press('KeyC'); hold('KeyC', 1.0); console.log('  rounds left', game.player.gunRounds, 'bullets in flight', game.bullets.n);
  }

  if (has('sam')) {
    console.log('\n=== SAM ENGAGEMENT + NOTCH ===');
    game.launch({ scenario: 'air', loadout: 'strike' });
    const s = ac().s; s.p.set(-900, 5000, 26000); s.v.set(0, 0, -230); s.q.identity(); s.w.set(0, 0, 0); ac().ctl.throttle = 0.8;
    const sam = game.sams[0];
    for (let i = 0; i < 25; i++) { secs(1); if (i % 3 === 0) console.log(`   t${i} dist=${(game.player.pos.distanceTo(sam.track.pos) / 1000).toFixed(1)}km searchSees=${sam.searchR.canSee(game.world, game.player)} stt=${sam.trackR.stt === game.player} inflight=${sam.inFlight.length} rwr=${(game.player.rwr || []).map(e => e.label + ':' + e.level).join(',')}`); }
    // notch: beam the radar while descending below it
    { const los = sam.track.pos.clone().sub(s.p); los.y = 0; los.normalize(); const perp = new THREE.Vector3(-los.z, 0, los.x); s.v.copy(perp).multiplyScalar(230); s.v.y = -20; s.q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), perp.clone().add(new THREE.Vector3(0, -0.08, 0)).normalize()); }
    s.p.y = 500;
    for (let i = 0; i < 10; i++) { secs(0.5); }
    console.log('   after notch: stt=', sam.trackR.stt === game.player, 'missiles', game.world.missiles.filter(m => m.team === 'red').map(m => `${m.def.name} lost=${m.lostT.toFixed(1)} track=${!!m.track}`).join(';'));
    secs(8); console.log('   player hp', game.player.hp, 'alive', game.player.alive, msgs());
    // HARM
    if (game.player.alive) {
      s.p.set(-900, 3000, 30000); s.v.set(0, 0, -240); s.q.identity(); ac().ctl.throttle = 0.85;
      press('Digit5'); press('Space'); const m = game.lastMissile; console.log('   HARM fired', m && m.def.name, 'target', m && m.target && m.target.name);
      for (let i = 0; i < 90 && m && !m.dead; i++) secs(1);
      console.log('   HARM result', m && m.reason, '| track radar alive', sam.track.alive, '| emcon', sam.emcon.toFixed(1), msgs());
    }
  }

  if (has('ag')) {
    console.log('\n=== AIR-TO-GROUND: Mk-84 CCIP, GBU-12 CCRP, Maverick takeover ===');
    game.launch({ scenario: 'air', loadout: 'cas', invulnerable: true }); game.opts.invulnerable = true;
    const tank = game.tanks.find(t => t.team === 'red' && t.e.alive).e;
    const s = ac().s; s.p.set(tank.pos.x, 2500, tank.pos.z + 3500); s.v.set(0, -60, -200); s.q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), s.v.clone().normalize()); s.w.set(0, 0, 0);
    for (let k = 0; k < 6 && game.player.sel !== 'mk84'; k++) press('Digit4'); console.log('  selected', game.player.sel);
    const fc = game.player.fireControl(); console.log('  CCIP impact', fc.ccip ? fc.ccip.point.toArray().map(v => v | 0) : 'none', 'tof', fc.ccip && fc.ccip.time.toFixed(1), 'tank at', tank.pos.toArray().map(v => v | 0));
    press('Space'); const bomb = game.lastMissile; for (let i = 0; i < 40 && bomb && !bomb.dead; i++) secs(0.5);
    console.log('  Mk-84 impact at', bomb.pos.toArray().map(v => v | 0), 'reason', bomb.reason);
    // GBU-12 with TGP designation
    s.p.set(tank.pos.x + 200, 4000, tank.pos.z + 7000); s.v.set(0, 0, -220); s.q.identity(); s.w.set(0, 0, 0);
    press('Digit4'); for (let k = 0; k < 6 && game.player.sel !== 'gbu12'; k++) press('Digit4');
    press('KeyT'); console.log('  TGP target', game.player.tgp.target && game.player.tgp.target.name, 'laser', game.player.tgp.laser.on, msgs());
    I.keys.add('Space'); I.pressed.add('Space'); let rel = false;
    for (let i = 0; i < 600 && !rel; i++) { frames(1); if (game.lastMissile && game.lastMissile.key === 'gbu12' && !game.lastMissile.dead) rel = true; }
    I.keys.delete('Space');
    const g12 = game.lastMissile; console.log('  CCRP released', rel, game.player.ccrp ? 'ttr ' + game.player.ccrp.timeToRelease.toFixed(1) : '');
    for (let i = 0; i < 80 && g12 && !g12.dead; i++) secs(0.5);
    const tgt = game.player.tgp.target; console.log('  GBU-12 reason', g12 && g12.reason, 'impact', g12 && g12.pos.toArray().map(v => v | 0), 'target', tgt && tgt.pos.toArray().map(v => v | 0), 'alive', tgt && tgt.alive);
    // Maverick with seeker takeover + manual steer
    s.p.set(tank.pos.x - 300, 2000, tank.pos.z + 6000); s.v.set(0, -20, -200); s.q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), s.v.clone().normalize());
    press('Digit3'); press('KeyT'); press('Space'); const mav = game.lastMissile;
    console.log('  Maverick', mav && mav.def.name, 'cam mode', game.rig.mode, 'target', mav && mav.target && mav.target.name);
    I.mouse.dx = 5; frames(2); console.log('  manual?', mav.manual);
    for (let i = 0; i < 60 && mav && !mav.dead; i++) secs(0.5);
    console.log('  Maverick reason', mav.reason, 'cam mode', game.rig.mode); secs(2); console.log('  cam mode after loss', game.rig.mode);
    console.log('  kills', game.kills, msgs());
  }

  if (has('trap')) {
    console.log('\n=== ARRESTED LANDING ===');
    game.launch({ scenario: 'approach', loadout: 'air' });
    // simple LSO-style autopilot: hold on-speed AoA with throttle, fly the ball with pitch, lineup with roll
    let tr = 0; const log = [];
    for (let i = 0; i < 60 * 70; i++) {
      const a = ac(); const o = game.ops;
      if (!a.onGround && !o.wire) {
        a.ctl.throttle = Math.min(0.79, Math.max(0.2, 0.62 + (a.alpha * 57.3 - 8.1) * 0.06 + (-o.ball) * 0.12 - (a.s.v.y - game.carrier.vel.y + 3.8) * 0.02));
        const pitchCmd = THREE.MathUtils.clamp(-o.ball * 0.6 - (a.s.v.y - game.carrier.vel.y + 3.6) * 0.15, -0.6, 0.6);
        I.axes.pitch = pitchCmd;
        const bankWant = THREE.MathUtils.clamp(-o.lineup * 6, -20, 20); I.axes.roll = THREE.MathUtils.clamp((bankWant - a.rollDeg()) * 0.05, -0.8, 0.8);
      } else { I.axes.pitch = 0; I.axes.roll = 0; a.ctl.throttle = o.wire ? 0 : a.ctl.throttle; }
      // keep keyboard ramp from overriding
      const save = { ...I.axes }; T += 1000 / 60; I.updateAxes = () => { I.axes.pitch = save.pitch; I.axes.roll = save.roll; I.axes.yaw = 0; }; game.frame(T);
      if (i % 120 === 0) log.push(`t=${game.time.toFixed(0)} rng=${o.rangeToTD | 0} ball=${o.ball.toFixed(2)} lu=${o.lineup.toFixed(1)} aoa=${(a.alpha * 57.3).toFixed(1)} vs=${(a.s.v.y - game.carrier.vel.y).toFixed(1)} thr=${a.ctl.throttle.toFixed(2)} gnd=${a.onGround}`);
      if (o.wire && !tr) { tr = 1; log.push(`ENGAGED wire ${o.trap.wire} at t=${game.time.toFixed(1)} relspd=${(a.s.v.clone().sub(game.carrier.vel).length()).toFixed(1)}`); }
      if (o.trap && o.trap.done && tr === 1) { tr = 2; log.push(`STOPPED: payout=${o.wirePayout && o.wirePayout.toFixed(1)}m maxG=${a.maxG.toFixed(1)} grade=${o.trap.grade}`); }
      if (a.crashed || !game.player.alive) { log.push('CRASH ' + (a.crashed && a.crashed.kind)); break; }
      if (tr === 2 && i > 0) break;
    }
    console.log(log.join('\n')); console.log(msgs());
  }

  if (has('cams')) {
    console.log('\n=== CAMERAS / SENSORS / PAUSE ===');
    game.launch({ scenario: 'air', loadout: 'multirole' });
    for (const k of ['F1', 'KeyV', 'KeyV', 'KeyV', 'KeyV', 'F2', 'F3', 'F4', 'F5', 'KeyR', 'KeyX', 'KeyZ', 'KeyB', 'KeyH', 'KeyG', 'KeyL', 'KeyI']) { press(k); frames(5); }
    press('Escape'); frames(3); console.log('  paused', game.paused); press('Escape'); frames(3);
    console.log('  mode', game.rig.mode, '| sensor', game.sensorMain, '|', msgs());
  }
  console.log('\nSMOKE DONE. missiles in world:', game.world.missiles.length, 'particles:', game.fx.ps.alpha.n, game.fx.ps.add.n, 'trails:', game.fx.trails.trails.length);
} catch (e) { console.error('FAILED:', e); process.exit(1); }
