// Drives the in-game coach through the main flows and prints what the player would read.
import { installDOM } from './headless_env.mjs';
installDOM();
const THREE = await import('three');
const { Game } = await import('../src/game/game.js');
const { Guide } = await import('../src/ui/guide.js');
const el = () => ({ hidden: true, innerHTML: '', classList: { toggle() {} } });
const els = { coach: el(), 'keys-card': el() };
const game = new Game({ appendChild() { } }, { scenario: 'carrier', loadout: 'multirole', hour: 9.5, weather: 'clear', quality: 'low' });
await game.init(() => {});
const guide = new Guide(game, { getElementById: (id) => els[id] });
game.onFrame = (dt) => guide.update(dt);
let T = 0; game.last = 0; game.acc = 0; const I = game.input;
const frames = (n) => { for (let i = 0; i < n; i++) { T += 1000 / 60; game.frame(T); } };
const secs = (s) => frames(Math.round(s * 60));
const press = (code) => { I.keys.add(code); I.pressed.add(code); frames(1); I.keys.delete(code); frames(1); };
const show = (label) => {
  const txt = els.coach.innerHTML.replace(/<li class="(\w+)"><i>(.)<\/i>/g, '\n   [$1] ').replace(/<div class="c-alert (\w+)">/g, '\n  !$1! ').replace(/<div class="c-title">/, '\n  # ').replace(/<div class="c-tip">/, '\n   tip: ').replace(/<kbd>([^<]*)<\/kbd>/g, '[$1]').replace(/<[^>]+>/g, ' ').replace(/ +/g, ' ');
  console.log(`--- ${label} (coach hidden=${els.coach.hidden})${txt}`);
};
game.enterAttract(); frames(5); show('attract (menu)');
game.launch({ scenario: 'carrier', loadout: 'multirole' }); frames(12); show('carrier start');
I.keys.add('ShiftLeft'); secs(1.0); show('holding shift 1s'); secs(1.2); I.keys.delete('ShiftLeft'); frames(12); show('throttle at detent');
press('KeyF'); frames(12); show('after F');
secs(2.2); show('during stroke');
secs(2.0); show('just airborne');
I.keys.add('KeyS'); secs(1.5); I.keys.delete('KeyS'); press('KeyG'); secs(1); show('climbing, gear up');
secs(40); show('40 s later');
press('KeyT'); frames(12); show('after T');
// ground attack
press('Digit4'); frames(12); show('bombs selected (4)');
for (let k = 0; k < 6 && game.player.sel !== 'cbu'; k++) press('Digit4');
frames(12); show('cluster bomb selected');
// landing
game.launch({ scenario: 'approach', loadout: 'air' }); frames(12); show('approach start');
secs(6); show('approach +6 s');
// missile inbound alert
game.launch({ scenario: 'air', loadout: 'air', invulnerable: true });
const s = game.player.ac.s; s.p.set(-900, 5000, 26000); s.v.set(0, 0, -230); s.q.identity();
for (let i = 0; i < 40 && !game.world.missiles.some(m => m.team === 'red' && m.target === game.player); i++) secs(1);
frames(12); show('SAM shot at us');
// dead
game.playerKilled('SHOT DOWN'); frames(12); show('dead');
