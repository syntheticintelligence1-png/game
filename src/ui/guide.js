// In-game coach: a plain-English "what to press right now" card that follows what the player is doing,
// plus a compact controls card that stays on screen (Tab hides/shows it).
// It only reads game state; it never changes the simulation.
import * as THREE from 'three';
import { DEFS } from '../sim/weapons.js';
import { JET } from '../sim/flight.js';
import { tagOf } from '../game/world.js';
import { WAVES } from '../game/campaign.js';
import { fmtRace } from '../game/rings.js';

const KT = 1.94384, FT = 3.28084;
const _f = new THREE.Vector3(), _j = new THREE.Vector3();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kb = (...keys) => keys.map((x) => `<kbd>${esc(x)}</kbd>`).join('');
const GROUND_WEAPONS = new Set(['agm65', 'agm84', 'agm88', 'gbu12', 'gbu31', 'gbu39', 'mk84', 'cbu']);
const GROUND_KINDS = new Set(['ground', 'sam', 'structure', 'ship']);
const CARD_MIN_W = 280, CARD_MAX_W = 388; // outer width of the coach / controls cards (px)
const KEYS_FOLD_GAP = 10, KEYS_UNFOLD_GAP = 30; // px between coach and controls card (unfold needs more: no flicker)

export class Guide {
  constructor(game, doc = document) {
    this.g = game; this.doc = doc;
    this.coach = doc.getElementById('coach');
    this.keysCard = doc.getElementById('keys-card');
    this.last = ''; this.t = 0;
    this.launchedAt = -1e9; this.prevCat = 'none';
    let open = true;
    try { const v = localStorage.getItem('aegis-keys-open'); open = v != null ? v === '1' : true; } catch (e) { open = true; }
    // folded: the coach needs the controls card's room right now; forced: Tab asked for the card anyway
    this.keysOpen = open; this.keysFolded = false; this.keysForced = false; this.keysH = 0; this.measuredAt = ''; this.cardW = 0;
    this.applyKeys();
  }

  keysShown() { return this.keysOpen && (!this.keysFolded || this.keysForced); }
  toggleKeys() {
    if (this.keysShown()) { this.keysOpen = false; this.keysForced = false; } else { this.keysOpen = true; this.keysForced = this.keysFolded; }
    this.applyKeys();
    try { localStorage.setItem('aegis-keys-open', this.keysOpen ? '1' : '0'); } catch (e) { /* storage unavailable */ }
  }
  applyKeys() { this.keysCard.classList.toggle('collapsed', !this.keysShown()); }

  update(dt) {
    const g = this.g;
    const show = !g.attract;
    this.coach.hidden = !show; this.keysCard.hidden = !show;
    if (!show) { this.last = ''; this.keysForced = false; return; }
    if (g.input.hit('Tab')) this.toggleKeys();
    const cs = g.ops.cat.state;
    if (cs === 'stroke' && this.prevCat !== 'stroke') this.launchedAt = g.time;
    this.prevCat = cs;
    this.t -= dt; if (this.t > 0) return; this.t = 0.15;
    const html = this.render(this.compute());
    if (html !== this.last) { this.coach.innerHTML = html; this.last = html; }
    this.layout();
  }

  // Card width: as wide as the gap left of the HUD allows. The controls card folds to its one-line form while the
  // coach would run into it (short windows, long alerts) and comes back when there is room again.
  layout() {
    const K = this.keysCard, root = this.doc.documentElement;
    if (!K.getBoundingClientRect || !this.coach.getBoundingClientRect || !root) return; // no layout to measure (headless tests)
    const W = innerWidth, H = innerHeight, half = this.g.hud ? this.g.hud.cssHalfW : 0;
    const cw = Math.round(Math.min(W - 32, Math.max(CARD_MIN_W, Math.min(CARD_MAX_W, W / 2 - half - 26))));
    if (cw !== this.cardW) { this.cardW = cw; root.style.setProperty('--card-w', `${cw}px`); }
    this.g.cardRight = 16 + cw;
    // height of the open card: measured while it is open, or by opening it for one layout pass after a resize
    // (and every few seconds, in case the web fonts arrived and changed the text wrapping)
    const at = `${cw}x${H}:${Math.floor(performance.now() / 3000)}`;
    if (!K.classList.contains('collapsed')) { this.keysH = K.getBoundingClientRect().height; this.measuredAt = at; }
    else if (this.measuredAt !== at) { K.classList.remove('collapsed'); this.keysH = K.getBoundingClientRect().height; this.measuredAt = at; K.classList.add('collapsed'); }
    const coachBottom = this.coach.getBoundingClientRect().bottom, keysTop = K.getBoundingClientRect().bottom - this.keysH;
    const fold = coachBottom + (this.keysFolded ? KEYS_UNFOLD_GAP : KEYS_FOLD_GAP) > keysTop;
    if (fold !== this.keysFolded) { this.keysFolded = fold; this.applyKeys(); }
  }

  // where something is, in words: "6.2 km, 40° to your right"
  where(pos) {
    const s = this.g.player.ac.s; const f = this.g.player.ac.forward(_f);
    const dx = pos.x - s.p.x, dz = pos.z - s.p.z;
    let rel = (Math.atan2(dx, -dz) - Math.atan2(f.x, -f.z)) * 180 / Math.PI; rel = ((rel % 360) + 540) % 360 - 180;
    const km = Math.hypot(dx, dz) / 1000;
    const dir = Math.abs(rel) < 12 ? 'straight ahead' : Math.abs(rel) > 150 ? 'behind you' : rel > 0 ? `${Math.round(rel)}° to your right` : `${Math.round(-rel)}° to your left`;
    return { km, rel, text: `${km.toFixed(1)} km, ${dir}` };
  }

  compute() {
    const g = this.g, P = g.player, ac = P.ac, s = ac.s, c = ac.ctl, ops = g.ops;
    const out = { title: '', steps: [], tip: '', alerts: [] };
    const step = (st, keys, text) => out.steps.push({ st, keys, text });
    const ias = ac.ias() * KT, thr = Math.round(c.throttle * 100);

    if (!P.alive) {
      out.title = 'You went down';
      step('now', ['Enter'], g.mission && g.mission.kind ? 'Press Enter to fly the mission again' : 'Press Enter to try again (you restart on the carrier)');
      out.tip = 'Tip: Esc → Main menu → tick “Practice” and enemy missiles can’t hurt you.';
      return out;
    }

    // warnings that apply in any phase
    const inbound = g.world.missiles.filter((m) => !m.dead && m.team !== 'blue' && m.target === P);
    if (inbound.length) {
      let d = Infinity; for (const m of inbound) d = Math.min(d, m.pos.distanceTo(s.p));
      out.alerts.push({ cls: 'danger', html: `MISSILE INCOMING (${(d / 1000).toFixed(1)} km) — follow the BREAK arrow in the middle of the screen and press ${kb('X')} (chaff + flares) when it says NOW` });
    }
    const ground = Math.max(g.terrain.heightAt(s.p.x, s.p.z), 0);
    const agl = (s.p.y - ground) * FT;
    if (!ac.onGround) {
      if (agl < 500 && s.v.y < -12 && !ops.inApproach) out.alerts.push({ cls: 'danger', html: `TOO LOW — PULL UP: hold ${kb('S')}` });
      else if (ias < 150 && !(ac.gear > 0.5 && ias > 110) && (g.time - this.launchedAt > 6)) out.alerts.push({ cls: 'warn', html: `Too slow — nose down with ${kb('W')} and throttle up with ${kb('Shift')}` });
    }
    if (P.gloc > 0) out.alerts.push({ cls: 'warn', html: `Blacked out from pulling too hard — let go of ${kb('S')}` });
    if (ac.fuel < 0.12 * JET.fuelMax) out.alerts.push({ cls: 'warn', html: g.opts.realistic ? 'Fuel low — head back to the carrier' : `Fuel low — head back to the carrier, ${kb('G')} gear down and follow the green circle` });

    // steering your own missile
    if (g.rig.mode === 'seeker') {
      out.title = 'Steering your missile';
      step('now', ['W', 'A', 'S', 'D'], 'Move the crosshair onto the target — or do nothing, it guides itself');
      step('next', ['T'], 'Lock whatever is under the crosshair');
      step('next', ['M'], 'Back to your jet (the autopilot is flying it meanwhile)');
      return out;
    }

    // catapult
    const cs = ops.cat.state;
    if (cs === 'hookup' || cs === 'tension' || cs === 'salute' || cs === 'stroke') {
      out.title = 'Catapult launch';
      const mil = c.throttle >= 0.78, fired = cs === 'salute' || cs === 'stroke';
      step(cs === 'hookup' ? 'now' : 'done', [], cs === 'hookup' ? 'Hooking the jet to the catapult…' : 'Jet is hooked to the catapult');
      step(fired || mil ? 'done' : cs === 'hookup' ? 'next' : 'now', ['Shift'], `Hold Shift to throttle up — it stops at 80% (now ${thr}%)`);
      step(c.throttle > 0.82 ? 'done' : 'opt', ['Shift'], 'Optional: let go, press Shift again for afterburner');
      step(fired ? 'done' : mil && cs === 'tension' ? 'now' : 'next', ['F'], 'Press F to tell the deck crew you’re ready');
      step(fired ? 'now' : 'next', [], cs === 'stroke' ? 'LAUNCHING — hands off, the jet lifts itself' : 'Hands off: the catapult fires 2 seconds after F');
      out.tip = 'Keep the throttle up until you are flying.';
      return out;
    }

    const onDeck = ac.onGround && ac.contactSurface === 'deck';
    const LA = g.opts.realistic ? null : g.landAssist; // easy controls: the landing assist
    const practice = g.scenario === 'approach';
    // arrested landing
    if (ops.wire && ops.wireState === 'arresting') { out.title = 'Caught the wire!'; step('now', [], 'Hold on — the wire stops the jet'); return out; }
    if (LA && LA.state === 'deck') {
      out.title = 'Touchdown!';
      step('now', [], 'Hands off — full power in case the hook misses the wires');
      step('next', [], 'Missed them? The jet flies off the end and climbs away by itself');
      return out;
    }
    if (onDeck && ops.trap && ops.trap.done) {
      out.title = 'You landed!';
      step(c.throttle < 0.1 ? 'done' : 'now', ['Ctrl'], LA ? 'Throttle back to idle (the landing assist did it for you)' : 'Throttle back to idle (Ctrl or −)');
      if (practice) step('now', ['Enter'], 'Press Enter to fly another approach');
      step(practice ? 'opt' : 'now', ['F'], 'Press F to go back to the catapult, rearmed and refueled');
      out.tip = `Wire ${ops.trap.wire} of 4 (3 is perfect). Grades: OK = smooth, FAIR = a little off, NO GRADE = safe but rough.`;
      return out;
    }
    // taxi on deck
    if (onDeck && cs === 'none') {
      const near = ops.nearCat(ac) >= 0; const rolling = ac.tas - g.carrier.speed > 1;
      out.title = 'Taxi to the catapult';
      step(rolling || near ? 'done' : 'now', ['Shift'], 'A little throttle to start rolling, then Ctrl (or −) back to idle');
      step(near ? 'done' : 'now', ['Q', 'E'], 'Steer straight up the catapult track ahead');
      step(near ? 'now' : 'next', ['B'], 'Over the catapult: hold B to brake to a stop');
      step(near ? 'now' : 'next', ['F'], 'Press F to hook up');
      return out;
    }
    if (ac.onGround) {
      out.title = 'On the ground';
      step('now', ['P'], 'Press P to pause and pick a mission');
      return out;
    }

    // landing on the carrier
    const toShip = g.carrier.root.position.distanceTo(s.p);
    if (LA && LA.state === 'approach') {
      out.title = 'Landing assist is flying you down';
      step('done', ['G', 'H'], 'Gear and hook are down');
      step('now', [], 'Hands off is fine — it holds speed, glide path and lineup');
      step('opt', ['W', 'S'], 'Nudge the glide path a little lower / higher');
      step('opt', ['A', 'D'], 'Nudge left / right');
      step('next', [], 'At touchdown it goes to full power by itself, in case the hook misses');
      if (practice) step('opt', ['Enter'], 'Start the approach over');
      out.tip = 'The orange ball on the light box (left side of the deck) is the glide path: level with the green bars = right on it. Nudges fade out over the last few hundred metres, so the jet always arrives lined up.';
      return out;
    }
    if (LA && LA.state === 'climb') {
      out.title = LA.why === 'bolter' ? 'Bolter — the hook missed the wires' : LA.why === 'waveoff' ? 'Wave-off — going around' : 'Too high — going around';
      step('now', [], 'Hands off — the jet climbs away by itself');
      step('next', [], practice ? 'Then press Enter to fly the approach again' : 'Then follow the green circle around behind the ship and it lands you again');
      if (practice) step('opt', ['Enter'], 'Or press Enter right now');
      out.tip = LA.why === 'bolter' ? 'Real pilots bolter too. Full power at touchdown is what lets the jet fly away safely.'
        : LA.why === 'waveoff' ? 'The assist goes around when the jet gets too low or too far off the center line close to the ship, usually after big nudges.'
          : 'The jet was still too high over the deck to catch a wire.';
      return out;
    }
    if (LA && LA.inPattern(g)) {
      out.title = 'Coming back to land';
      step('done', ['G'], 'Gear down — the auto-throttle holds the speed now');
      const hint = LA.joinHint(g) || { text: 'Fly to the green circle', circle: true };
      step('now', [], hint.circle ? `${hint.text} (${this.where(LA.joinPoint(g, _j)).text})` : hint.text);
      step('next', [], 'Behind the ship the landing assist takes over: hook, speed, glide path and lineup');
      step('opt', ['G'], 'Not landing? Press G to raise the gear');
      if (practice) step('opt', ['Enter'], 'Or press Enter to start the approach over');
      out.tip = 'The circle leads you around behind the ship and onto the landing line, so keep it in front of you. The line at the top of the screen says what to fix.';
      return out;
    }
    const landing = ops.inApproach || (g.scenario === 'approach' && toShip < 9000 && c.gearCmd) || (c.gearCmd && c.hookCmd && toShip < 9000);
    if (landing && !LA) {
      out.title = 'Landing on the carrier';
      step(c.gearCmd ? 'done' : 'now', ['G'], 'Gear down');
      step(c.hookCmd ? 'done' : c.gearCmd ? 'now' : 'next', ['H'], 'Hook down — it grabs a wire on the deck');
      // approach speed is flown by angle of attack (on-speed ~8°), not a fixed number of knots
      const aoa = ac.alpha * 180 / Math.PI, fast = aoa < 6.6, slow = aoa > 9.8;
      step(!fast && !slow ? 'done' : 'now', fast ? ['Ctrl'] : ['Shift'], fast ? `Too fast (${Math.round(ias)} knots) — Ctrl or − to slow down` : slow ? `Too slow (${Math.round(ias)} knots) — Shift for more power` : `Speed is right (${Math.round(ias)} knots)`);
      if (ops.inApproach) {
        const b = ops.ball, lu = ops.lineup;
        step(Math.abs(b) < 0.3 ? 'done' : 'now', b > 0 ? ['W'] : ['S'], Math.abs(b) < 0.3 ? 'On the glide path — the orange ball is level with the green bars' : b > 0 ? 'Too high — ease the nose down a little (W)' : 'Too low — nose up a little (S) and add power (Shift)');
        step(Math.abs(lu) < 1 ? 'done' : 'now', lu > 0 ? ['A'] : ['D'], Math.abs(lu) < 1 ? 'Lined up with the deck' : lu > 0 ? 'Right of the deck — roll left a touch (A)' : 'Left of the deck — roll right a touch (D)');
      } else {
        const w = this.where(g.carrier.root.position);
        step('now', ['A', 'D'], `Fly to the back of the ship and line up with the angled deck (ship ${w.text})`);
      }
      out.tip = 'The light box on the left of the deck shows the orange “ball”: keep it level with the green bars and fly onto the deck. Miss the wires? Full power, climb, try again.';
      return out;
    }

    // ---- the ring course ----
    const MR = g.mission;
    if (MR && MR.kind === 'rings' && MR.ctl && !MR.ended) {
      const R = MR.ctl, ring = R.next(), n = R.rings.length;
      out.title = `Ring course: ring ${Math.min(R.i + 1, n)} of ${n} · ${R.clock()}`;
      if (ring) {
        const w = this.where(ring.pos), dy = ring.pos.y - s.p.y, ft = Math.round(Math.abs(dy) * FT / 100) * 100;
        step(w.km < 1.2 ? 'now' : Math.abs(w.rel) < 12 ? 'done' : 'now', ['A', 'D'], w.km < 1.2 ? 'Through the green ring — hold it steady' : Math.abs(w.rel) < 12 ? `Green ring straight ahead, ${w.km.toFixed(1)} km` : `Turn toward the green circle: ${w.text} (roll with A / D, pull S)`);
        step(Math.abs(dy) < 60 ? 'done' : 'now', dy > 0 ? ['S'] : ['W'], Math.abs(dy) < 60 ? 'Height is right' : dy > 0 ? `Climb ${ft.toLocaleString('en-US')} ft: pull back gently with S` : `Go down ${ft.toLocaleString('en-US')} ft: push W gently`);
        step(ias > 380 ? 'done' : 'opt', ['Shift'], ias > 380 ? `Fast: ${Math.round(ias)} knots` : `Shift for more speed (${Math.round(ias)} knots), Ctrl to slow down for tight turns`);
        step('next', [], 'The orange ring (dashed circle on the HUD) is the one after it');
        step('opt', ['Enter'], 'Start the course over');
      }
      out.tip = `Par ${fmtRace(R.par)}${R.best ? ` · your best ${fmtRace(R.best)}` : ''}. Missed a ring? Turn around and fly through it: it stays green until you do.`;
      return out;
    }
    if (MR && MR.kind === 'rings' && MR.ctl && MR.success) {
      const R = MR.ctl, t = R.elapsed();
      out.title = `Course complete · ${fmtRace(t)}`;
      step('now', ['Enter'], 'Fly the course again and beat your time');
      step('opt', ['G'], `Or fly home: the carrier is ${this.where(g.carrier.root.position).text}. Gear down near the ship, then follow the green circle`);
      out.tip = `Par ${fmtRace(R.par)} · your best ${fmtRace(R.best ? Math.min(R.best, t) : t)}.`;
      return out;
    }
    // just launched
    if ((g.time - this.launchedAt < 40 || c.gearCmd) && agl < 3000) {
      out.title = 'You’re flying!';
      step(s.v.y > 3 || agl > 900 ? 'done' : 'now', ['S'], 'Pull back gently with S to climb');
      step(c.gearCmd ? 'now' : 'done', ['G'], 'Raise the landing gear');
      step(ias > 260 ? 'done' : 'now', ['Shift'], `Keep the power up (${Math.round(ias)} knots)`);
      const k0 = g.mission && g.mission.kind;
      step('next', [], k0 === 'strike' ? 'Then head for the city — follow the orange arrow' : k0 === 'naval' ? 'Then head for the warships — follow the orange diamonds' : k0 === 'defense' ? 'Then fly north of the ship and wait for the drones' : 'Then go find the enemy — these steps change as you go');
      return out;
    }

    const sel = P.sel;
    // ---- the city strike mission ----
    const M = g.mission, stg = M && M.stage ? `Stage ${M.ctl ? M.ctl.stageNo : ''}: ` : '';
    const jetNear = () => g.aiJets.find((j) => j.alive && j.team === 'red' && j.pos.distanceTo(s.p) < 22000);
    // ---- campaign stage 4: the warships ----
    if (M && M.kind === 'naval' && !M.ended) {
      const ships = (M.fleet || []).filter((e) => e.alive).sort((a, b) => a.pos.distanceToSquared(s.p) - b.pos.distanceToSquared(s.p));
      out.title = `${stg}Sink the warships (${M.fleet.length - ships.length}/${M.fleet.length})`;
      const jet = jetNear();
      if (jet && !P.airWeapon) out.alerts.push({ cls: 'warn', html: `Enemy fighter ${(jet.pos.distanceTo(s.p) / 1000).toFixed(0)} km away — ${kb('2')} radar missile, ${kb('T')} lock, ${kb('Space')} fire (then back to the ships)` });
      const n = P.count('agm84');
      if (!n) step('now', [], 'No Harpoons left — land on the carrier and press F on the deck to rearm');
      else {
        const tgt = P.tgp.target && P.tgp.target.alive && M.fleet.includes(P.tgp.target) ? P.tgp.target : null;
        const km = tgt ? tgt.pos.distanceTo(s.p) / 1000 : 0;
        step(sel === 'agm84' ? 'done' : 'now', ['3'], sel === 'agm84' ? `Harpoon anti-ship missile selected (${n} left)` : 'Press 3 for the Harpoon anti-ship missile');
        step(tgt ? 'done' : sel === 'agm84' ? 'now' : 'next', ['T'], tgt ? `Marked: ${tagOf(tgt)}, ${km.toFixed(0)} km` : 'Face the warships and press T to mark one (T again = next)');
        step(tgt && km <= 40 ? 'now' : 'next', ['Space'], !tgt ? 'Fire from 20–40 km' : km > 40 ? `Fly closer: ${km.toFixed(0)} km now, fire inside 40 km` : km < 13 ? 'Too close: their SAMs reach you here! Fire, then turn away hard' : 'In range — press Space to fire, then turn away');
        step('next', [], 'Fire two at the destroyer: their guns can shoot one down');
      }
      const W = g.wingman;
      if (W && W.alive && !W.deck) { const busy = W.order === 'hunt' || !!W.strike; step(busy ? 'done' : 'next', ['O', '3'], busy ? 'Your wingman is attacking the ships too' : 'O, then 3 sends your wingman after the ships'); }
      out.tip = ships.length ? `Nearest warship: ${tagOf(ships[0]).toLowerCase()}, ${this.where(ships[0].pos).text}. Their SAMs reach 13 km.` : '';
      return out;
    }
    // ---- campaign stage 5: drones and missiles against the carrier ----
    if (M && M.kind === 'defense' && !M.ended && M.ctl) {
      const cv = g.carrier.entity, ctl = M.ctl;
      const threats = (g.drones || []).filter((d) => d.alive && d.team === 'red').sort((a, b) => a.pos.distanceToSquared(cv.pos) - b.pos.distanceToSquared(cv.pos));
      out.title = `${stg}Protect the carrier (${Math.max(0, Math.round(cv.hp / cv.maxHp * 100))}%)`;
      if (!threats.length) {
        step('now', [], ctl.waveI < WAVES.length ? `Wave ${ctl.waveI + 1} of ${WAVES.length} is on its way — fly north of the ship and wait` : 'All waves are down!');
        step('next', ['J'], 'J speeds up time while you wait (it slows down again when they arrive)');
        step('next', ['N'], 'N opens the theater map: every drone is on it');
      } else {
        const lock = P.radar.stt && P.radar.stt.alive ? P.radar.stt : null, km = lock ? lock.pos.distanceTo(s.p) / 1000 : 0;
        step(lock ? 'done' : 'now', ['T'], lock ? `Locked: ${lock.name}, ${km.toFixed(1)} km` : 'Turn toward the drones (orange triangles) and press T to lock one');
        step(lock ? 'now' : 'next', ['Space'], lock ? (sel === 'aim9x' || sel === 'aim120' ? 'Press Space to fire!' : 'Press 2 (or 1 up close), then Space') : 'Fire once you have a lock');
        step('next', ['C'], 'Drones are slow: get behind one and hold C for the gun');
        if (threats.some((d) => d.type === 'cruise')) step('now', ['2'], 'Anti-ship missiles coming! They are fast: lock them first and fire radar missiles (2)');
      }
      out.tip = threats.length ? `${threats.length} inbound. Closest to the ship: ${threats[0].name.toLowerCase()}, ${(threats[0].pos.distanceTo(cv.pos) / 1000).toFixed(1)} km from it, ${this.where(threats[0].pos).text}.` : '';
      return out;
    }
    if (M && M.kind === 'strike') {
      const jet = g.aiJets.find((j) => j.alive && j.team === 'red' && j.pos.distanceTo(s.p) < 22000);
      if (jet && !P.airWeapon) out.alerts.push({ cls: 'warn', html: `Enemy fighter ${(jet.pos.distanceTo(s.p) / 1000).toFixed(0)} km away — ${kb('2')} radar missile, ${kb('T')} lock, ${kb('Space')} fire (then back to the mission)` });
      if (M.state === 'sead') {
        const left = M.defenses.filter((e) => e.alive).sort((a, b) => a.pos.distanceToSquared(s.p) - b.pos.distanceToSquared(s.p));
        out.title = `${stg || 'Mission 1 of 2: '}Knock out the air defenses (${M.defensesTotal - left.length}/${M.defensesTotal})`;
        const mk = P.tgp.target && P.tgp.target.alive && M.defenses.includes(P.tgp.target) ? P.tgp.target : null;
        if (P.count('gbu39') > 0) {
          step(mk ? 'done' : 'now', ['T'], mk ? `Marked: ${tagOf(mk)} (${this.where(mk.pos).text})` : 'Point your nose at the city and press T — it marks the target nearest your nose (T again = next)');
          const L = mk ? P.jdamLAR(mk.pos, 'gbu39') : null;
          step(mk && L.inRange ? 'now' : 'next', ['Space'], !mk ? 'Then press Space when it says IN RANGE — no diving, the bomb glides there' : L.inRange ? 'IN RANGE — press Space! The small bomb glides to it by itself' : `Fly closer: ${(L.range / 1000).toFixed(1)} km now, release inside ${(L.rMax / 1000).toFixed(1)} km`);
          step('next', ['Space'], 'After each bomb the next target is marked for you — just press Space again');
          step('next', ['5'], P.count('agm88') ? 'Anti-radar missiles (5) also work: Space fires at the nearest radar' : 'Out of anti-radar missiles');
        } else if (P.count('agm88') > 0) {
          step(sel === 'agm88' ? 'done' : 'now', ['5'], sel === 'agm88' ? 'Anti-radar missile selected' : 'Press 5 for the anti-radar missile');
          step(sel === 'agm88' ? 'now' : 'next', ['Space'], 'Point roughly at the city and fire — it homes on an enemy radar by itself. Fire from 20–30 km');
          step('next', ['Space'], 'Fire the next one at the next radar (one missile per target)');
        } else if (P.count('cbu') > 0 || P.count('mk84') > 0) {
          step(sel === 'cbu' || sel === 'mk84' ? 'done' : 'now', ['4'], 'Out of anti-radar missiles: press 4 until CLUSTER BOMB');
          step('now', ['Space'], 'Dive at a target and drop when the bomb circle sits on it');
          step('next', ['C'], 'Or hold C to strafe it with the gun');
        } else {
          step('now', ['C'], 'Out of anti-radar missiles: strafe the AA guns with the gun (hold C) — stay fast');
        }
        const W = g.wingman;
        if (W && W.alive && !W.deck) {
          const busy = W.order === 'hunt' || !!W.strike;
          step(busy ? 'done' : 'next', ['O', '3'], busy ? 'Your wingman is attacking air defenses too' : 'Your wingman can help: O, then 3 sends him after the air defenses');
        }
        out.tip = left.length ? `${left.length} left (orange diamonds). Nearest: ${tagOf(left[0]).toLowerCase()}, ${this.where(left[0].pos).text}.` : '';
        return out;
      }
      const bombs = g.world.missiles.filter((m) => !m.dead && m.key === 'gbu31' && m.team === 'blue');
      if (bombs.length && (M.state === 'strike' || M.state === 'sead')) {
        const b = bombs[0]; const tti = b.tti && b.tti < 90 ? Math.max(0, Math.round(b.tti)) : null;
        out.title = 'Bomb away!';
        step('now', [], tti != null ? `Impact in about ${tti} seconds — it is steering itself onto the marked spot` : 'It is steering itself onto the marked spot');
        step('next', ['F3'], g.rig.mode === 'missile' ? 'Watching the bomb — F2 brings the view back to your jet' : 'Press F3 to ride along with the bomb (F2 to come back)');
        step('next', [], 'Keep flying away from the AA guns meanwhile');
        return out;
      }
      if (M.state === 'strike') {
        const B = M.bunker; out.title = `${stg || 'Mission 2 of 2: '}Destroy the command bunker`;
        if (!P.count('gbu31')) { step('now', [], 'No bunker busters left — land on the carrier, press F to rearm'); return out; }
        step(sel === 'gbu31' ? 'done' : 'now', ['4'], sel === 'gbu31' ? 'Bunker buster selected' : 'Press 4 for the bunker buster');
        const marked = P.tgp.target === B;
        step(marked ? 'done' : sel === 'gbu31' ? 'now' : 'next', ['T'], marked ? 'Bunker marked' : 'Face the city and press T to mark the bunker');
        if (marked) {
          const L = P.jdamLAR(B.pos);
          step(L.inRange ? 'now' : 'next', ['Space'], L.inRange ? `IN RANGE (${(L.range / 1000).toFixed(1)} km) — press Space to release!` : L.range > L.rMax ? `Fly closer: ${(L.range / 1000).toFixed(1)} km now, release inside ${(L.rMax / 1000).toFixed(1)} km` : 'Too close — fly away a little and come back');
        } else step('next', ['Space'], 'Release when it says IN RANGE');
        step('next', [], 'Then turn away — the bomb steers itself onto the bunker');
        out.tip = `Bunker: ${this.where(B.pos).text}. Flying higher and faster lets you release from further away.`;
        return out;
      }
      if (M.state === 'done' || M.state === 'rtb') {
        out.title = 'Mission complete!';
        step('now', [], 'Fly back to the carrier (blue marker) and land, or keep hunting');
        if (!g.opts.realistic) step('next', ['G'], 'Near the ship: gear down, then follow the green circle and the landing assist lands you');
        const ships = (M.fleet || []).filter((e) => e.alive);
        if (ships.length) step('next', ['4'], `Bonus: ${ships.length} enemy warships to the east of the port`);
        return out;
      }
    }
    if (M && M.kind === 'dogfight' && M.state === 'fight') out.title = stg ? `${stg}Clear the sky (${M.jets.filter((j) => j.alive).length} left)` : `Dogfight: ${M.jets.filter((j) => j.alive).length} enemy jets left`;
    // ground attack
    if (GROUND_WEAPONS.has(sel)) {
      out.title = 'Ground attack';
      const tgt = P.tgp.target && P.tgp.target.alive ? P.tgp.target : null;
      const name = DEFS[sel] ? DEFS[sel].name : sel;
      if (sel === 'mk84' || sel === 'cbu') {
        step('done', ['4'], `${name} ${sel === 'cbu' ? 'cluster bomb' : 'bomb'} selected (4 again = other bombs)`);
        step('now', [], 'Point the nose at a target and dive gently toward it');
        step('now', ['Space'], 'Drop when the bomb circle on the HUD sits on the target (F1 cockpit view shows it best)');
      } else if (sel === 'gbu12') {
        step('done', ['4'], 'Laser-guided bomb selected (4 again = other bombs)');
        step(tgt ? 'done' : 'now', ['T'], tgt ? `Target marked: ${tgt.name} — ${this.where(tgt.pos).text}` : 'Face the targets and press T to mark one (T again picks the next)');
        step(tgt ? 'now' : 'next', ['Space'], 'Hold Space and fly toward it — the bomb drops itself at the right moment');
        step('next', [], 'Keep flying toward the target so the laser can guide the bomb in');
      } else if (sel === 'agm65') {
        step('done', ['3'], 'Maverick guided missile selected');
        step(tgt ? 'done' : 'now', ['T'], tgt ? `Target: ${tgt.name} — ${this.where(tgt.pos).text}` : 'Face the targets and press T to pick one');
        step(tgt ? 'now' : 'next', ['Space'], 'Fire — the view follows the missile');
        step('next', ['M'], 'M jumps into the missile’s camera so you can steer it');
      } else if (sel === 'gbu39') {
        const L = tgt ? P.jdamLAR(tgt.pos, 'gbu39') : null;
        step('done', ['3'], `Small guided bombs selected (${P.count('gbu39')} left)`);
        step(tgt ? 'done' : 'now', ['T'], tgt ? `Marked: ${tagOf(tgt)} — ${this.where(tgt.pos).text}` : 'Point at a target and press T (T again = next)');
        step(tgt && L.inRange ? 'now' : 'next', ['Space'], !tgt ? 'Space when IN RANGE — it glides there, no diving' : L.inRange ? 'IN RANGE — press Space!' : `Fly closer: ${(L.range / 1000).toFixed(1)} km, release inside ${(L.rMax / 1000).toFixed(1)} km`);
      } else if (sel === 'gbu31') {
        step('done', ['4'], 'Bunker buster selected (4 again = other bombs)');
        step(tgt ? 'done' : 'now', ['T'], tgt ? `Target marked: ${tagOf(tgt)} — ${this.where(tgt.pos).text}` : 'Face a target and press T to mark it');
        step(tgt ? 'now' : 'next', ['Space'], 'Release when in range — it flies itself to the marked spot');
      } else if (sel === 'agm88') {
        step('done', ['5'], 'Anti-radar missile selected');
        step('now', ['Space'], 'Fire — it finds the nearest enemy radar by itself');
      } else {
        step('now', ['T'], 'Press T to pick a target'); step('next', ['Space'], 'Fire');
      }
      let best = null, bd = Infinity;
      for (const e of g.world.entities) {
        if (!e.alive || e.team !== 'red' || !e.targetable || !GROUND_KINDS.has(e.kind)) continue;
        const d = e.pos.distanceToSquared(s.p); if (d < bd) { bd = d; best = e; }
      }
      out.tip = best ? `Nearest ground target: ${best.name}, ${this.where(best.pos).text}. Switch weapons with 1–5.` : 'No ground targets left! Press 2 for air-to-air missiles.';
      return out;
    }

    // air combat
    const jets = [...g.aiJets, ...(g.drones || [])].filter((j) => j.alive && j.team === 'red');
    out.title = out.title || 'Air combat';
    if (!jets.length) {
      step('done', [], 'No enemy jets left');
      step('now', ['4'], 'Press 4 for bombs and hit the ground targets on the island');
      return out;
    }
    if (sel === 'aim9x') {
      const tone = P.seeker9.lock && P.seeker9.lock.alive ? P.seeker9.lock : null;
      step('done', ['1'], 'Heat-seeking missile selected (2 = radar missile)');
      step(tone ? 'done' : 'now', [], tone ? `Seeker has ${tone.name} — you hear a growl` : 'Point your nose at an enemy jet within about 10 km and wait for the growl');
      step(tone ? 'now' : 'next', ['Space'], 'Fire');
    } else if (sel === 'aim120') {
      const lock = P.radar.stt && P.radar.stt.alive ? P.radar.stt : null;
      const km = lock ? lock.pos.distanceTo(s.p) / 1000 : 0;
      step('done', ['2'], 'Radar missile selected (1 = heat-seeker for close range)');
      step(lock ? 'done' : 'now', ['T'], lock ? `Locked: ${lock.name}, ${km.toFixed(1)} km` : 'Turn toward an enemy jet and press T to lock it');
      step(lock ? 'now' : 'next', ['Space'], lock ? (km > 30 ? 'Get closer than 30 km, then press Space to fire' : 'Press Space to fire!') : 'Fire once you have a lock');
    } else {
      step('now', ['2'], 'Press 2 for the radar missile');
      step('next', ['T'], 'Turn toward an enemy jet and press T to lock it');
      step('next', ['Space'], 'Fire');
    }
    step('next', ['C'], 'Close in: hold C for the gun');
    const W = g.wingman;
    if (W && W.alive && !W.deck) step(W.fighting() ? 'done' : 'next', ['O', '1'], W.fighting() ? 'Your wingman is in the fight too' : 'Lock a jet with T, then O and 1: your wingman attacks it');
    let best = null, bd = Infinity;
    for (const j of jets) { const d = j.pos.distanceToSquared(s.p); if (d < bd) { bd = d; best = j; } }
    if (best) out.tip = `Nearest enemy ${best.isDrone ? (best.type === 'recon' ? 'spy drone' : 'drone') : 'jet'}: ${this.where(best.pos).text}. ${g.opts.realistic ? 'To turn: roll with A/D, then pull S.' : 'Hold A or D to turn toward it (add S to turn tighter).'}`;
    return out;
  }

  render(o) {
    let h = '';
    for (const a of o.alerts) h += `<div class="c-alert ${a.cls}">${a.html}</div>`;
    h += `<div class="c-title">${esc(o.title)}</div><ol class="c-steps">`;
    for (const st of o.steps) {
      const mark = st.st === 'done' ? '✓' : st.st === 'now' ? '▶' : '·';
      h += `<li class="${st.st}"><i>${mark}</i><span class="c-keys">${kb(...st.keys)}</span><span class="c-txt">${esc(st.text)}</span></li>`;
    }
    h += '</ol>';
    if (o.tip) h += `<div class="c-tip">${esc(o.tip)}</div>`;
    return h;
  }
}
