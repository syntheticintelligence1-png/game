// Boot: loading screen -> world generation -> live attract scene behind the menu -> launch.
import { Game } from './game/game.js';
import { Guide } from './ui/guide.js';
import { CommsView } from './ui/comms.js';
import { Briefing } from './ui/briefing.js';
import { TheaterMap } from './ui/theater.js';
import { STAGES } from './game/campaign.js';
import { fmtRace } from './game/rings.js';

const $ = (id) => document.getElementById(id);
const keep = (key) => ({
  get() { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return {}; } },
  set(v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
});
const store = keep('aegis-spear-settings');
// campaign progress: { done: { stageId: best grade letter } }
const progress = keep('aegis-spear-campaign');
// ring course best time: { best: seconds }
const ringRecord = keep('aegis-spear-rings');
const HOURS = { dawn: 6.7, morning: 9.5, noon: 12.5, dusk: 17.65, night: 22 };
let campStage = 0;

// the five stage buttons under the campaign card: done ones show their best grade, the next one says NEXT
function renderStages() {
  const done = progress.get().done || {};
  const next = STAGES.findIndex((s) => !done[s.id]);
  $('camp-row').innerHTML = STAGES.map((s, i) => `<button type="button" data-stage="${i}" class="${i === campStage ? 'sel' : ''}" aria-pressed="${i === campStage}"><b>${i + 1}</b><span>${s.name}</span><i>${done[s.id] ? `✓ ${done[s.id]}` : i === next ? 'NEXT' : ''}</i></button>`).join('');
  const st = STAGES[campStage];
  $('camp-note').textContent = `Stage ${campStage + 1}: ${st.goal}`;
}
function syncMenu() {
  const scn = $('menu-form').querySelector('input[name="scenario"]:checked')?.value, camp = scn === 'campaign';
  $('camp-pick').hidden = !camp;
  const best = ringRecord.get().best;
  $('loadout-note').textContent = camp ? 'Campaign stages always carry their own weapons for the job.'
    : scn === 'rings' ? `The ring course flies light: two heat-seekers and the gun, nothing else. ${best ? `Your best time: ${fmtRace(best)}.` : 'No best time yet.'}`
      : 'Whatever you pick, the city strike always carries bunker busters, also after rearming.';
  if (camp) renderStages();
}

function readForm() {
  const f = $('menu-form');
  return {
    scenario: f.querySelector('input[name="scenario"]:checked')?.value || 'carrier', stage: campStage,
    loadout: $('opt-loadout').value, time: $('opt-time').value, weather: $('opt-weather').value,
    quality: $('opt-quality').value, invulnerable: $('opt-practice').checked, volume: +$('opt-volume').value / 100, realistic: $('opt-realistic').checked,
  };
}
function writeForm(s) {
  if (s.scenario) { const r = document.querySelector(`input[name="scenario"][value="${s.scenario}"]`); if (r) r.checked = true; }
  if (s.stage != null && STAGES[s.stage]) campStage = s.stage;
  for (const [k, id] of [['loadout', 'opt-loadout'], ['time', 'opt-time'], ['weather', 'opt-weather'], ['quality', 'opt-quality']]) if (s[k]) $(id).value = s[k];
  if (s.invulnerable != null) $('opt-practice').checked = s.invulnerable;
  if (s.realistic != null) $('opt-realistic').checked = s.realistic;
  if (s.volume != null) $('opt-volume').value = Math.round(s.volume * 100);
}

async function boot() {
  const saved = store.get();
  // a weapons pick saved before Automatic existed starts over on Automatic
  if (saved.weaponsV !== 2) delete saved.loadout;
  writeForm(saved);
  syncMenu();
  for (const r of document.querySelectorAll('input[name="scenario"]')) r.addEventListener('change', syncMenu);
  $('camp-row').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-stage]'); if (!b) return;
    campStage = +b.dataset.stage; renderStages();
  });
  // phones: the sim needs a keyboard; still show the live scene
  if (matchMedia('(pointer: coarse)').matches && innerWidth < 900) $('touch-note').hidden = false;
  const s = readForm();
  const quality = s.quality || (navigator.hardwareConcurrency <= 4 ? 'low' : 'medium');
  $('opt-quality').value = quality;
  const game = new Game($('stage'), { scenario: 'carrier', loadout: s.loadout, hour: HOURS[s.time] ?? 9.5, weather: s.weather, quality, invulnerable: s.invulnerable, volume: s.volume });
  window.__game = game;
  game.ringBest = ringRecord.get().best || 0;
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
  const guide = new Guide(game), comms = new CommsView(game), briefing = new Briefing(game), theater = new TheaterMap(game);
  game.onFrame = (dt) => { guide.update(dt); comms.update(dt); theater.update(dt); };
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
    const o = readForm(); store.set({ ...o, weaponsV: 2 });
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
    if (rep.kind === 'rings') return 'Tip: smooth beats fast. Ease off with Ctrl before the canyon turns, line up with the orange ring while you fly through the green one, and when the jet says PULL UP, hold S straight away. Ticking Practice in the menu puts you back at the last ring after a crash.';
    if (/GROUND/.test(rep.headline)) return 'Tip: when the jet says PULL UP, hold S straight away. Over the hills, keep ALT above 3,000 ft unless you are hiding from radar.';
    if (/SEA/.test(rep.headline)) return 'Tip: when the jet says PULL UP, hold S straight away. Low over water it is hard to judge height: keep ALT above 500 ft.';
    if (/SHIP/.test(rep.headline)) return 'Tip: to land, put the gear down (G) and fly to the green circle behind the ship. The landing assist then flies the approach with you.';
    if (/CARRIER/.test(rep.headline)) return 'Tip: meet each wave far out, north of the ship. Lock the anti-ship missiles first (T, then radar missiles with 2); the drones are slow enough for the gun (hold C). Press N to see where everything is.';
    return rep.kind === 'strike' ? 'Tip: fire anti-radar missiles (5) from 20–30 km before you close in, and tap X/Z when a missile is coming. Ticking Practice in the menu lets you learn the run without being shot down.'
      : rep.kind === 'naval' ? 'Tip: fire the Harpoons (3) from 20–40 km and turn away; their SAMs reach 13 km. Fire two at a time so one gets through.'
        : 'Tip: lock with T, fire the radar missile (2) from 15–25 km, then turn hard and drop flares (X) if one comes back at you.';
  };
  let nextStage = null;
  game.mission.onEnd = (rep) => {
    game.paused = true; game.audio.setPaused(true);
    const D = $('debrief'); D.classList.toggle('fail', !rep.success);
    const S = rep.stage;
    // campaign: keep the best grade per stage and move the menu on to the next stage
    nextStage = null;
    if (S && rep.success) {
      const p = progress.get(), done = p.done || {}, g = (rep.grade || 'C')[0], was = done[S.id];
      done[S.id] = !was || g < was ? g : was; progress.set({ ...p, done });
      if (!S.last) { nextStage = S.i + 1; campStage = nextStage; store.set({ ...store.get(), stage: campStage }); }
    }
    // ring course: keep the best time on this computer
    const race = rep.kind === 'rings';
    let record = false;
    if (race && rep.success) {
      const was = ringRecord.get().best;
      record = !was || rep.time < was;
      if (record) { ringRecord.set({ best: rep.time }); game.ringBest = rep.time; }
    }
    $('db-kicker').textContent = S ? (rep.success ? (S.last ? 'OPERATION TRIDENT COMPLETE' : `STAGE ${S.i + 1} OF ${STAGES.length} COMPLETE`) : `STAGE ${S.i + 1} FAILED`)
      : race ? (rep.success ? (record ? 'RING COURSE · NEW BEST TIME' : 'RING COURSE COMPLETE') : 'RING COURSE · DID NOT FINISH')
        : rep.success ? 'MISSION COMPLETE' : 'MISSION FAILED';
    $('db-next').hidden = nextStage == null;
    if (nextStage != null) $('db-next').textContent = `NEXT: ${STAGES[nextStage].name}`;
    $('db-title').textContent = rep.headline;
    $('db-grade').textContent = rep.success ? `Grade ${rep.grade}` : failTip(rep);
    $('db-time').textContent = race ? fmtRace(rep.time) : fmtTime(rep.time); $('db-hp').textContent = `${Math.max(0, Math.round(rep.hp))}%`;
    $('db-kills-l').textContent = race ? 'Rings' : 'Targets hit';
    $('db-kills').textContent = race && rep.rings ? `${rep.rings.n}/${rep.rings.of}` : rep.kills;
    $('db-list').innerHTML = rep.items.map(i => `<li class="${i.ok ? 'ok' : ''}${i.big ? ' big' : ''}"><i>${i.ok ? '✓' : '✗'}</i><span>${esc(i.text)}</span></li>`).join('');
    // after the ring course, flying it again is the natural next step
    $('db-continue').hidden = !rep.success;
    $('db-continue').classList.toggle('primary', nextStage == null && !race);
    $('db-again').classList.toggle('primary', race);
    D.hidden = false; (nextStage != null ? $('db-next') : rep.success && !race ? $('db-continue') : $('db-again')).focus({ preventScroll: true });
  };
  $('db-next').addEventListener('click', () => {
    if (nextStage == null) return;
    $('debrief').hidden = true; game.togglePause(false);
    const o = readForm(); startMission({ ...o, scenario: 'campaign', stage: nextStage, hour: HOURS[o.time] }, true);
  });
  $('db-continue').addEventListener('click', () => { $('debrief').hidden = true; game.mission.state = 'rtb'; game.togglePause(false); game.comms.rtb(); game.renderer.domElement.focus(); });
  // fly the same mission again (the campaign stage just flown, not the one the menu moved on to)
  $('db-again').addEventListener('click', () => { $('debrief').hidden = true; game.togglePause(false); const o = readForm(); game.launch({ ...o, scenario: game.opts.scenario || o.scenario, stage: game.opts.stage ?? o.stage, hour: HOURS[o.time] }); game.renderer.domElement.focus(); });
  $('db-menu').addEventListener('click', () => { $('debrief').hidden = true; game.togglePause(false); game.enterAttract(); $('menu').hidden = false; syncMenu(); });
  game.onPause = (p) => { if (game.attract) return; $('pause').hidden = !p; if (p) $('resume').focus({ preventScroll: true }); };
  $('resume').addEventListener('click', () => game.togglePause(false));
  $('restart').addEventListener('click', () => { const o = readForm(); game.togglePause(false); game.launch({ ...o, scenario: game.opts.scenario || o.scenario, stage: game.opts.stage ?? o.stage, hour: HOURS[o.time] }); });
  $('to-menu').addEventListener('click', () => { game.togglePause(false); game.enterAttract(); $('pause').hidden = true; $('menu').hidden = false; syncMenu(); });
  for (const b of document.querySelectorAll('[data-scn]')) b.addEventListener('click', () => { game.togglePause(false); $('pause').hidden = true; startMission({ ...readForm(), scenario: b.dataset.scn, hour: HOURS[readForm().time] }, true); });
  $('pause-brief').addEventListener('click', () => {
    $('pause').hidden = true;
    briefing.open(game.opts.scenario || 'carrier', 'review', { onStart: () => { game.togglePause(false); game.input.pressed.clear(); game.renderer.domElement.focus(); } });
  });
}

boot();
