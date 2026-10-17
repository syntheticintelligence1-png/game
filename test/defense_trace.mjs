import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const game = new Game({ appendChild() { } }, { scenario: 'strike', loadout: 'strike', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const frames = (n, f) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); if (f && f(i)) return true; } return false; };
game.mission.onEnd = () => {};
const threat = process.argv[2] || 'sam', mode = process.argv[3] || 'defend';
game.launch({ scenario: 'strike', loadout: 'strike', invulnerable: false }); game.opts.invulnerable = false;
const P = game.player, ac = P.ac, s = ac.s;
for (const j of game.aiJets) if (threat !== 'jet') j.alive = false; else j.pos.set(s.p.x, 6500, s.p.z - 28000);
if (threat === 'sam') { const tgt = game.sams[0].track.pos; s.p.set(tgt.x + 3000, 5000, tgt.z + 19000); }
if (threat === 'jet') s.p.set(2500, 6000, 20000);
s.v.set(0, 0, -230); s.q.identity(); s.w.set(0, 0, 0); ac.ctl.throttle = 0.85;
// log the damage sources
const origDamage = P.damage.bind(P);
P.damage = (amt, src, pt) => { console.log(`  >>> DAMAGE ${amt.toFixed(0)} from ${src && (src.name || src.key || src.kind)} at dist ${pt ? pt.distanceTo(P.pos).toFixed(1) : '?'} m; hp before ${P.hp | 0}`); origDamage(amt, src, pt); };
let cmT = 0, t = 0, last = -1;
frames(60 * 70, () => {
  t += 1 / 60; cmT -= 1 / 60;
  for (const k of ['KeyA', 'KeyD', 'KeyS', 'KeyW']) I.keys.delete(k);
  const th = game.threatInfo();
  if (mode === 'defend' && th) {
    if (th.turn < 0) { I.keys.add('KeyA'); I.keys.add('KeyS'); } else if (th.turn > 0) { I.keys.add('KeyD'); I.keys.add('KeyS'); }
    else if (th.radar && s.p.y > 900) I.keys.add('KeyW');
    if (th.cmNow && cmT <= 0) { I.keys.add('KeyX'); I.pressed.add('KeyX'); cmT = 0.7; }
  }
  if (th && Math.floor(t * 2) !== last) {
    last = Math.floor(t * 2); const m = th.m;
    const radar = m.radar; const stt = radar ? radar.stt === P : null;
    console.log(`t=${t.toFixed(1)} ${m.def.name} d=${(th.d / 1000).toFixed(2)}km tti=${th.tti.toFixed(1)} mSpd=${m.vel.length() | 0} aCmd=${(m.aCmd.length() / 9.81).toFixed(1)}g | brg=${th.bearing.toFixed(0)} turn=${th.turn} | jet hdg=${ac.heading().toFixed(0)} bank=${ac.rollDeg().toFixed(0)} alt=${s.p.y | 0} spd=${(ac.ias() * 1.944) | 0}kt g=${ac.nz.toFixed(1)} | radarSTT=${stt} lostT=${m.lostT.toFixed(1)} track=${m.track ? (m.track.isChaff ? 'CHAFF' : m.track.isFlare ? 'FLARE' : 'JET') : '-'} | chaff=${game.world.chaff.length} flares=${game.world.flares.length}`);
  }
  if (!P.alive) { console.log('KILLED at t', t.toFixed(1)); return true; }
  return false;
});
