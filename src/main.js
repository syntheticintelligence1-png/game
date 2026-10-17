// Boot: loading screen -> world generation -> live attract scene behind the menu -> launch.
import { Game } from './game/game.js';
import { Guide } from './ui/guide.js';
import { CommsView } from './ui/comms.js';
import { Briefing } from './ui/briefing.js';

const $ = (id) => document.getElementById(id);
const store = {
  get() { try { return JSON.parse(localStorage.getItem('aegis-spear-settings') || '{}'); } catch (e) { return {}; } },
  set(v) { try { localStorage.setItem('aegis-spear-settings', JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
const HOURS = { dawn: 6.7, morning: 9.5, noon: 12.5, dusk: 17.65, night: 22 };

function readForm() {
  const f = $('menu-form');
  return {
    scenario: f.querySelector('input[name="scenario"]:checked')?.value || 'carrier',
    loadout: $('opt-loadout').value, time: $('opt-time').value, weather: $('opt-weather').value,
    quality: $('opt-quality').value, invulnerable: $('opt-practice').checked, volume: +$('opt-volume').value / 100, realistic: $('opt-realistic').checked,
  };
}
function writeForm(s) {
  if (s.scenario) { const r = document.querySelector(`input[name="scenario"][value="${s.scenario}"]`); if (r) r.checked = true; }
  for (const [k, id] of [['loadout', 'opt-loadout'], ['time', 'opt-time'], ['weather', 'opt-weather'], ['quality', 'opt-quality']]) if (s[k]) $(id).value = s[k];
  if (s.invulnerable != null) $('opt-practice').checked = s.invulnerable;
  if (s.realistic != null) $('opt-realistic').checked = s.realistic;
  if (s.volume != null) $('opt-volume').value = Math.round(s.volume * 100);
}

async function boot() {
  const saved = store.get();
  writeForm(saved);
  // phones: the sim needs a keyboard; still show the live scene
  if (matchMedia('(pointer: coarse)').matches && innerWidth < 900) $('touch-note').hidden = false;
  const s = readForm();
  const quality = s.quality || (navigator.hardwareConcurrency <= 4 ? 'low' : 'medium');
  $('opt-quality').value = quality;
  const game = new Game($('stage'), { scenario: 'carrier', loadout: s.loadout, hour: HOURS[s.time] ?? 9.5, weather: s.weather, quality, invulnerable: s.invulnerable, volume: s.volume });
  window.__game = game;
  try {
    await game.init((msg, f) => { $('load-status').textContent = msg; $('load-bar').style.transform = `scaleX(${f})`; });
  } catch (e) {
    console.error(e);
    $('load-status').textContent = 'This browser could not start WebGL2. Try a recent Chrome, Edge, Firefox or Safari on a computer with a GPU.';
    $('load-error').hidden = false; $('load-error').textContent = String(e && e.message || e);
    return;
  }
  game.enterAttract();
  // on-screen coach + controls card + radio subtitles (they read game state only)
  const guide = new Guide(game), comms = new CommsView(game), briefing = new Briefing(game);
  game.onFrame = (dt) => { guide.update(dt); comms.update(dt); };
  game.startLoop();
  $('loading').hidden = true; $('menu').hidden = false;
  $('launch').focus({ preventScroll: true });

  // live preview of environment settings
  $('opt-time').addEventListener('change', () => game.setTime(HOURS[$('opt-time').value]));
  $('opt-weather').addEventListener('change', () => game.setWeather($('opt-weather').value));
  $('opt-quality').addEventListener('change', () => game.setQuality($('opt-quality').value));
  $('opt-volume').addEventListener('input', () => game.audio.setMasterVolume(+$('opt-volume').value / 100));

  // Launch straight from the button click: embedded/sandboxed frames can block form submission, and an
  // AudioContext there may never finish resuming, so audio starts in the background and never gates the launch.
  // A new mission opens its briefing first and the sim holds until START MISSION; retries skip it.
  const startMission = (o, brief) => {
    game.launch(o);
    if (!brief) { game.renderer.domElement.focus(); return; }
    game.paused = true; game.audio.setPaused(true);
    briefing.open(o.scenario || 'carrier', 'start', {
      onStart: () => { game.paused = false; game.audio.setPaused(false); game.input.pressed.clear(); game.renderer.domElement.focus(); },
      onBack: () => { game.paused = false; game.enterAttract(); $('menu').hidden = false; $('launch').focus({ preventScroll: true }); },
    });
  };
  const launch = () => {
    if ($('menu').hidden) return;
    const o = readForm(); store.set(o);
    game.audio.init().then(() => { game.audio.setMasterVolume(o.volume); game.audio.setPaused(!!game.paused); game.audio.uiConfirm(); }).catch(() => {});
    $('menu').hidden = true; $('pause').hidden = true;
    try { startMission({ ...o, hour: HOURS[o.time] }, true); } catch (err) { console.error('launch failed', err); $('menu').hidden = false; }
  };
  $('launch').addEventListener('click', launch);
  $('menu-form').addEventListener('submit', (e) => { e.preventDefault(); launch(); });
  $('menu-form').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'BUTTON') { e.preventDefault(); launch(); }
  });
  $('btn-fullscreen').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) { await document.documentElement.requestFullscreen(); try { await navigator.keyboard?.lock?.(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Escape']); } catch (e) { /* keyboard lock unavailable */ } }
      else await document.exitFullscreen();
    } catch (e) { $('fs-note').hidden = false; }
  });
  // mission debrief
  const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // one tip that matches how the mission was lost
  const failTip = (rep) => {
    if (/GROUND/.test(rep.headline)) return 'Tip: when the jet says PULL UP, hold S straight away. Over the hills, keep ALT above 3,000 ft unless you are hiding from radar.';
    if (/SEA/.test(rep.headline)) return 'Tip: when the jet says PULL UP, hold S straight away. Low over water it is hard to judge height: keep ALT above 500 ft.';
    if (/SHIP/.test(rep.headline)) return 'Tip: to land, put the gear down (G) and fly to the green circle behind the ship. The landing assist then flies the approach with you.';
    return rep.kind === 'strike' ? 'Tip: fire anti-radar missiles (5) from 20–30 km before you close in, and tap X/Z when a missile is coming. Ticking Practice in the menu lets you learn the run without being shot down.' : 'Tip: lock with T, fire the radar missile (2) from 15–25 km, then turn hard and drop flares (X) if one comes back at you.';
  };
  game.mission.onEnd = (rep) => {
    game.paused = true; game.audio.setPaused(true);
    const D = $('debrief'); D.classList.toggle('fail', !rep.success);
    $('db-kicker').textContent = rep.success ? 'MISSION COMPLETE' : 'MISSION FAILED';
    $('db-title').textContent = rep.headline;
    $('db-grade').textContent = rep.success ? `Grade ${rep.grade}` : failTip(rep);
    $('db-time').textContent = fmtTime(rep.time); $('db-kills').textContent = rep.kills; $('db-hp').textContent = `${Math.max(0, Math.round(rep.hp))}%`;
    $('db-list').innerHTML = rep.items.map(i => `<li class="${i.ok ? 'ok' : ''}${i.big ? ' big' : ''}"><i>${i.ok ? '✓' : '✗'}</i><span>${esc(i.text)}</span></li>`).join('');
    $('db-continue').hidden = !rep.success;
    D.hidden = false; (rep.success ? $('db-continue') : $('db-again')).focus({ preventScroll: true });
  };
  $('db-continue').addEventListener('click', () => { $('debrief').hidden = true; game.mission.state = 'rtb'; game.togglePause(false); game.comms.rtb(); game.renderer.domElement.focus(); });
  $('db-again').addEventListener('click', () => { $('debrief').hidden = true; game.togglePause(false); const o = readForm(); game.launch({ ...o, scenario: game.opts.scenario || o.scenario, hour: HOURS[o.time] }); game.renderer.domElement.focus(); });
  $('db-menu').addEventListener('click', () => { $('debrief').hidden = true; game.togglePause(false); game.enterAttract(); $('menu').hidden = false; });
  game.onPause = (p) => { if (game.attract) return; $('pause').hidden = !p; if (p) $('resume').focus({ preventScroll: true }); };
  $('resume').addEventListener('click', () => game.togglePause(false));
  $('restart').addEventListener('click', () => { game.togglePause(false); game.launch({ ...readForm(), hour: HOURS[readForm().time] }); });
  $('to-menu').addEventListener('click', () => { game.togglePause(false); game.enterAttract(); $('pause').hidden = true; $('menu').hidden = false; });
  for (const b of document.querySelectorAll('[data-scn]')) b.addEventListener('click', () => { game.togglePause(false); $('pause').hidden = true; startMission({ ...readForm(), scenario: b.dataset.scn, hour: HOURS[readForm().time] }, true); });
  $('pause-brief').addEventListener('click', () => {
    $('pause').hidden = true;
    briefing.open(game.opts.scenario || 'carrier', 'review', { onStart: () => { game.togglePause(false); game.input.pressed.clear(); game.renderer.domElement.focus(); } });
  });
}

boot();
