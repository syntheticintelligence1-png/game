// Pre-flight briefing: a kneeboard card with a tactical map of the real terrain (threat rings, targets, fighter
// patrols, the route) and the tasking in plain English. It opens when a mission starts from the menu, with the
// sim paused until START MISSION; from the pause menu it reopens for review.
import { drawBriefMap, gridRef, MAP_EXT } from './briefmap.js';
import { STRIKE } from '../game/mission.js';

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kbd = (s) => s.replace(/\[([^\]]+)\]/g, (_, k) => `<kbd>${esc(k)}</kbd>`); // "[T]" -> <kbd>T</kbd>

const STRIKE_BRIEF = {
  kicker: 'Strike tasking · Spear 1-1 · F/A-18E Super Hornet',
  title: 'Operation Stone Gate',
  goal: 'Destroy the enemy command bunker under the HQ in the city.',
  situation: () => `Enemy commanders run the island's defenses from a hardened bunker beneath their headquarters downtown (grid ${gridRef(STRIKE.hq.x, STRIKE.hq.z)}). It is protected by an early-warning radar on the ridge, an SA-21 long-range SAM battery west of the city, an SA-15 next to the HQ and two AA guns. Two Su-27 fighters patrol north of the city, and three warships sit off the east coast.`,
  tasks: [
    { t: 'Knock out the 6 air-defense targets', d: 'Anti-radar missiles [5] kill radars from 20–30 km. Small guided bombs [3] glide 15–25 km onto anything you mark with [T].' },
    { t: 'Destroy the command bunker', d: 'Only the bunker buster [4] gets through the roof. Mark the bunker with [T] and press [Space] when the HUD says IN RANGE. No diving needed.' },
    { t: 'Optional: sink the warships', d: 'They fire SAMs out to 13 km and have close-in guns.', opt: true },
    { t: 'Come home', d: 'Land back on the carrier, or keep flying.' },
  ],
  threats: [
    ['SA-21 Growler', '24 km', 'Long-range radar SAM. Turn so it is beside you and drop chaff.'],
    ['SA-15 Gauntlet', '12 km', 'Short-range radar SAM next to the HQ.'],
    ['ZSU-23-4 ×2', '3 km', 'Radar-aimed AA guns. Stay above 11,000 ft or out of range.'],
    ['Su-27 Flanker ×2', '50 km', 'Fighters: radar missiles at long range, heat-seekers up close.'],
    ['Warships ×3', '13 km', 'Ship SAMs and guns. Optional target.'],
  ],
  tips: [
    'Missile coming? Turn until it is beside you (3 or 9 o’clock) and press [X] when the cue says NOW.',
    'Radars can’t see through hills. Fly low behind terrain and the chip at the bottom left reads RADAR: NOT SEEN.',
    'Everything under your wings makes you easier to see on radar. Drop the heavy stuff early.',
    'Chased by a fighter? Run for the carrier: its two destroyers and frigate fire at enemy jets and missiles within 10 km, and a jet under fire breaks off.',
  ],
};
const BRIEFS = {
  strike: { ...STRIKE_BRIEF, start: 'You start in the air 28 km south of the city, heading north.' },
  carrier: { ...STRIKE_BRIEF, start: 'You start on the carrier’s catapult, 30 km south of the city.' },
  deck: { ...STRIKE_BRIEF, start: 'You start parked on the carrier’s deck: taxi onto the catapult first.' },
  air: {
    kicker: 'Fighter sweep · Spear 1-1 · F/A-18E Super Hornet',
    title: 'Operation Clear Sky',
    goal: 'Shoot down all four enemy fighters over the island.',
    start: 'You start in the air south of the island, heading north.',
    situation: () => 'Four Su-27 Flankers fly two patrols over the island, guarding its airspace ahead of tomorrow’s strike. Clear them out. The city’s SAMs are still up, so stay out of the red rings.',
    tasks: [
      { t: 'Lock a fighter', d: '[T] picks the enemy nearest your nose and gets a missile ready ([T] again = next one).' },
      { t: 'Long range: radar missile', d: 'Fire [2] from 15–25 km. It guides itself, so you can turn away (that call is “Fox three”).' },
      { t: 'Close in: heat-seeker or gun', d: 'Under 8 km get behind it: fire [1] when it growls, or hold [C] for the gun.' },
    ],
    threats: [
      ['Su-27 Flanker ×4', '50 km', 'Agile fighters with radar and heat-seeking missiles.'],
      ['SA-21 / SA-15', '24 / 12 km', 'City SAMs: stay out of the red rings.'],
    ],
    tips: [
      'When they fire at you: turn so the missile is beside you and press [X] when the cue says NOW.',
      'Heat-seekers fired from behind give no radar warning. Hold [L] to look back now and then.',
      'Keep your speed up in a fight; a slow jet can’t dodge.',
      'In trouble? Run for the carrier: its two destroyers and frigate fire at enemy jets and missiles within 10 km, and a jet under fire breaks off.',
    ],
  },
  approach: {
    kicker: 'Carrier qualification · Spear 1-1 · F/A-18E Super Hornet',
    title: 'Case I Recovery',
    goal: 'Land on the carrier and catch one of the four arresting wires.',
    start: 'You start 2.6 km behind the ship, lined up, with gear and hook down.',
    situation: () => 'Clear weather over the ship. The landing signal officer (PADDLES) watches you all the way down and grades the landing by the wire you catch: wire 3 is perfect.',
    tasks: [
      { t: 'Stay lined up', d: 'Keep the deck’s center line straight ahead with small taps of [A] and [D].' },
      { t: 'Hold the glide slope', d: 'Keep the orange ball level with the green lights. Too high: a little less throttle. Too low: a little more.' },
      { t: 'Catch a wire', d: 'Fly it onto the deck without flaring. The box on the left coaches you the whole way.' },
    ],
    threats: [],
    tips: [
      'Your speed is right when the coach says ON SPEED; it reads your angle of attack.',
      'Missed the wires? Full throttle, fly off the end, come around and try again.',
    ],
    // with the easy controls the landing assist flies the approach (see LandingAssist in assist.js)
    easy: {
      tasks: [
        { t: 'Let the landing assist fly', d: 'It holds landing speed, the glide slope and the center line for you. Hands off is fine.' },
        { t: 'Nudge if you like', d: '[W] / [S] put the glide path a little lower / higher, [A] / [D] slide left / right. Nudges fade out near the deck, so they can’t crash you.' },
        { t: 'Catch a wire', d: 'At touchdown it goes to full power by itself in case the hook misses, and back to idle once a wire has stopped you.' },
      ],
      tips: [
        'Missed the wires? The jet climbs away by itself. Press [Enter] any time to start the approach over.',
        'Want to fly it all yourself? Tick Realistic controls in the menu.',
      ],
    },
  },
};
const WX = { clear: 'Clear', scattered: 'Few clouds', broken: 'Cloudy', overcast: 'Overcast' };
const WING_ORDERS = 'Press [O] for his orders, then a number: [1] attack the target you locked or marked with [T] · [2] cover me · [3] hunt on your own · [4] rejoin on me · [5] go home to the ship.';
const WING_STRIKE = `Spear 1-2 flies on your right wing and fights any enemy jet that comes near you. He carries small guided bombs, anti-radar missiles and an anti-ship missile, all fired from long range. He has no bunker buster: the bunker is yours. ${WING_ORDERS}`;
const WING_AIR = `Spear 1-2 flies on your right wing with eight air-to-air missiles and fights any enemy jet that comes near you. ${WING_ORDERS}`;

export class Briefing {
  constructor(game) {
    this.g = game; this.el = document.getElementById('briefing'); this.isOpen = false; this.cb = null;
    if (!this.el) return;
    this.canvas = document.getElementById('bf-canvas');
    document.getElementById('bf-start').addEventListener('click', () => this.close('start'));
    document.getElementById('bf-back').addEventListener('click', () => this.close('back'));
    this.el.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); this.close('start'); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(this.mode === 'review' ? 'start' : 'back'); }
    });
    addEventListener('resize', () => { if (this.isOpen) this.layout(); });
  }
  // mode 'start': a new mission (START MISSION / MAIN MENU); 'review': reopened mid-flight (BACK TO FLYING)
  open(scenario, mode, cb) {
    if (!this.el) { if (cb && cb.onStart) cb.onStart(); return; }
    const g = this.g, B0 = BRIEFS[scenario] || BRIEFS.carrier, B = B0.easy && !g.opts.realistic ? { ...B0, ...B0.easy } : B0;
    this.scenario = scenario; this.mode = mode; this.cb = cb || {};
    const $ = (id) => document.getElementById(id);
    $('bf-kicker').textContent = B.kicker;
    $('bf-title').textContent = B.title;
    $('bf-goal').textContent = B.goal;
    const tasks = B.tasks.map((t, i) => `<li class="${t.opt ? 'opt' : ''}"><i>${t.opt ? '+' : B.tasks.slice(0, i).filter(x => !x.opt).length + 1}</i><b>${esc(t.t)}</b><span>${kbd(esc(t.d))}</span></li>`).join('');
    const threats = B.threats.length
      ? `<table class="bf-threats"><tbody>${B.threats.map(([n, r, d]) => `<tr><th scope="row">${esc(n)}</th><td class="r">${esc(r)}</td><td>${esc(d)}</td></tr>`).join('')}</tbody></table>`
      : '<p>None. Just you and the deck.</p>';
    $('bf-text').innerHTML = `
      <section class="bf-sec"><h3>Situation</h3><p>${esc(B.situation())} ${esc(B.start)}</p></section>
      <section class="bf-sec"><h3>Your tasks</h3><ol class="bf-tasks">${tasks}</ol></section>
      <section class="bf-sec"><h3>Threats</h3>${threats}</section>
      <section class="bf-sec"><h3>Staying alive</h3><ul class="bf-tips">${B.tips.map(t => `<li>${kbd(esc(t))}</li>`).join('')}</ul></section>
      ${scenario === 'approach' ? '' : `<section class="bf-sec"><h3>Your wingman</h3><p>${kbd(esc(scenario === 'air' ? WING_AIR : WING_STRIKE))}</p></section>`}
      <section class="bf-sec"><h3>Radio</h3><p>You are <b>SPEAR 1-1</b>${scenario === 'approach' ? '' : ', your wingman is <b>SPEAR 1-2</b>'}. <b>MAGIC</b> is the radar plane that watches the sky for you, <b>MOTHER</b> is the carrier, <b>PADDLES</b> the landing officer. Every call shows up on the right of the screen with what it means in plain English.</p></section>`;
    // the facts strip: loadout, time, weather
    const inv = g.player.inventory().map(it => (it.key === 'C' ? `${it.name} gun, ${it.n} rounds` : `${it.n}× ${it.name}`));
    const hr = g.sky.hours ?? 9.5, hh = Math.floor(hr), mm = Math.round((hr - hh) * 60);
    const w = g.wind, wkt = Math.round(Math.hypot(w.x, w.z) * 1.944), wfrom = Math.round(((Math.atan2(-w.x, w.z) * 180 / Math.PI) + 360) % 360);
    $('bf-facts').innerHTML = [
      ['Callsign', scenario === 'approach' ? 'SPEAR 1-1' : 'SPEAR 1-1 · wingman SPEAR 1-2'],
      ['Weapons', inv.join(' · ')],
      ['Time', `${String(hh).padStart(2, '0')}${String(mm % 60).padStart(2, '0')} local${hr < 6 || hr > 19.5 ? ' · night' : ''}`],
      ['Weather', `${WX[g.opts.weather] || 'Few clouds'} · wind ${String(wfrom).padStart(3, '0')}° ${wkt} kt`],
    ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    $('bf-start').textContent = mode === 'review' ? 'BACK TO FLYING' : 'START MISSION';
    $('bf-back').hidden = mode === 'review';
    this.el.hidden = false; this.isOpen = true;
    this.layout();
    $('bf-start').focus({ preventScroll: true });
    this.el.scrollTop = 0;
  }
  // size the map to the screen (it keeps the chart's proportions) and redraw it
  layout() {
    const fig = document.getElementById('bf-figure');
    const aspect = (MAP_EXT.x1 - MAP_EXT.x0) / (MAP_EXT.z1 - MAP_EXT.z0);
    const twoCol = innerWidth > 860;
    let h = Math.round(Math.max(300, Math.min(innerHeight * 0.62, 660))), w = Math.round(h * aspect);
    if (!twoCol) { w = Math.min(w, Math.max(240, fig.parentElement.clientWidth)); h = Math.round(w / aspect); }
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    fig.style.width = twoCol ? `${w}px` : ''; // the legend wraps under the map instead of widening its column
    try { drawBriefMap(this.canvas, this.g, this.scenario); } catch (e) { console.warn('briefing map failed', e); }
  }
  close(how) {
    if (!this.isOpen) return;
    this.isOpen = false; this.el.hidden = true;
    const cb = this.cb || {}; this.cb = null;
    if (how === 'back') { if (cb.onBack) cb.onBack(); } else if (cb.onStart) cb.onStart();
  }
}
