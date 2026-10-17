// Radio traffic. Who talks: MAGIC (the E-2 radar plane watching the sky for you), MOTHER (the carrier), PADDLES
// (the landing signal officer), you (SPEAR 1-1), your wingman (SPEAR 1-2) and the odd intercepted enemy transmission. Every call is shown as
// the real brevity line with a plain-English line under it, and is spoken by the browser's speech voice when it has one.
// One speaker at a time: calls queue by priority, and stale ones (a launch call that waited too long) are dropped.
import * as THREE from 'three';
import { tagOf } from './world.js';

const D2R = Math.PI / 180;
const _f = new THREE.Vector3();
const FROM = { awacs: 'MAGIC', ship: 'MOTHER', lso: 'PADDLES', pilot: 'SPEAR 1-1', wing: 'SPEAR 1-2', enemy: 'INTERCEPT' };
export const CS = 'Spear 1-1';
const SAY_CS = 'Spear one-one';
const DIG = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const NUMW = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const pad3 = (n) => String(((Math.round(n) % 360) + 360) % 360 || 360).padStart(3, '0');
const digits = (s) => s.split('').map(d => DIG[+d] ?? d).join(' ');
// where something is, said the way a pilot thinks about it: clock position and a plain direction
const DIR = ['ahead', 'ahead', 'ahead-right', 'to your right', 'behind-right', 'behind-right', 'behind you', 'behind-left', 'behind-left', 'to your left', 'ahead-left', 'ahead'];
const ASPECT = { hot: 'hot', flank: 'flanking', beam: 'beam', drag: 'drag' };
const ASPECT_PLAIN = { hot: 'flying straight at you', flank: 'angling toward you', beam: 'crossing in front of you', drag: 'flying away from you' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const kmText = (m) => m < 10000 ? (m / 1000).toFixed(1) : String(Math.round(m / 1000));
const ftText = (ft) => Math.round(ft).toLocaleString('en-US');

export class Radio {
  constructor(game) {
    this.g = game; this.q = []; this.active = []; this.ver = 0; this.seq = 0; this.last = {}; this.sched = []; this.history = []; this.picT = 0;
  }
  clear() { this.q.length = 0; this.active.length = 0; this.sched.length = 0; this.last = { picture: this.g.time }; this.picT = 0; this.ver++; }
  // run fn after `delay` seconds of mission time (paused time doesn't count, so a briefing doesn't eat the call)
  later(delay, fn) { this.sched.push({ t: this.g.time + delay, fn }); }

  // who: awacs | ship | lso | pilot | wing | enemy. text: what is said on the radio. plain: what it means, in plain English.
  // o: key + every (rate limit), pri (higher jumps the queue), urgent (front of the queue), ttl (seconds a queued call
  //    stays relevant), say (spoken text when it differs from the subtitle; false = no voice), dur (on-screen time)
  call(who, text, plain, o = {}) {
    const t = this.g.time;
    if (o.key) { const l = this.last[o.key]; if (l != null && t - l < (o.every ?? 8)) return false; this.last[o.key] = t; }
    const words = (s) => (s ? s.split(/\s+/).length : 0);
    const it = { id: ++this.seq, who, from: o.from || FROM[who] || String(who).toUpperCase(), text, plain: plain || '', pri: o.pri || 1, at: t, ttl: o.ttl ?? 12, age: 0 };
    it.say = o.say === false || who === 'enemy' ? null : (o.say || text.replace(/Spear 1-1/g, SAY_CS).replace(/Spear 1-2/g, 'Spear one-two'));
    it.talk = Math.min(9, Math.max(1.4, words(text) * 0.34 + 0.3)); // channel busy while this is being said
    it.dur = o.dur || Math.max(4, it.talk + 1.8 + words(plain) * 0.16); // how long the subtitle stays up
    if (o.urgent) this.q.unshift(it); else { this.q.push(it); this.q.sort((a, b) => b.pri - a.pri); }
    if (this.q.length > 5) this.q.length = 5;
    return true;
  }

  update(dt) {
    const g = this.g;
    if (this.sched.length) { const due = this.sched.filter(s => g.time >= s.t); if (due.length) { this.sched = this.sched.filter(s => g.time < s.t); for (const s of due) s.fn(); } }
    let changed = false;
    for (const a of this.active) a.age += dt;
    const n0 = this.active.length; this.active = this.active.filter(a => a.age < a.dur); if (this.active.length !== n0) changed = true;
    const busy = this.active.some(a => a.age < a.talk);
    while (!busy && this.q.length) {
      const it = this.q.shift(); if (g.time - it.at > it.ttl) continue; // too late to matter
      this.active.push(it); if (this.active.length > 2) this.active.shift();
      if (it.say && g.audio) g.audio.speak(it.say, { voice: it.who, priority: it.pri });
      this.history.push(it); if (this.history.length > 40) this.history.shift();
      changed = true; break;
    }
    if (changed) this.ver++;
    this.watch(dt);
  }

  // ---------------- geometry for calls ----------------
  geo(pos, vel) {
    const P = this.g.player, f = P.ac.forward(_f);
    const hdg = Math.atan2(f.x, -f.z) / D2R;
    const dx = pos.x - P.pos.x, dz = pos.z - P.pos.z, rng = Math.hypot(dx, dz, pos.y - P.pos.y);
    const brg = (Math.atan2(dx, -dz) / D2R + 360) % 360;
    const rel = (((brg - hdg) % 360) + 360) % 360;
    const clock = Math.round(rel / 30) % 12 || 12;
    const G = { brg, rng, clock, dir: DIR[clock % 12], nm: Math.max(1, Math.round(rng / 1852)), km: kmText(rng), angels: Math.max(1, Math.round(pos.y * 3.28084 / 1000)), dAlt: pos.y - P.pos.y };
    if (vel) {
      const lx = P.pos.x - pos.x, lz = P.pos.z - pos.z, ll = Math.hypot(lx, lz) || 1, vl = Math.hypot(vel.x, vel.z) || 1;
      const a = Math.acos(Math.max(-1, Math.min(1, (lx * vel.x + lz * vel.z) / (ll * vl)))) / D2R;
      G.aspect = a < 35 ? 'hot' : a < 70 ? 'flank' : a < 115 ? 'beam' : 'drag';
    }
    return G;
  }
  braa(G) { return `BRAA ${pad3(G.brg)}/${G.nm}, ${G.angels} thousand${G.aspect ? ', ' + ASPECT[G.aspect] : ''}`; }
  sayBraa(G) { return `bra ${digits(pad3(G.brg))}, ${G.nm}, ${G.angels} thousand${G.aspect ? ', ' + ASPECT[G.aspect] : ''}`; }
  where(G, withAlt = true) {
    const alt = withAlt ? `, ${ftText(G.angels * 1000)} ft${G.dAlt > 600 ? ' (above you)' : G.dAlt < -600 ? ' (below you)' : ''}` : '';
    return `${G.km} km ${G.dir} (${G.clock} o'clock)${alt}`;
  }
  groups() {
    const jets = this.g.aiJets.filter(j => j.alive && j.team === 'red'), out = [];
    for (const j of jets) { const gr = out.find(x => x.lead.pos.distanceTo(j.pos) < 8000); if (gr) gr.n++; else out.push({ lead: j, n: 1 }); }
    for (const gr of out) gr.G = this.geo(gr.lead.pos, gr.lead.vel);
    out.sort((a, b) => a.G.rng - b.G.rng);
    return { jets, groups: out };
  }

  // ---------------- AWACS picture ----------------
  picture(o = {}) {
    const { jets, groups } = this.groups(); if (!jets.length) return false;
    const L = groups[0], G = L.G, n = jets.length;
    const head = groups.length === 1 ? 'single group' : `${NUMW[groups.length]} groups, nearest group`;
    const contacts = n === 1 ? 'one contact' : `${NUMW[n] || n} contacts`;
    const text = `${CS}, Magic, picture, ${head} ${this.braa(G)}, hostile, ${contacts}.${o.tail ? ' ' + o.tail : ''}`;
    const say = `${SAY_CS}, Magic, picture, ${head}, ${this.sayBraa(G)}, hostile, ${contacts}.${o.tail ? ' ' + o.tail : ''}`;
    const who = n === 1 ? 'One enemy fighter' : `${cap(NUMW[n] || String(n))} enemy fighters`;
    const plain = `${who}${groups.length > 1 ? ` in ${groups.length} groups` : ''}. ${groups.length > 1 ? 'Nearest: ' : ''}${this.where(G)}, ${ASPECT_PLAIN[G.aspect]}.${o.plainTail ? ' ' + o.plainTail : ''}`;
    this.last.picture = this.g.time;
    return this.call('awacs', text, plain, { say, pri: o.pri || 2, ttl: 6 });
  }
  // an enemy fighter has found you and turns in to attack
  commit(jet) {
    const g = this.g; if (!g.player.alive || g.attract || (g.mission && g.mission.kind && !g.mission.tasked)) return; // the tasking comes first
    const G = this.geo(jet.pos, jet.vel);
    const ok = this.call('awacs', `${CS}, Magic, bandit committing, ${this.braa(G)}, hostile.`,
      `An enemy fighter has spotted you and is coming to attack: ${this.where(G)}.`,
      { key: 'commit', every: 30, pri: 3, ttl: 6, say: `${SAY_CS}, Magic, bandit committing, ${this.sayBraa(G)}, hostile.` });
    if (ok) this.last.picture = g.time;
  }
  // missile fired at you
  launch(m, shooter) {
    const g = this.g; if (!g.player.alive || !shooter) return;
    const k = m.key, G = this.geo(shooter.pos);
    let what, sayWhat, plainWhat;
    if (k === 's400') { what = 'SA-21 launch'; sayWhat = 'S-A twenty-one launch'; plainWhat = 'The big SAM site fired a missile at you'; }
    else if (k === 'tor' && shooter.kind === 'ship') { what = 'naval SAM launch'; sayWhat = what; plainWhat = 'A warship fired a missile at you'; }
    else if (k === 'tor') { what = 'SA-15 launch'; sayWhat = 'S-A fifteen launch'; plainWhat = 'The short-range SAM fired a missile at you'; }
    else if (m.def.seeker === 'arh') { what = 'bandit launch, Fox three'; sayWhat = what; plainWhat = 'An enemy fighter fired a radar missile at you'; }
    else return;
    const many = this.last.launch != null && g.time - this.last.launch < 14;
    this.call('awacs', `${CS}, ${what}, your ${G.clock} o'clock${many ? ', multiple missiles' : ''}!`,
      `${plainWhat} from ${G.dir} (${G.clock} o'clock). Follow the BREAK cue and press X when it says NOW.`,
      { key: 'launch', every: 6, pri: 6, urgent: true, ttl: 4, say: `${SAY_CS}, ${sayWhat}, ${NUMW[G.clock]} o'clock!` });
  }

  // periodic: picture updates while bandits are out there, an urgent call if one gets behind you,
  // and a heads-up the first time you fly into a SAM's range
  watch(dt) {
    const g = this.g, P = g.player;
    if (g.attract || !P.alive || !g.mission || !g.mission.kind) return;
    this.picT -= dt; if (this.picT > 0) return; this.picT = 1;
    const { jets, groups } = this.groups();
    if (jets.length) {
      const L = groups[0], G = L.G;
      if (G.rng < 9000 && G.clock >= 4 && G.clock <= 8) {
        this.call('awacs', `${CS}, Magic, bandit, your six, ${G.nm} miles!`, `An enemy fighter is BEHIND you, ${G.km} km. Turn hard toward it and drop flares (X).`,
          { key: 'six', every: 25, pri: 5, urgent: true, ttl: 4, say: `${SAY_CS}, Magic, bandit, your six, ${G.nm} miles!` });
      } else if (G.rng < 75000 && G.rng > 14000 && g.time - (this.last.picture ?? -1e9) > 50 && (g.mission.kind === 'dogfight' || g.mission.tasked)) this.picture();
    }
    const M = g.mission;
    if (M.kind === 'strike' && (M.state === 'sead' || M.state === 'strike')) for (const z of M.threatRings ? M.threatRings() : []) {
      if (!z.alive || this.last['ring-' + z.id] != null) continue;
      if (Math.hypot(P.pos.x - z.x, P.pos.z - z.z) < z.r) this.call('awacs', z.text, z.plain, { key: 'ring-' + z.id, every: 1e9, pri: 2, ttl: 8, say: z.say });
    }
  }

  // ---------------- results ----------------
  killed(e) {
    const g = this.g;
    if (e.kind === 'air') {
      this.call('pilot', 'Splash one!', '', { pri: 3, ttl: 4, dur: 2.6, say: 'Splash one!' });
      const left = g.aiJets.filter(j => j.alive && j.team === 'red').length;
      if (left) this.call('awacs', `Magic copies, splash one. ${cap(NUMW[left] || String(left))} bandit${left > 1 ? 's' : ''} remaining.`, `Enemy fighter shot down. ${left} left.`, { pri: 2, ttl: 8 });
      else this.call('awacs', 'Magic copies, splash. Picture clean.', 'Enemy fighter shot down. The sky is clear.', { pri: 2, ttl: 8 });
    } else if (e.kind === 'ship') {
      this.call('awacs', `Good hits, Spear. ${tagOf(e) === 'ENEMY DESTROYER' ? 'The destroyer' : 'A frigate'} is burning and dead in the water.`, 'Enemy warship destroyed.', { pri: 2, ttl: 8, key: 'ship', every: 4 });
    } else if (!e.isBunker && !(g.mission && ((g.mission.defenses || []).includes(e) || (g.mission.launchers || []).includes(e)))) {
      this.call('awacs', 'Magic, good effects on target.', `${cap(tagOf(e).toLowerCase())} destroyed.`, { pri: 1, ttl: 6, key: 'gkill', every: 12 });
    }
  }
  // your own calls when a weapon leaves the jet
  fired(key) {
    const C = {
      aim120: ['Fox three!', 'You fired a radar missile.'], aim9x: ['Fox two!', 'You fired a heat-seeker.'], agm88: ['Magnum!', 'You fired an anti-radar missile.'],
      agm65: ['Rifle!', 'You fired a Maverick.'], agm84: ['Rifle!', 'You fired an anti-ship missile.'],
      gbu39: ['Bombs away.', 'Small guided bomb released.'], gbu31: ['Bombs away.', 'Bunker buster released.'], gbu12: ['Bombs away.', 'Laser bomb released.'], mk84: ['Bombs away.', 'Bomb released.'], cbu: ['Bombs away.', 'Cluster bomb released.'],
    }[key];
    if (C) this.call('pilot', `${CS}, ${C[0]}`, C[1], { key: 'fire-' + key, every: 2.5, pri: 2, ttl: 3, dur: 2.6, say: C[0] });
  }
  playerDown() {
    this.q.length = 0;
    this.call('awacs', `${CS} is down. Spear 1-1 is down. SAR is launching.`, 'Your jet was destroyed.', { pri: 9, urgent: true, ttl: 5, say: `${SAY_CS} is down. Search and rescue is launching.` });
  }
  bingo() {
    const g = this.g, G = this.geo(g.carrier.pos);
    this.call('ship', `${CS}, Mother, you're at bingo. Mother bears ${pad3(G.brg)} for ${G.nm}. Return to the ship.`, `Fuel is low. The carrier is ${G.km} km ${G.dir}: follow the blue marker home.${g.opts.realistic ? '' : ' Near the ship, gear down (G) and follow the green circle.'}`,
      { pri: 4, ttl: 10, say: `${SAY_CS}, Mother, you're at bingo. Mother bears ${digits(pad3(G.brg))} for ${G.nm}. Return to the ship.` });
  }
  rtb() {
    const g = this.g, G = this.geo(g.carrier.pos);
    this.call('ship', `${CS}, Mother, Case One recovery. Mother bears ${pad3(G.brg)} for ${G.nm}. Report the ball.`, `Time to come home. The carrier is ${G.km} km ${G.dir}: follow the blue marker. ${g.opts.realistic ? 'Land with gear (G) and hook (H) down.' : 'Near the ship, gear down (G) and follow the green circle: the landing assist lands you.'}`,
      { pri: 2, ttl: 10, say: `${SAY_CS}, Mother, case one recovery. Mother bears ${digits(pad3(G.brg))} for ${G.nm}.` });
  }
  // the escorts check in once per mission, so the player knows the carrier group is a safe place to run to
  escorts() {
    const g = this.g, n = g.ships.filter(s => s.team === 'blue' && s !== g.carrier && s.alive !== false).map(s => cap(s.name.toLowerCase()));
    if (!n.length || !g.player.alive) return;
    const list = n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0];
    this.call('ship', `${CS}, Mother. ${list} have the umbrella over the ship. Bring any bandits home to us.`,
      'The warships next to the carrier fire at enemy jets and missiles that come within about 10 km of them, and a jet under fire breaks off. If a bandit chases you, fly back to the carrier.',
      { pri: 1, ttl: 20, say: `${SAY_CS}, Mother. ${list} have the umbrella over the ship. Bring any bandits home to us.` });
  }
  // what the scenario opens with (called once the briefing is closed and time runs)
  opening(scenario) {
    const g = this.g, M = g.mission;
    if (scenario === 'carrier') {
      this.call('ship', `${CS}, Mother, cleared for launch, cat one. Contact Magic airborne.`, 'You are on the catapult. Follow the steps on the left to launch; the target city is 30 km north.', { pri: 2, ttl: 20 });
    } else if (scenario === 'deck') {
      this.call('ship', `${CS}, Mother, taxi to cat one for launch.`, 'Drive the jet onto the catapult: follow the steps on the left.', { pri: 2, ttl: 20 });
    } else if (scenario === 'approach') {
      this.call('lso', `${CS}, Paddles, you're on glide slope. Call the ball.`, 'Keep the orange ball level with the green lights and fly it onto the deck.', { pri: 2, ttl: 20 });
      this.later(4, () => { const lbs = (g.player.ac.fuel * 2.2046 / 1000).toFixed(1); this.call('pilot', `${CS}, Rhino ball, ${lbs}.`, `You report that you can see the ball (Rhino = Super Hornet) and have ${lbs} thousand pounds of fuel.`, { pri: 2, ttl: 8, dur: 4, say: `Rhino ball, ${lbs.replace('.', ' point ')}` }); });
      this.later(6.5, () => this.call('lso', 'Roger ball.', 'The landing officer is watching you all the way down.', { pri: 2, ttl: 8, dur: 3, say: 'Roger ball.' }));
    } else if (M && M.kind === 'dogfight') {
      M.tasked = true;
      this.picture({ pri: 3, tail: 'Cleared to engage.', plainTail: 'Shoot them all down.' });
      this.later(30, () => this.escorts());
    } else if (M && M.kind === 'strike') this.strikeIn();
  }
  // the strike tasking, from wherever the jet is (on the catapult this waits until you're airborne)
  strikeIn() {
    const g = this.g, M = g.mission; if (!M || !M.bunker) return;
    M.tasked = true;
    const G = this.geo(M.bunker.pos);
    const n = g.aiJets.filter(j => j.alive && j.team === 'red').length;
    this.call('awacs', `${CS}, Magic, radar contact. Target area bears ${pad3(G.brg)} for ${G.nm}. SAMs active around the target. ${n ? `${cap(NUMW[n])} bandit${n > 1 ? 's' : ''} capping north of the city. ` : ''}Cleared hot on the air defenses.`,
      `The target city is ${G.km} km ${G.dir}. Destroy its radars, SAMs and AA guns first${n ? `; ${n} enemy fighter${n > 1 ? 's' : ''} patrol north of it` : ''}.`,
      { pri: 3, ttl: 20, say: `${SAY_CS}, Magic, radar contact. Target area bears ${digits(pad3(G.brg))} for ${G.nm}. SAMs active. ${n ? `${NUMW[n]} bandits capping north of the city. ` : ''}Cleared hot on the air defenses.` });
    this.later(30, () => this.escorts());
  }
}
