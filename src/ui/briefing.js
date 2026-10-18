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
  rings: {
    kicker: 'Training range · Spear 1-1 · F/A-18E Super Hornet',
    title: 'Ring Course',
    goal: 'Fly through all 14 rings in order, as fast as you can.',
    start: 'You start in the air over the sea south of the island, pointing at ring 1.',
    situation: () => 'No enemies today: the range is closed to everyone but you. Fourteen glowing rings lead from the sea up the west side of the island and back: low over the sea, down the airfield runway, over the western canyon and the mountains, down the central canyon, over the city towers and the port, and home over the sea. The clock starts the moment you do.',
    tasks: [
      { t: 'Fly through the green ring', d: 'The next ring is green and has a green circle on the HUD (an arrow at the screen edge when it is behind you). The orange ring is the one after it.' },
      { t: 'Set up the next turn early', d: 'Line up with the orange ring while you go through the green one: [A] / [D] to bank, [S] to pull round, [W] to push the nose down.' },
      { t: 'Beat the par time', d: 'Under par with no misses is an A. Your best time is saved on this computer.' },
    ],
    threats: [],
    noThreats: 'None. Just you, the hills and the clock.',
    tips: [
      'Missed a ring? It stays green: turn around and fly through it. [Enter] starts the course over.',
      'Speed wins, but not in the canyon: ease off with [Ctrl] before the tight turns and [Shift] back up after.',
      'When the jet says PULL UP, hold [S] straight away.',
      'Ticking Practice in the menu puts you back at the last ring if you crash.',
    ],
    solo: true,
  },
};
// Operation Trident, the campaign: one briefing per stage (campaign.js), keyed by stage id
const TRIDENT = (n, what) => `Operation Trident · stage ${n} of 5 · ${what} · Spear 1-1`;
const STAGE_BRIEFS = {
  air: {
    kicker: TRIDENT(1, 'fighter sweep'), title: 'Clear the Sky',
    goal: 'Shoot down the four enemy fighters and the spy drone that tells them where you are.',
    start: 'You start in the air south of the island, heading north.',
    situation: () => 'Operation Trident takes the island back in five steps, and every step leaves the island the way you left it. First the sky: four Su-27 Flankers patrol over the island, and an enemy spy drone circles high over the strait reporting every move you make. The city’s SAMs are still up, so stay out of the red rings.',
    tasks: [
      { t: 'Shoot down the spy drone', d: 'It is slow and unarmed. Lock it with [T] and fire a radar missile [2], or get close and hold [C] for the gun. While it lives, the fighters always know where you are.' },
      { t: 'Shoot down the four fighters', d: 'Radar missiles [2] from 15–25 km; heat-seekers [1] or the gun [C] up close.' },
    ],
    threats: [
      ['Su-27 Flanker ×4', '50 km', 'Fighters with radar and heat-seeking missiles.'],
      ['Spy drone (UAV)', '—', 'Unarmed, but tells the fighters where you are.'],
      ['SA-21 / SA-15', '24 / 12 km', 'City SAMs: stay out of the red rings.'],
    ],
    tips: ['When they fire at you: turn so the missile is beside you and press [X] when the cue says NOW.', 'Press [N] for the live theater map at any time; [J] speeds up time on the long flights.', 'In trouble? Run for the carrier: its escorts fire at enemy jets within 10 km.'],
  },
  sead: {
    kicker: TRIDENT(2, 'air-defense suppression'), title: 'Blind Their Radars',
    goal: 'Destroy every radar, SAM site and AA gun around the city. Leave the bunker for the next stage.',
    start: 'You start in the air 28 km south of the city, heading north.',
    situation: () => 'Their fighters are gone. Now the city’s air defenses: an early-warning radar on the ridge, the SA-21 battery west of the city, an SA-15 next to the HQ and two AA guns. A friendly MQ-9 Reaper drone circles high over the city and marks every target it sees on your HUD. One enemy fighter is still flying.',
    tasks: [
      { t: 'Kill the radars from far away', d: 'Anti-radar missiles [5] from 20–30 km. They fly to the radar by themselves.' },
      { t: 'Bomb the AA guns', d: 'Small guided bombs [3]: mark a gun with [T], release when the HUD says IN RANGE (15–25 km), no diving needed.' },
      { t: 'Use the Reaper’s marks', d: 'Orange diamonds on the HUD are targets the Reaper drone found for you, even far away.', opt: true },
    ],
    threats: [
      ['SA-21 Growler', '24 km', 'Long-range radar SAM. Turn so it is beside you and drop chaff.'],
      ['SA-15 Gauntlet', '12 km', 'Short-range radar SAM next to the HQ.'],
      ['ZSU-23-4 ×2', '3 km', 'AA guns. Stay above 11,000 ft.'],
      ['Su-27 Flanker ×1', '50 km', 'The last enemy fighter.'],
    ],
    tips: ['Radars can’t see through hills: fly low behind terrain and the chip at the bottom left reads RADAR: NOT SEEN.', 'Missile coming? Turn until it is beside you and press [X] when the cue says NOW.'],
  },
  bunker: {
    kicker: TRIDENT(3, 'strike'), title: 'Hit the Bunker',
    goal: 'Destroy the command bunker under the HQ with the bunker buster.',
    start: 'You start in the air 28 km south of the city, with Hammer flight 3 km off your left wing.',
    situation: () => `The big SAM site and the early-warning radar are smoking ruins. The enemy has an SA-15 and two AA guns back up around the HQ (grid ${gridRef(STRIKE.hq.x, STRIKE.hq.z)}). Hammer 2-1 and 2-2, two friendly Hornets, fly in with you to take out the guns and the jets parked at the airfield, and the Reaper is back overhead. Two enemy fighters are up. Listen to the radio: the enemy may hit back at the carrier while you are away.`,
    tasks: [
      { t: 'Destroy the command bunker', d: 'Only the bunker buster [4] gets through the roof. Mark the bunker with [T] and press [Space] when the HUD says IN RANGE.' },
      { t: 'Let Hammer flight take the guns', d: 'They attack the SA-15, the AA guns and the airfield on their own.', opt: true },
      { t: 'Come home', d: 'Land back on the carrier, or keep flying.' },
    ],
    threats: [
      ['SA-15 Gauntlet', '12 km', 'Short-range radar SAM next to the HQ.'],
      ['ZSU-23-4 ×2', '3 km', 'AA guns around the HQ.'],
      ['Su-27 Flanker ×2', '50 km', 'Fighters.'],
      ['Attack drones ×4', '—', 'They go for the carrier, not you. The escorts handle them.'],
    ],
    tips: ['Release from high up (over 20,000 ft) and the guns can’t reach you.', 'Press [N] for the live theater map: it shows Hammer flight, the Reaper and the drones.'],
  },
  naval: {
    kicker: TRIDENT(4, 'anti-ship strike'), title: 'Sink the Fleet',
    goal: 'Sink the enemy destroyer and both frigates with Harpoon anti-ship missiles.',
    start: 'You start in the air south-east of the island, heading for the warships.',
    situation: () => 'The command bunker is gone. The enemy’s last strength is its surface group off the east coast: a destroyer and two frigates, with a spy drone watching over them and two fighters overhead. You carry five Harpoons; Spear 1-2 carries two.',
    tasks: [
      { t: 'Sink the three warships', d: 'Press [3] for the Harpoon, mark a ship with [T] and fire from 20–40 km. One hit sinks a frigate; the destroyer takes two.' },
      { t: 'Stay outside 13 km', d: 'Their SAMs reach 13 km and can shoot Harpoons down: fire from far out, turn away, fire again.' },
      { t: 'Shoot down the spy drone', d: 'It tells the fighters where you are.', opt: true },
    ],
    threats: [
      ['Warships ×3', '13 km', 'Ship SAMs and close-in guns; they shoot at your Harpoons too.'],
      ['Su-27 Flanker ×2', '50 km', 'Fighters.'],
      ['Spy drone (UAV)', '—', 'Reports your position.'],
    ],
    tips: ['A Harpoon flies low over the waves by itself. You can watch one with [F3].', 'Fire two at the destroyer at once: if their guns get one, the other gets through.'],
  },
  defense: {
    kicker: TRIDENT(5, 'fleet defense'), title: 'Hold the Line',
    goal: 'Three waves of attack drones and anti-ship missiles are coming for the carrier. Shoot them down before they reach the ships.',
    start: 'You start in the air 6 km north of the carrier, heading north.',
    situation: () => 'With no fleet left, the enemy throws everything it has at our carrier group: swarms of one-way attack drones and sea-skimming anti-ship missiles, in three waves from the north. Our two destroyers and the frigate fire at anything within about 10 km. You and Spear 1-2 are the outer shield.',
    tasks: [
      { t: 'Meet the drones far out', d: 'They fly slow and low (250 m). Lock with [T] and fire [1] or [2], or get behind one and hold [C] for the gun.' },
      { t: 'Kill the missiles', d: 'They skim the sea at 900 km/h. Lock early with [T] and fire radar missiles [2].' },
      { t: 'Keep the carrier afloat', d: 'If the carrier sinks, the stage is lost. The HUD top-left shows its health.' },
    ],
    threats: [
      ['Attack drones', '—', 'Slow and low; each one that hits a ship explodes.'],
      ['Anti-ship missiles', '—', 'Very fast, just above the waves; they hit much harder.'],
    ],
    tips: ['Watch the radio: Mother calls each wave and the direction it comes from.', 'Run out of missiles? Land on the carrier ([G] near the ship), press [F] to rearm on the catapult.', 'Press [N] for the live theater map: every drone is on it.'],
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
    const g = this.g, st = scenario === 'campaign' && g.mission.stage;
    const B0 = (st && STAGE_BRIEFS[st.id]) || BRIEFS[scenario] || BRIEFS.carrier, B = B0.easy && !g.opts.realistic ? { ...B0, ...B0.easy } : B0;
    const airWing = st ? st.wing === 'air' : scenario === 'air';
    this.scenario = scenario; this.mode = mode; this.cb = cb || {};
    const $ = (id) => document.getElementById(id);
    $('bf-kicker').textContent = B.kicker;
    $('bf-title').textContent = B.title;
    $('bf-goal').textContent = B.goal;
    const tasks = B.tasks.map((t, i) => `<li class="${t.opt ? 'opt' : ''}"><i>${t.opt ? '+' : B.tasks.slice(0, i).filter(x => !x.opt).length + 1}</i><b>${esc(t.t)}</b><span>${kbd(esc(t.d))}</span></li>`).join('');
    const threats = B.threats.length
      ? `<table class="bf-threats"><tbody>${B.threats.map(([n, r, d]) => `<tr><th scope="row">${esc(n)}</th><td class="r">${esc(r)}</td><td>${esc(d)}</td></tr>`).join('')}</tbody></table>`
      : `<p>${esc(B.noThreats || 'None. Just you and the deck.')}</p>`;
    const solo = scenario === 'approach' || B.solo;
    $('bf-text').innerHTML = `
      <section class="bf-sec"><h3>Situation</h3><p>${esc(B.situation())} ${esc(B.start)}</p></section>
      <section class="bf-sec"><h3>Your tasks</h3><ol class="bf-tasks">${tasks}</ol></section>
      <section class="bf-sec"><h3>Threats</h3>${threats}</section>
      <section class="bf-sec"><h3>${B.solo ? 'Tips' : 'Staying alive'}</h3><ul class="bf-tips">${B.tips.map(t => `<li>${kbd(esc(t))}</li>`).join('')}</ul></section>
      ${solo ? '' : `<section class="bf-sec"><h3>Your wingman</h3><p>${kbd(esc(airWing ? WING_AIR : WING_STRIKE))}</p></section>`}
      <section class="bf-sec"><h3>Radio</h3><p>You are <b>SPEAR 1-1</b>${solo ? '' : ', your wingman is <b>SPEAR 1-2</b>'}. <b>MAGIC</b> is the radar plane that watches the sky for you, <b>MOTHER</b> is the carrier, <b>PADDLES</b> the landing officer. Every call shows up on the right of the screen with what it means in plain English.</p></section>`;
    // the facts strip: loadout, time, weather
    const inv = g.player.inventory().map(it => (it.key === 'C' ? `${it.name} gun, ${it.n} rounds` : `${it.n}× ${it.name}`));
    const hr = g.sky.hours ?? 9.5, hh = Math.floor(hr), mm = Math.round((hr - hh) * 60);
    const w = g.wind, wkt = Math.round(Math.hypot(w.x, w.z) * 1.944), wfrom = Math.round(((Math.atan2(-w.x, w.z) * 180 / Math.PI) + 360) % 360);
    $('bf-facts').innerHTML = [
      ['Callsign', solo ? 'SPEAR 1-1' : 'SPEAR 1-1 · wingman SPEAR 1-2'],
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
