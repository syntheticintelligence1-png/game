// The theater campaign, Operation Trident: five stages flown in order over the same island, each one leaving the
// world the way the last one left it (the fighters, then the SAMs, then the bunker, then the warships are gone).
//   1 CLEAR THE SKY      enemy fighters plus a spy drone that tells them where you are
//   2 BLIND THEIR RADARS the city's air defenses; a friendly Reaper drone marks them on the HUD
//   3 HIT THE BUNKER     the command bunker; Hammer flight (two friendly Hornets) works the AA guns and the airfield
//   4 SINK THE FLEET     the destroyer and two frigates offshore, with Harpoon anti-ship missiles
//   5 HOLD THE LINE      waves of attack drones and anti-ship missiles against the carrier group
// A StageControl runs one stage inside the mission manager (mission.js): what it adds to the world, the stage's
// win and lose checks, objective line, radio and debrief lines. main.js keeps the progress in localStorage.
import * as THREE from 'three';
import { spawnDrone, launchRaid } from './drones.js';
import { StrikeWing } from './wingman.js';
import { CS } from './radio.js';

const D2R = Math.PI / 180;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const NUMW = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// world: what is still standing when the stage starts. start: airborne start (x/z absolute, or dx/dz from the carrier)
export const STAGES = [
  {
    id: 'air', name: 'CLEAR THE SKY', kind: 'dogfight', loadout: 'air', wing: 'air', par: 330,
    world: { jets: 4, defenses: 'all', hq: 'intact', fleet: true }, start: { x: 2000, y: 4200, z: 33000, hdg: 340, v: 240 },
    goal: 'Shoot down the four enemy fighters and the spy drone that tells them where you are.',
    tips: ['The spy drone circles high over the strait. While it lives, the enemy fighters always know where you are.', 'Lock with T, fire radar missiles (2) from 15–25 km, heat-seekers (1) up close, gun (hold C).'],
  },
  {
    id: 'sead', name: 'BLIND THEIR RADARS', kind: 'strike', loadout: 'sead', wing: 'strike', par: 480,
    world: { jets: 1, defenses: 'all', hq: 'intact', fleet: true }, start: { x: 2500, y: 4500, z: 36000, hdg: 0, v: 230 },
    goal: 'Destroy the radars, SAM sites and AA guns around the city. A friendly Reaper drone marks every one of them on your HUD.',
    tips: ['Orange diamonds on the HUD are targets the Reaper drone has found for you.', 'Anti-radar missiles (5) from 20–30 km for the radars, small bombs (3) for the AA guns.'],
  },
  {
    id: 'bunker', name: 'HIT THE BUNKER', kind: 'strike', loadout: 'strike', wing: 'strike', par: 420,
    world: { jets: 2, defenses: 'short', hq: 'intact', fleet: true }, start: { x: 2500, y: 4500, z: 36000, hdg: 0, v: 230 },
    goal: 'Destroy the command bunker with the bunker buster. Hammer flight hits the AA guns and the airfield for you.',
    tips: ['Only the bunker buster (4) gets through the roof: mark the bunker with T, release when the HUD says IN RANGE.', 'Hammer 2-1 and 2-2 are friendly Hornets with their own targets; let them take the guns.'],
  },
  {
    id: 'naval', name: 'SINK THE FLEET', kind: 'naval', loadout: 'naval', wing: 'strike', par: 420,
    world: { jets: 2, defenses: 'none', hq: 'rubble', fleet: true }, start: { x: 9000, y: 3500, z: 40000, hdg: 19, v: 230 },
    goal: 'Sink the enemy destroyer and both frigates with Harpoon anti-ship missiles.',
    tips: ['Press 3 for the Harpoon, mark a ship with T and fire from 20–40 km. One hit sinks a frigate; the destroyer takes two. You carry five.', 'Their SAMs reach 13 km and can shoot Harpoons down: fire from further out and turn away.'],
  },
  {
    id: 'defense', name: 'HOLD THE LINE', kind: 'defense', loadout: 'air', wing: 'air', par: 450,
    world: { jets: 0, defenses: 'none', hq: 'rubble', fleet: false }, start: { dx: 0, dz: -6000, y: 2500, hdg: 0, v: 220 },
    goal: 'Three waves of attack drones and anti-ship missiles are coming for the carrier. Shoot them down before they reach the ships.',
    tips: ['Drones are slow: the gun (hold C) is deadly against them. Get behind one and fire from under 800 m.', 'Missiles skim the sea at 900 km/h: lock them early with T and fire radar missiles (2).'],
  },
];
export const stageIndex = (id) => STAGES.findIndex((s) => s.id === id);

// Stage 5 waves: when (s after the start), and what comes from where (bearing deg and range m from the carrier)
export const WAVES = [
  { t: 20, groups: [{ type: 'attack', n: 6, brg: 10, R: 12500 }] },
  { t: 150, groups: [{ type: 'attack', n: 8, brg: 330, R: 12500 }, { type: 'cruise', n: 2, brg: 25, R: 30000 }] },
  { t: 290, groups: [{ type: 'cruise', n: 4, brg: 60, R: 32000 }, { type: 'attack', n: 5, brg: 350, R: 13000 }, { type: 'attack', n: 5, brg: 40, R: 13000 }] },
];

export class StageControl {
  constructor(M, stage) {
    this.M = M; this.g = M.g; this.stage = stage; this.id = stage.id;
    this.t = 0; this.waveI = 0; this.raids = []; this.hammer = []; this.extra = null; this.leakT = 0; this.raidDone = false;
  }
  // after mission.spawnWorld: the stage's own units
  begin() {
    const g = this.g, M = this.M, S = M.STRIKE;
    if (this.id === 'air') {
      const u = M.addDrone('recon', { pos: new THREE.Vector3(9000, 4300, 9000), heading: 200, orbit: { x: 5500, z: 14000 }, orbitR: 5000 });
      M.jets.push(u);
    } else if (this.id === 'sead' || this.id === 'bunker') {
      M.addDrone('reaper', { name: 'REAPER 1-1', pos: new THREE.Vector3(S.hq.x + 4000, 6400, S.hq.z + 6000), heading: 300, orbit: { x: S.hq.x - 1200, z: S.hq.z + 600 }, orbitR: 5000 });
    }
    if (this.id === 'bunker') {
      // Hammer flight: two friendly Hornets 3 km off the player's left side, hunting the guns and the parked jets
      const P = g.player, st = this.stage.start;
      const airfield = (g.structures || []).filter((e) => e.alive && e.name === 'PARKED FLANKER');
      for (let i = 0; i < 2; i++) {
        const pos = new THREE.Vector3(st.x - 3000 - i * 60, st.y + 200 + i * 40, st.z + i * 120);
        const w = new StrikeWing(g, { callsign: `Hammer 2-${i + 1}`, name: `HAMMER 2-${i + 1}`, pos, heading: st.hdg, targets: airfield, lead: i === 0 });
        g.world.add(w); g.aiJets.push(w); this.hammer.push(w); M.wingJets.push(w);
      }
      void P;
    }
    if (this.id === 'naval') {
      const f = M.STRIKE.fleet[0];
      const u = M.addDrone('recon', { pos: new THREE.Vector3(f.x - 3000, 3600, f.z + 2000), heading: 90, orbit: { x: f.x - 1500, z: f.z + 1500 }, orbitR: 3500, alt: 3600 });
      M.jets.push(u);
    }
  }
  // the radio once time runs
  opening() {
    const g = this.g, M = this.M, c = g.comms, n = `${this.stageNo}`;
    const tag = { pri: 3, ttl: 16 };
    if (this.id === 'air') {
      M.tasked = true;
      c.call('awacs', `${CS}, Magic. Operation Trident, phase one. Four bandits and a drone over the strait. Clear the sky.`, `Stage ${n}: shoot down the four enemy fighters and the spy drone. While the drone lives it tells the fighters where you are.`, tag);
      c.later(30, () => c.escorts());
    } else if (this.id === 'sead') {
      M.tasked = true;
      c.strikeIn();
      c.later(9, () => c.call('awacs', `${CS}, Magic, the SAMs are your target this time. Leave the bunker for tomorrow.`, `Stage ${n}: this sortie only needs the air defenses destroyed (radars, SAM sites, AA guns). The bunker comes next.`, { pri: 2, ttl: 12 }));
    } else if (this.id === 'bunker') {
      M.tasked = true;
      const G = c.geo(M.bunker.pos);
      c.call('awacs', `${CS}, Magic. Target bears ${String(G.brg).padStart(3, '0')} for ${G.nm}. Their big SAMs are gone, the SA-15 and triple-A are back up. Hammer has the guns. Cleared hot on the bunker.`,
        `Stage ${n}: the command bunker is ${G.km} km ${G.dir}. Yesterday's strike destroyed the big SAM site; a short-range SAM and two AA guns are back. Hammer flight (friendly) attacks them and the airfield. You destroy the bunker with the bunker buster (4).`, tag);
      c.later(70, () => this.smallRaid());
    } else if (this.id === 'naval') {
      M.tasked = true;
      const G = c.geo(M.fleet[0].pos);
      c.call('awacs', `${CS}, Magic. Surface group bears ${String(G.brg).padStart(3, '0')} for ${G.nm}: a destroyer and two frigates, and a drone spotting for them. Cleared hot.`,
        `Stage ${n}: the enemy warships are ${G.km} km ${G.dir}. Press 3 for the Harpoon, mark a ship with T and fire from 20–40 km. Their SAMs reach 13 km, so stay outside that.`, tag);
    } else if (this.id === 'defense') {
      M.tasked = true;
      c.call('ship', `All Spears, Mother. They've lost their fleet and they're coming for ours. Drones and missiles, three waves. Protect the ship.`,
        `Stage ${n}: the enemy is launching attack drones and anti-ship missiles at the carrier. Shoot down everything that comes at the ships. If the carrier sinks, the campaign is lost.`, { pri: 4, ttl: 16 });
    }
  }
  get stageNo() { return STAGES.indexOf(this.stage) + 1; }

  // stage 3: four drones go for the fleet while you're over the city (the escorts handle them; the theater lives on)
  smallRaid() {
    const g = this.g, M = this.M; if (M.ended || this.raidDone) return;
    this.raidDone = true;
    const cv = g.carrier.pos;
    const ds = launchRaid(g, { type: 'attack', n: 4, from: { x: cv.x + 9000, z: cv.z - 11000 }, carrierShare: 0.75 });
    for (const d of ds) M.droneList.push(d);
    g.comms.call('ship', `${CS}, Mother. Four drones inbound to the boat from the north-east. Escorts have them, press on.`, 'Four enemy attack drones are flying at the carrier. The escort warships will shoot at them; keep going with your own mission (or turn back and help).', { pri: 2, ttl: 10 });
  }

  update(dt) {
    const g = this.g, M = this.M; if (M.ended) return;
    this.t += dt;
    if (this.id === 'defense') this.updateDefense(dt);
  }
  updateDefense(dt) {
    const g = this.g, M = this.M, cv = g.carrier;
    const W = WAVES[this.waveI];
    if (W && this.t >= W.t) {
      this.waveI++;
      const wave = [];
      let cruise = 0, drones = 0;
      for (const G of W.groups) {
        const b = (G.brg + (Math.random() - 0.5) * 16) * D2R;
        const from = { x: cv.pos.x + Math.sin(b) * G.R, z: cv.pos.z - Math.cos(b) * G.R };
        const ds = launchRaid(g, { type: G.type, n: G.n, from, spread: G.type === 'cruise' ? 1500 : 1100 });
        wave.push(...ds); for (const d of ds) M.droneList.push(d);
        if (G.type === 'cruise') cruise += ds.length; else drones += ds.length;
      }
      this.raids.push(wave);
      const dirs = [...new Set(W.groups.map((G) => compass(G.brg)))].join(' and the ');
      const what = [drones ? `${NUMW[drones] || drones} drone${drones > 1 ? 's' : ''}` : '', cruise ? `${NUMW[cruise] || cruise} missile${cruise > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ');
      g.msg(`WAVE ${this.waveI} OF ${WAVES.length} — ${what.toUpperCase()} INBOUND FROM THE ${dirs.toUpperCase()}`, 6, '#ff9080');
      g.comms.call('ship', `${cruise ? 'Vampire, vampire! ' : ''}All Spears, Mother, wave ${NUMW[this.waveI]}: ${what} inbound from the ${dirs}.`,
        `Wave ${this.waveI} of ${WAVES.length}: ${what} heading for the carrier from the ${dirs}. ${cruise ? 'The missiles fly just above the sea and very fast: lock them early (T) and fire radar missiles (2). ' : ''}Drones are slow: the gun (hold C) works well.`,
        { pri: 5, urgent: !!cruise, ttl: 12, say: `${cruise ? 'Vampire, vampire! ' : ''}All Spears, Mother, wave ${NUMW[this.waveI]}: ${what} inbound from the ${dirs}.` });
    }
    // leakers: something inside 4 km of the carrier
    this.leakT -= dt;
    if (this.leakT <= 0) {
      const near = g.drones.filter((d) => d.alive && d.team === 'red' && d.target && d.pos.distanceTo(cv.pos) < 4000);
      if (near.length) {
        this.leakT = 14;
        g.comms.call('ship', `Leaker, leaker! ${near.length > 1 ? `${cap(NUMW[near.length] || String(near.length))} inbound` : 'One inbound'}, close aboard!`, `${near.length} enem${near.length > 1 ? 'ies are' : 'y is'} less than 4 km from the carrier. The ship's guns are firing; shoot ${near.length > 1 ? 'them' : 'it'} now if you can.`, { pri: 4, ttl: 6, key: 'leak', every: 14 });
      } else this.leakT = 1;
    }
    // all waves launched and nothing left in the air: the group held
    if (this.waveI >= WAVES.length && !g.drones.some((d) => d.alive && d.team === 'red')) {
      const pct = Math.round(cv.entity.hp / cv.entity.maxHp * 100);
      g.comms.call('ship', `All Spears, Mother. Picture clean. The ship is ${pct > 80 ? 'untouched' : 'hurt but afloat'}. Operation Trident is complete. Bring it home.`, `You held the line: every wave is down and the carrier is still afloat (${pct}%).`, { pri: 6, urgent: true, ttl: 10 });
      M.finish(true, 'THE CARRIER GROUP HELD');
    }
  }

  // returns true when the stage handled the event itself
  onDestroyed(e, byPlayer) {
    const g = this.g, M = this.M;
    if (this.id === 'defense' && e === g.carrier.entity && !M.ended) {
      g.msg('THE CARRIER IS SINKING — STAGE FAILED', 8, '#ff9080');
      g.comms.call('ship', 'Mother is hit, we are taking on water. Abandon ship, abandon ship.', 'Too many drones and missiles got through: the carrier is sinking. Press Enter to try the stage again.', { pri: 9, urgent: true, ttl: 10 });
      M.finish(false, 'THE CARRIER WAS SUNK');
      return true;
    }
    if (this.id === 'naval' && e.team === 'red' && (M.fleet || []).includes(e)) {
      const left = M.fleet.filter((s) => s.alive).length;
      if (left === 0) {
        g.comms.call('awacs', `Magic copies, the surface group is destroyed. Outstanding, ${CS}. RTB.`, 'All three enemy warships are sunk. Stage complete!', { pri: 6, urgent: true, ttl: 8 });
        M.finish(true, 'ENEMY SURFACE GROUP SUNK');
      } else g.msg(`WARSHIPS SUNK ${M.fleet.length - left}/${M.fleet.length}`, 3, '#ffe680');
    }
    void byPlayer;
    return false;
  }
  // stage 2 ends when the air defenses are down (the bunker is stage 3)
  onDefensesDown() {
    if (this.id !== 'sead') return false;
    const g = this.g;
    g.comms.call('awacs', `Magic, all SAMs and triple-A are down. The city is blind. ${CS}, RTB.`, 'Every radar, SAM and AA gun around the city is destroyed. Stage complete!', { pri: 6, urgent: true, ttl: 10 });
    this.M.finish(true, 'CITY AIR DEFENSES DESTROYED');
    return true;
  }
  targets(set) {
    const M = this.M;
    if (this.id === 'naval') for (const e of M.fleet || []) if (e.alive) set.add(e);
    if (this.id === 'defense') for (const d of this.g.drones) if (d.alive && d.team === 'red') set.add(d);
    if (this.id === 'bunker') { set.clear(); if (M.bunker && M.bunker.alive) set.add(M.bunker); }
    if (this.id === 'sead' && M.bunker) set.delete(M.bunker);
    return set;
  }
  objectiveText() {
    const g = this.g, M = this.M;
    if (this.id === 'naval') { const n = (M.fleet || []).length, left = (M.fleet || []).filter((e) => e.alive).length; return `STAGE ${this.stageNo} · WARSHIPS SUNK ${n - left}/${n}`; }
    if (this.id === 'defense') {
      const cv = g.carrier.entity, pct = Math.max(0, Math.round(cv.hp / cv.maxHp * 100));
      const threats = g.drones.filter((d) => d.alive && d.team === 'red').length;
      return `STAGE ${this.stageNo} · CARRIER ${pct}% · WAVE ${this.waveI}/${WAVES.length} · THREATS ${threats}`;
    }
    if (this.id === 'air') return `STAGE ${this.stageNo} · ENEMIES LEFT ${M.jets.filter((j) => j.alive).length}/${M.jets.length}`;
    if (this.id === 'sead') return `STAGE ${this.stageNo} · AIR DEFENSES ${M.defensesTotal - M.defensesLeft}/${M.defensesTotal}`;
    return `STAGE ${this.stageNo} · BUNKER ${M.bunker && M.bunker.alive ? (M.bunker.hp < M.bunker.maxHp ? Math.round(M.bunker.hp / M.bunker.maxHp * 100) + '%' : 'INTACT') : 'DESTROYED'}`;
  }
  reportItems() {
    const g = this.g, M = this.M, items = [];
    if (this.id === 'naval') for (const e of M.fleet || []) items.push({ ok: !e.alive, text: e.tag || e.name, big: true });
    if (this.id === 'defense') {
      const all = this.raids.flat(), down = all.filter((d) => !d.alive && !d.impacted).length;
      const cv = g.carrier.entity;
      items.push({ ok: cv.alive, text: `CARRIER ${cv.alive ? `AFLOAT · ${Math.round(cv.hp / cv.maxHp * 100)}%` : 'SUNK'}`, big: true });
      items.push({ ok: down === all.length, text: `THREATS SHOT DOWN ${down}/${all.length}` });
      for (const s of g.ships) if (s.team === 'blue' && s !== g.carrier && s.entity) items.push({ ok: s.entity.alive, text: `${s.name} ${s.entity.alive ? 'AFLOAT' : 'SUNK'}` });
    }
    if (this.id === 'bunker') for (const w of this.hammer) items.push({ ok: w.alive, text: `${w.name} ${w.alive ? 'MADE IT' : 'SHOT DOWN'} · ${w.kills} KILL${w.kills === 1 ? '' : 'S'}` });
    return items;
  }
  teardown() { this.hammer = []; this.raids = []; }
}
