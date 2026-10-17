// Missions. The city strike: knock out the air defenses ringing the city (early-warning radar, SA-21 battery,
// SA-15, AA guns), then destroy the command bunker under the HQ with the GBU-31 bunker buster; an enemy
// surface group offshore is an optional extra. The dogfight: shoot down every enemy fighter.
// The manager owns all of its targets so each attempt starts with a fresh, intact, defended city.
import * as THREE from 'three';
import { SamSite, PointDefense, Flak, groundEntity, AIJet, ShipDefense } from './ai.js';
import { Entity, tagOf } from './world.js';
import { Radar } from '../sim/radar.js';
import { buildSAMRadar, buildBuildingGeometry } from '../models/units.js';
import { buildDestroyer } from '../models/carrier.js';
import { Ship } from '../sim/carrierOps.js';
import { attachLights, shipLights } from '../fx/navlights.js';
import { CS } from './radio.js';

const D2R = Math.PI / 180;
export const STRIKE = {
  hq: { x: 4100, z: 7650, heading: 20 },
  ew: { x: 3000, z: 3950 },
  sam: { x: 1350, z: 6250 },
  sa15: { x: 4560, z: 7230 },
  aaa: [{ x: 3760, z: 7340, h: 200 }, { x: 4420, z: 8060, h: 20 }],
  // the middle of each warship's patrol circle, with open water at least 1.8 km all round (the islet is to the west;
  // these used to sit on its shore, the destroyer on dry land)
  fleet: [{ x: 18000, z: 14200, name: 'DESTROYER', scale: 1, hp: 2400 }, { x: 16600, z: 15300, name: 'FRIGATE 1', scale: 0.78, hp: 1600 }, { x: 19400, z: 13100, name: 'FRIGATE 2', scale: 0.78, hp: 1600 }],
};
const PATROL_R = 600;
// what MAGIC says when an air-defense target goes down: [radio line, plain English]
const DEF_CALLS = {
  'EARLY-WARNING RADAR': ['Early-warning radar is off the air.', 'Their long-range search radar is destroyed.'],
  'SAM SEARCH RADAR': ['SA-21 search radar is down.', 'The big SAM site lost its search radar.'],
  'SAM TRACKING RADAR': ['SA-21 engagement radar destroyed. That site is blind.', 'The big SAM site can no longer guide missiles.'],
  'SA-15 MISSILE SYSTEM': ['SA-15 destroyed.', 'The short-range SAM next to the HQ is destroyed.'],
  'AA GUN': ['Triple-A is down.', 'An AA gun is destroyed.'],
};
const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
export const CITY_KEEP_OUT = [{ x: STRIKE.hq.x, z: STRIKE.hq.z, r: 175 }, { x: STRIKE.sa15.x, z: STRIKE.sa15.z, r: 45 }, ...STRIKE.aaa.map(a => ({ x: a.x, z: a.z, r: 45 })), { x: STRIKE.sam.x, z: STRIKE.sam.z, r: 260 }];

export class Missions {
  constructor(game) {
    this.g = game; this.kind = null; this.state = 'idle';
    this.ents = []; this.radars = []; this.ctrls = []; this.extra = []; this.shipList = []; this.jets = [];
    this.endT = 0; this.stats = null; this.onEnd = null;
  }

  // ---------------- lifecycle ----------------
  begin(scenario) {
    const g = this.g;
    this.teardown();
    this.kind = scenario === 'air' ? 'dogfight' : scenario === 'approach' ? null : 'strike';
    // landing practice gets no enemy fighters: they would find the jet and shoot it down a few minutes in
    this.spawnWorld(this.kind === 'dogfight' ? 4 : scenario === 'approach' ? 0 : 2);
    this.state = this.kind === 'strike' ? 'sead' : this.kind === 'dogfight' ? 'fight' : 'free';
    this.stats = { t0: g.time, shots: 0, hits: 0, killsAir: 0, killsGround: 0, ships: 0, wing: 0 };
    this.endT = 0; this.ended = false; this.lastHardMsg = -10; this.tasked = false;
    for (const d of g.shipDefs) if (d.team === 'blue') d.ammo = d.maxAmmo;
    g.comms.later(1.2, () => g.comms.opening(scenario)); // MAGIC / MOTHER / PADDLES open the mission once time runs
  }

  spawnWorld(nJets) {
    const g = this.g, W = g.world;
    const e0 = W.entities.length, r0 = W.radars.length;
    // early-warning radar on the ridge north of the city
    const ew = groundEntity(g, buildSAMRadar('search'), { x: STRIKE.ew.x, z: STRIKE.ew.z, team: 'red', kind: 'sam', name: 'EW RADAR', label: 'EW', hp: 150, value: 40, heading: 0 });
    ew.tag = 'EARLY-WARNING RADAR'; ew.model.root.scale.setScalar(1.35); ew.radius *= 1.35;
    if (ew.hitSpheres) ew.hitSpheres = ew.hitSpheres.map(h => ({ c: h.c.clone().multiplyScalar(1.35), r: h.r * 1.35 }));
    const ewR = new Radar(ew, { type: 'search', label: 'EW', range: 120000, scanPeriod: 8, lethal: 1, emitterOffset: ew.model.info.emitter.clone().multiplyScalar(1.35), minAlt: 0 });
    ew.radar = ewR; W.radars.push(ewR);
    const ewCtl = { update: (dt) => { if (!ew.alive) { ewR.on = false; return; } ew.model.nodes.antenna.rotation.y += dt * Math.PI * 2 / 8; const P = g.player; if (P.alive && ewR.canSee(W, P)) g.gciSees = true; } };
    // SA-21 battery west of the city, SA-15 and AA guns guarding the HQ
    const sam = new SamSite(g, { name: 'SA-21 GROWLER', x: STRIKE.sam.x, z: STRIKE.sam.z, launchers: 4, facing: 150, maxR: 24000 });
    sam.search.tag = 'SAM SEARCH RADAR'; sam.track.tag = 'SAM TRACKING RADAR'; for (const L of sam.launchers) L.tag = 'SAM LAUNCHER';
    const pd = new PointDefense(g, { name: 'SA-15 GAUNTLET', x: STRIKE.sa15.x, z: STRIKE.sa15.z, heading: 200 }); pd.e.tag = 'SA-15 MISSILE SYSTEM';
    const aaa = STRIKE.aaa.map(a => { const f = new Flak(g, { x: a.x, z: a.z, heading: a.h }); f.e.tag = 'AA GUN'; return f; });
    g.sams.push(sam); g.pointDef.push(pd); g.flak.push(...aaa);
    this.ctrls.push(sam, pd, ...aaa, ewCtl);
    this.ewCtl = ewCtl; this.samSite = sam; this.pd = pd;
    this.defenses = [ew, sam.search, sam.track, pd.e, ...aaa.map(f => f.e)];
    this.launchers = sam.launchers;
    // the HQ over the command bunker
    this.spawnHQ();
    // enemy surface group offshore
    for (const f of STRIKE.fleet) this.spawnShip(f);
    // enemy fighters
    this.spawnJets(nJets);
    for (let i = e0; i < W.entities.length; i++) this.ents.push(W.entities[i]);
    for (let i = r0; i < W.radars.length; i++) this.radars.push(W.radars[i]);
  }

  spawnHQ() {
    const g = this.g, T = g.terrain, H = STRIKE.hq;
    const y = T.heightAt(H.x, H.z) - 0.4; const rot = -H.heading * D2R;
    const hq = buildBuildingGeometry('hq'); const m = new THREE.Mesh(hq.geometry, hq.material); m.castShadow = m.receiveShadow = true;
    m.position.set(H.x, y, H.z); m.rotation.y = rot; g.scene.add(m);
    const wall = buildBuildingGeometry('compound'); const wm = new THREE.Mesh(wall.geometry, wall.material); wm.castShadow = wm.receiveShadow = true;
    wm.position.copy(m.position); wm.rotation.y = rot; g.scene.add(wm); this.extra.push(wm);
    const rub = buildBuildingGeometry('rubble'); const rm = new THREE.Mesh(rub.geometry, rub.material); rm.receiveShadow = true;
    rm.position.copy(m.position); rm.rotation.y = rot; rm.visible = false; g.scene.add(rm); this.extra.push(rm);
    if (hq.material.emissiveMap) (g.nightMats || (g.nightMats = [])).push(hq.material);
    const spheres = [];
    for (const x of [-24, 0, 24]) for (const z of [-10, 10]) spheres.push({ c: new THREE.Vector3(x, 13, z), r: 14 });
    for (const x of [-68, -48, 48, 68]) spheres.push({ c: new THREE.Vector3(x, 9, 6), r: 11 });
    spheres.push({ c: new THREE.Vector3(0, 4, 38), r: 11 });
    const e = new Entity(g.world, { team: 'red', kind: 'structure', name: 'COMMAND BUNKER', label: 'HQ', radius: 70, hp: 2000, root: m, hitSpheres: spheres, rcs: 800, ir: 0.5, value: 200 });
    e.tag = 'COMMAND BUNKER'; e.hardened = true; e.isBunker = true; e.mats = null;
    e.pos.set(H.x, y + 12, H.z);
    e.onHardHit = () => {
      if (g.time - this.lastHardMsg > 3) { this.lastHardMsg = g.time; g.msg('NO EFFECT — THE BUNKER IS HARDENED. USE THE BUNKER BUSTER (PRESS 4)', 3, '#ff9080'); }
      g.comms.call('awacs', `${CS}, Magic, no effect on the bunker. It's hardened, use the penetrator.`, 'That weapon can\'t hurt the bunker. Only the bunker buster (press 4) gets through the roof.', { key: 'hard', every: 15, pri: 2, ttl: 6 });
    };
    e.onDamage = () => {
      if (e.alive && e.hp < e.maxHp * 0.98 && !(g.world.blast && !g.world.blast.penetrator)) {
        const pct = Math.round(e.hp / e.maxHp * 100);
        g.msg(`BUNKER DAMAGED — ${pct}% LEFT. HIT IT AGAIN`, 3, '#ffe680');
        g.comms.call('awacs', `${CS}, Magic, partial effects on the bunker. Re-attack.`, `Good hit, but the bunker is still standing (${pct}% left). Hit it again with the bunker buster.`, { key: 'bdmg', every: 6, pri: 3, ttl: 6 });
      }
    };
    g.world.add(e); this.bunker = e; this.rubble = rm; this.hqMesh = m;
  }

  spawnShip(f) {
    const g = this.g;
    const mdl = buildDestroyer(); mdl.root.scale.setScalar(f.scale);
    for (const k of ['hull', 'dark']) if (mdl.mats[k]) mdl.mats[k].color.setRGB(0.66, 0.7, 0.76);
    g.scene.add(mdl.root);
    const info = mdl.info; info.length *= f.scale; info.beam *= f.scale; info.deckY *= f.scale; info.draft *= f.scale;
    info.hitSpheres = info.hitSpheres.map(h => ({ c: h.c.clone().multiplyScalar(f.scale), r: h.r * f.scale }));
    attachLights(mdl.root, shipLights(155, 20, 30));
    // starts on its circle heading 255, the circle's middle off its right side
    const h = 255 * D2R, s = new Ship(mdl, { name: f.name, x: f.x - Math.cos(h) * PATROL_R, z: f.z - Math.sin(h) * PATROL_R, heading: 255, speed: 6, hp: f.hp, team: 'red', patrol: { x: f.x, z: f.z, r: PATROL_R } });
    g.ships.push(s); this.shipList.push(s);
    const e = new Entity(g.world, { team: 'red', kind: 'ship', name: f.name, label: 'DD', radius: s.length / 2, hp: f.hp, root: s.root, hitSpheres: info.hitSpheres, rcs: 4000, value: 120 });
    e.ship = s; e.tag = f.name === 'DESTROYER' ? 'ENEMY DESTROYER' : 'ENEMY FRIGATE'; s.entity = e; e.pos.copy(s.root.position);
    g.world.add(e);
    const def = new ShipDefense(g, s, e, { mastH: 24 * f.scale, sam: f.scale < 1 ? 6 : 10 });
    g.shipDefs = g.shipDefs || []; g.shipDefs.push(def); this.ctrls.push(def);
    (this.fleet || (this.fleet = [])).push(e);
  }

  spawnJets(n) {
    const g = this.g;
    const spots = [[-3000, 6500, -9000, 90], [-1500, 6900, -9800, 110], [6000, 6000, -6000, 230], [8000, 6400, -5200, 250]];
    for (let i = 0; i < n; i++) {
      const [x, y, z, h] = spots[i];
      const j = new AIJet(g, { name: `FLANKER ${i + 1}`, pos: new THREE.Vector3(x, y, z), heading: h, speed: 230, cap: new THREE.Vector3(i < 2 ? 0 : 5000, 6500, i < 2 ? -4000 : 2000), capAlt: 6500 + i * 400 });
      g.world.add(j); g.aiJets.push(j); this.jets.push(j);
    }
  }

  teardown() {
    const g = this.g, W = g.world;
    for (const e of this.ents) { e.alive = false; if (e.root) g.scene.remove(e.root); W.remove(e); if (e.audio && e.audio.stop) e.audio.stop(); if (e.contrail) [].concat(e.contrail).forEach(c => c && c.stop && c.stop()); if (e.smokeTrail) e.smokeTrail.stop(); if (e.vortexL) { e.vortexL.stop(); e.vortexR.stop(); } }
    W.radars = W.radars.filter(r => !this.radars.includes(r));
    for (const c of this.ctrls) if (c.audio && c.audio.stop) c.audio.stop();
    const gone = new Set(this.ctrls);
    g.sams = g.sams.filter(x => !gone.has(x)); g.pointDef = g.pointDef.filter(x => !gone.has(x)); g.flak = g.flak.filter(x => !gone.has(x));
    if (g.shipDefs) g.shipDefs = g.shipDefs.filter(x => !gone.has(x));
    g.aiJets = g.aiJets.filter(j => !this.jets.includes(j));
    for (const s of this.shipList) { const i = g.ships.indexOf(s); if (i >= 0) g.ships.splice(i, 1); g.scene.remove(s.root); }
    for (const o of this.extra) g.scene.remove(o);
    // put out fires and smoke left over the city from the last attempt
    const c = new THREE.Vector3(STRIKE.hq.x, 0, STRIKE.hq.z);
    for (const f of g.fx.emitters) if (Math.hypot(f.pos.x - c.x, f.pos.z - c.z) < 9000 || Math.hypot(f.pos.x - STRIKE.fleet[0].x, f.pos.z - STRIKE.fleet[0].z) < 6000) { f.life = 0; if (f.light) f.light.life = 0; }
    this.ents = []; this.radars = []; this.ctrls = []; this.extra = []; this.shipList = []; this.jets = []; this.fleet = [];
    this.bunker = null; this.defenses = []; this.launchers = [];
  }

  // ---------------- queries ----------------
  // weapon engagement zones MAGIC warns about the first time you fly into them
  threatRings() {
    const out = [];
    if (this.samSite) out.push({ id: 'sa21', x: STRIKE.sam.x, z: STRIKE.sam.z, r: this.samSite.maxR, alive: this.samSite.track.alive,
      text: `${CS}, Magic, you're inside the SA-21 ring. Expect launches.`, plain: 'You are now in range of the big SAM site (24 km). A missile can come any time: watch for the BREAK cue, or fly low behind hills.' });
    if (this.pd) out.push({ id: 'sa15', x: STRIKE.sa15.x, z: STRIKE.sa15.z, r: 12000, alive: this.pd.e.alive,
      text: `${CS}, Magic, entering the SA-15 ring.`, plain: 'You are in range of the short-range SAM by the HQ (12 km).' });
    for (const e of this.fleet || []) if (e.alive) out.push({ id: 'fleet', x: e.pos.x, z: e.pos.z, r: 13000, alive: true,
      text: `${CS}, Magic, you're inside the surface group's SAM ring.`, plain: 'The enemy warships can shoot at you from here (13 km).' });
    return out;
  }
  get defensesLeft() { return (this.defenses || []).filter(e => e.alive).length; }
  get defensesTotal() { return (this.defenses || []).length; }
  currentTargets() {
    const set = new Set();
    if (this.state === 'sead') { for (const e of this.defenses) if (e.alive) set.add(e); if (this.bunker && this.bunker.alive) set.add(this.bunker); }
    else if (this.state === 'strike') { if (this.bunker && this.bunker.alive) set.add(this.bunker); }
    else if (this.state === 'fight') for (const j of this.jets) if (j.alive) set.add(j);
    return set;
  }
  objectiveText() {
    if (this.kind === 'strike') {
      const ships = (this.fleet || []).filter(e => e.alive).length;
      return `AIR DEFENSES ${this.defensesTotal - this.defensesLeft}/${this.defensesTotal} · BUNKER ${this.bunker && this.bunker.alive ? (this.bunker.hp < this.bunker.maxHp ? Math.round(this.bunker.hp / this.bunker.maxHp * 100) + '%' : 'INTACT') : 'DESTROYED'} · WARSHIPS ${ships}`;
    }
    if (this.kind === 'dogfight') return `ENEMY JETS LEFT ${this.jets.filter(j => j.alive).length}/${this.jets.length}`;
    return '';
  }

  // ---------------- events ----------------
  onDestroyed(e, byPlayer, byWing) {
    const g = this.g;
    if (!this.kind || this.ended) return;
    if (e.team !== 'red') return;
    if (byPlayer) { if (e.kind === 'air') this.stats.killsAir++; else if (e.kind === 'ship') this.stats.ships++; else this.stats.killsGround++; }
    else if (byWing) this.stats.wing++;
    if (e === this.bunker) {
      this.hqMesh.visible = false; this.rubble.visible = true;
      const p = this.bunker.pos.clone();
      g.fx.addFire(p.clone().add(new THREE.Vector3(0, 4, 0)), 3.2, 600);
      g.fx.addFire(p.clone().add(new THREE.Vector3(-40, 2, 10)), 1.6, 400); g.fx.addFire(p.clone().add(new THREE.Vector3(45, 2, -6)), 1.6, 400);
      for (let i = 0; i < 4; i++) setTimeout(() => g.fx.explosion(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 90, 4 + Math.random() * 10, (Math.random() - 0.5) * 50)), 5 + Math.random() * 3, { surface: 'target' }), 350 + i * 420);
      g.comms.call('awacs', `Shack! Good effects, the bunker is destroyed. ${CS}, mission complete. RTB.`, 'Direct hit: the command bunker is destroyed. Mission complete!', { pri: 6, urgent: true, ttl: 8, say: 'Shack! Good effects, the bunker is destroyed. Mission complete. R T B.' });
      this.finish(true, 'COMMAND BUNKER DESTROYED');
      return;
    }
    if (this.state === 'sead' && this.defenses.includes(e)) {
      const left = this.defensesLeft;
      if (left > 0) {
        g.msg(`AIR DEFENSES ${this.defensesTotal - left}/${this.defensesTotal} DESTROYED`, 3, '#ffe680');
        const L = DEF_CALLS[e.tag] || ['Good kill.', 'Air-defense target destroyed.'];
        g.comms.call('awacs', `Magic, good kill. ${L[0]} ${left === 1 ? 'One threat' : `${(NUMW[left] || left).toString().replace(/^./, c => c.toUpperCase())} threats`} remaining.`, `${L[1]} ${left} air-defense target${left > 1 ? 's' : ''} left.`, { pri: 2, ttl: 10 });
      } else {
        this.state = 'strike';
        g.msg('AIR DEFENSES DOWN! NOW DESTROY THE COMMAND BUNKER WITH THE BUNKER BUSTER (PRESS 4)', 6, '#ffe680');
        g.comms.call('awacs', `Magic, all SAMs and triple-A are down. ${CS}, cleared hot on the bunker.`, 'The city\'s air defenses are gone. Now hit the command bunker: press 4, mark it with T, release when the HUD says IN RANGE.', { pri: 4, ttl: 12 });
      }
    } else if (this.state === 'sead' && this.launchers && this.launchers.includes(e) && byPlayer) {
      g.comms.call('awacs', 'Magic, SAM launcher destroyed.', 'One of the big SAM site\'s missile launchers is destroyed. Its radars are what count, though.', { key: 'tel', every: 6, pri: 1, ttl: 6 });
    }
    if (this.kind === 'dogfight' && this.jets.length && this.jets.every(j => !j.alive)) this.finish(true, 'ALL ENEMY FIGHTERS DOWN');
  }
  // bomb damage assessment for the bunker buster
  onWeaponImpact(m, p) {
    const B = this.bunker; if (!B || !B.alive || m.key !== 'gbu31') return;
    if (B.hp >= B.maxHp) {
      const d = Math.hypot(p.x - B.pos.x, p.z - B.pos.z);
      this.g.msg(`MISSED — THE BOMB HIT ${Math.round(d)} M FROM THE BUNKER. MARK IT WITH T AND TRY AGAIN`, 4, '#ff9080');
      this.g.comms.call('awacs', `${CS}, Magic, miss. Impact ${Math.round(d)} meters from the bunker.`, 'The bunker buster missed. Mark the bunker with T and release when the HUD says IN RANGE.', { key: 'miss', every: 5, pri: 3, ttl: 6 });
    }
  }
  onPlayerKilled(reason) { if (this.kind && !this.ended) this.finish(false, reason || 'SHOT DOWN'); }

  finish(success, headline) {
    const g = this.g;
    this.ended = true; this.success = success; this.headline = headline;
    this.endT = g.time + (success ? 4.5 : 3.5);
    this.state = success ? 'done' : 'failed';
    const W = g.wingman;
    if (success && W && W.alive) g.comms.later(7, () => { if (g.wingman === W) W.say('nice work, lead. Rejoining for the trip home.', 'Your wingman comes back to your right wing for the flight home.', { pri: 1, ttl: 10 }); });
  }

  update(dt) {
    if (!this.kind) return;
    if (this.ewCtl) this.ewCtl.update(dt);
    if (this.ended && this.endT && this.g.time >= this.endT) {
      if (!this.success && this.g.player.wreck && this.g.time < this.endT + 8) return; // let the burning wreck hit the ground first
      this.endT = 0; if (this.onEnd) this.onEnd(this.report());
    }
  }

  report() {
    const g = this.g, P = g.player, S = this.stats;
    const t = Math.max(0, g.time - S.t0);
    const items = [];
    if (this.kind === 'strike') {
      for (const e of this.defenses) items.push({ ok: !e.alive, text: tagOf(e) });
      items.push({ ok: this.bunker && !this.bunker.alive, text: 'COMMAND BUNKER', big: true });
      for (const e of this.fleet || []) items.push({ ok: !e.alive, text: `${tagOf(e)} (optional)` });
    } else for (const j of this.jets) items.push({ ok: !j.alive, text: j.name });
    const W = g.wingman, wk = `${S.wing} KILL${S.wing === 1 ? '' : 'S'}`;
    if (W) items.push({ ok: W.alive, text: W.alive ? `WINGMAN SPEAR 1-2 MADE IT · ${wk}` : `WINGMAN SPEAR 1-2 SHOT DOWN · ${wk}` });
    let grade = '';
    if (this.success) {
      const dmg = 100 - (P.hp || 0);
      grade = t < 300 && dmg < 30 ? 'A — OUTSTANDING' : t < 600 && dmg < 60 ? 'B — SOLID WORK' : 'C — MISSION ACCOMPLISHED';
    }
    return { success: this.success, kind: this.kind, headline: this.headline, time: t, items, grade, kills: S.killsAir + S.killsGround + S.ships, hp: P.hp };
  }
}
