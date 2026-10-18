// AEGIS SPEAR — game controller: world assembly, fixed-step simulation, controls, cameras, rendering.
import * as THREE from 'three';
import { GU } from '../render/glsl.js';
import { Pipeline, SENSOR } from '../render/pipeline.js';
import { Sky } from '../render/sky.js';
import { initCloudTextures, cloudBulkCPU } from '../render/clouds.js';
import { Terrain, SITES, ROADS, TER } from '../world/terrain.js';
import { Ocean } from '../world/ocean.js';
import { buildCarrier, buildDestroyer, DECK_Y, CATS, LANDING, landingPoint } from '../models/carrier.js';
import { buildBuildingGeometry, buildTreeGeometry, buildEnemyFighter, buildTruck } from '../models/units.js';
import { JET_GEOM } from '../models/fighter.js';
import { Ship, makeSurfaceQuery, CarrierOps } from '../sim/carrierOps.js';
import { World, Entity, tagOf } from './world.js';
import { Player, missionLoadout } from './player.js';
import { AIJet, SamSite, PointDefense, Flak, Tank, groundEntity, ShipDefense } from './ai.js';
import { Helo } from './helo.js';
import { Wingman, ORDERS } from './wingman.js';
import { sweepDrones, droneKilled } from './drones.js';
import { Bullets, DEFS } from '../sim/weapons.js';
import { computeRWR } from '../sim/radar.js';
import { FX, PT } from '../fx/fx.js';
import { AudioEngine } from '../audio/audio.js';
import { HUD, drawRadarMFD, drawRWRMFD } from '../ui/hud.js';
import { Input } from './input.js';
import { CameraRig } from './cameras.js';
import { FlightAssist, LandingAssist, onSpeedTAS } from './assist.js';
import { Missions, STRIKE, CITY_KEEP_OUT } from './mission.js';
import { Radio, CS } from './radio.js';
import { attachLights, updateLights, shipLights, carrierLights } from '../fx/navlights.js';
import { KTS, FT, G0, isa } from '../sim/atmo.js';
import { mulberry32 } from '../core/noise.js';

const D2R = Math.PI / 180;
const DT = 1 / 120;
// per menu weather: cloud cover (about the fraction of sky clouded), how grey that leaves the sky light, and how
// ruffled the sea's surface is (ripples and short chop; the swell the ships ride stays the same)
const WEATHER = {
  clear: { cover: 0, grey: 0, rough: 0.4 }, scattered: { cover: 0.42, grey: 0.06, rough: 0.5 },
  broken: { cover: 0.62, grey: 0.25, rough: 0.55 }, overcast: { cover: 0.93, grey: 0.75, rough: 1 },
};
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Game {
  constructor(container, opts) {
    this.container = container; this.opts = opts;
    this.time = 0; this.msgs = []; this.kills = 0; this.paused = false; this.frameN = 0;
    this.wind = new THREE.Vector3(7.5, 0, 0); // blowing toward the east -> carrier steams west into it
    this.sensorMain = SENSOR.NORMAL; this.sensorSeeker = SENSOR.WHOT; this.tgpMode = SENSOR.WHOT;
    this.catStroke = null; this.gciSees = false; this.missileCamIdx = 0;
    this.wingman = null; this.wingMenu = false; this.wingMenuT = 0;
    this.aiJets = []; this.drones = [];
  }

  async init(progress = () => { }) {
    const step = async (msg, f) => { progress(msg, f); await new Promise(r => setTimeout(r, 16)); };
    const W = innerWidth, H = innerHeight;
    await step('Initializing WebGL2 renderer', 0.02);
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, this.opts.quality === 'high' ? 1.5 : 1));
    r.setSize(W, H); r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.shadowMap.enabled = this.opts.quality !== 'low'; r.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(r.domElement); r.domElement.className = 'gl';
    this.hudCanvas = document.createElement('canvas'); this.hudCanvas.className = 'hud'; this.container.appendChild(this.hudCanvas);
    this.hud = new HUD(this.hudCanvas);
    const scale = { low: 0.7, medium: 0.9, high: 1 }[this.opts.quality] || 0.9;
    this.pipe = new Pipeline(r, W * r.getPixelRatio(), H * r.getPixelRatio(), { quality: this.opts.quality, scale });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, W / H, 0.05, 200000);
    await step('Synthesizing cloud noise volumes', 0.06);
    initCloudTextures(r);
    const wx = WEATHER[this.opts.weather] || WEATHER.scattered; GU.uCloudCover.value = wx.cover;
    this.sky = new Sky(r); this.sky.setTime(this.opts.hour != null ? this.opts.hour : 9.5); this.sky.setOvercast(wx.grey);
    this.scene.add(this.sky.dome, this.sky.sunLight, this.sky.sunLight.target);
    await step('Generating island terrain (ridges, canyons, coast)', 0.12);
    this.terrain = new Terrain();
    this.terrain.generate();
    await step('Building terrain LOD and shadows', 0.45);
    this.terrain.build(r); this.scene.add(this.terrain.group);
    this.ocean = new Ocean(this.terrain, r); this.ocean.setShoreTexture(this.terrain.nTex); this.scene.add(this.ocean.mesh);
    this.ocean.uniforms.uRough.value = wx.rough;
    this.weatherData = GU.uWeatherTex.value.image.data;
    this.clock = { t: 0 };
    await step('Launching carrier strike group', 0.55);
    this.world = new World(this);
    this.ships = [];
    const cvn = buildCarrier(); this.carrierModel = cvn; this.scene.add(cvn.root); attachLights(cvn.root, carrierLights(), { phase: 0 });
    this.carrier = new Ship(cvn, { name: 'CVN-90', x: 6000, z: 38000, heading: 270, speed: 12.9, deck: true, hp: 20000, team: 'blue' });
    this.ships.push(this.carrier);
    // escorts: two destroyers and a frigate (a scaled destroyer). Their air defense is set up in populate()
    for (const f of [{ name: 'HALSEY', dx: -2600, dz: -1400, k: 1 }, { name: 'KIDD', dx: 2200, dz: 1900, k: 1 }, { name: 'CONSTELLATION', dx: -1800, dz: 2600, k: 0.78 }]) {
      const dd = buildDestroyer(); dd.root.scale.setScalar(f.k); this.scene.add(dd.root); attachLights(dd.root, shipLights(155, 20, 30));
      const info = dd.info; info.length *= f.k; info.beam *= f.k; info.deckY *= f.k; info.draft *= f.k;
      info.hitSpheres = info.hitSpheres.map(h => ({ c: h.c.clone().multiplyScalar(f.k), r: h.r * f.k }));
      const s = new Ship(dd, { name: f.name, x: 6000 + f.dx, z: 38000 + f.dz, heading: 270, speed: 12.9, hp: 6000 * f.k, team: 'blue' }); s.scale = f.k; this.ships.push(s);
    }
    for (const s of this.ships) { const e = new Entity(this.world, { team: 'blue', kind: 'ship', name: s.name, label: 'CV', radius: s.length / 2, hp: s.hp, root: s.root, hitSpheres: s.model.info.hitSpheres, rcs: 5000 }); e.ship = s; s.entity = e; this.world.add(e); }
    // plane guard helicopter off the carrier's starboard side; the frigate's helicopter circles it, ahead of the group
    // (both stay clear of the landing approach, which comes in from astern)
    this.helos = [new Helo(this, { ship: this.carrier, at: [750, 250], r: 350, alt: 60, speed: 30, dir: 1 }),
      new Helo(this, { ship: this.ships[3], at: [0, 0], r: 1300, alt: 120, speed: 45, dir: -1, phase: 2 })];
    this.env = { surfaceAt: makeSurfaceQuery(this.terrain, this.ocean, this.ships, this.clock), wind: this.wind };
    this.surfaceAt = this.env.surfaceAt;
    this.ops = new CarrierOps(this.carrier, cvn, this);
    await step('Populating the battlefield', 0.65);
    this.fx = new FX(this, this.pipe);
    this.bullets = new Bullets(this, 5000);
    this.audio = new AudioEngine();
    this.comms = new Radio(this); // radio calls with plain-English subtitles
    this.player = new Player(this, this.opts.loadout || 'multirole'); this.world.add(this.player);
    this.populate();
    this.buildScenery();
    this.buildVaporCone();
    await step('Compiling shaders', 0.85);
    this.input = new Input(r.domElement); this.input.wantLock = false;
    this.assist = new FlightAssist(); this.landAssist = new LandingAssist();
    this.rig = new CameraRig(this.camera);
    this.setupScenario(this.opts.scenario || 'carrier');
    // TGP sensor pipeline
    this.tgpCam = new THREE.PerspectiveCamera(5, 1, 0.5, 200000);
    this.tgpPipe = new Pipeline(r, 320, 320, { quality: 'low', scale: 1, flare: false, reflect: false });
    // the sea's reflection leaves out the sea itself and the cockpit around the camera
    this.pipe.refl = { hide: [this.ocean.mesh, this.player.model.cockpit.group], dome: this.sky.dome, terrain: this.terrain };
    this.tgpRT = new THREE.WebGLRenderTarget(320, 320, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.pipQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.tgpRT.texture, depthTest: false, depthWrite: false, toneMapped: false }));
    this.pipScene = new THREE.Scene(); this.pipScene.add(this.pipQuad); this.pipCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // MFD canvases
    this.mfdL = this.makeCanvasTex(512); this.mfdC = this.makeCanvasTex(256);
    const ck = this.player.model.cockpit; ck.mfdL.material.map = this.mfdL.tex; ck.mfdR.material.map = this.tgpRT.texture; ck.mfdC.material.map = this.mfdC.tex;
    ck.mfdL.material.needsUpdate = ck.mfdR.material.needsUpdate = ck.mfdC.material.needsUpdate = true;
    for (const mm of [ck.mfdL, ck.mfdR, ck.mfdC]) mm.material.color.setRGB(2.4, 2.4, 2.4);
    // warm up: env map, terrain shadows
    this.sky.update(this.camera.position, 0);
    this.scene.environment = this.sky.updateEnv();
    this.terrain.updateShadows(GU.uSunDir.value);
    this.applyNight();
    // first render to compile programs
    this.rig.update(0.016, this, this.input);
    r.compile(this.scene, this.camera);
    await step('Ready', 1);
    addEventListener('resize', () => this.resize());
  }

  makeCanvasTex(n) { const c = document.createElement('canvas'); c.width = c.height = n; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return { c, ctx: c.getContext('2d'), tex, n }; }
  resize() {
    const W = innerWidth, H = innerHeight; const pr = this.renderer.getPixelRatio();
    this.renderer.setSize(W, H); this.camera.aspect = W / H; this.camera.updateProjectionMatrix();
    this.pipe.setSize(W * pr, H * pr); this.hud.resize();
  }
  applyNight() {
    const night = GU.uNight.value;
    // building windows glow at night
    for (const m of this.nightMats || []) m.emissive.setRGB(night * 2.2, night * 1.8, night * 1.3);
  }

  // ---------------- world population ----------------
  populate() {
    const T = this.terrain;
    // enemy integrated air defense around the city, the HQ bunker, the enemy fleet and fighters are owned by the
    // mission manager (spawned fresh for every attempt)
    this.sams = []; this.pointDef = []; this.shipDefs = [];
    // the escorts' SAMs and guns cover the carrier group against enemy jets and the missiles they fire. Friendly, so
    // they live outside the mission manager and stay through restarts (Missions.begin refills their magazines). Their
    // big fleet radars mostly ignore chaff and beaming, which is what makes them a safe place to run to
    for (const s of this.ships) if (s.team === 'blue' && s !== this.carrier) {
      this.shipDefs.push(new ShipDefense(this, s, s.entity, { team: 'blue', name: s.name, label: 'SPY', mastH: 24 * s.scale, sam: 16, samRange: 10000, eccm: 0.9, notchV: 8, onShot: (T) => this.escortShot(s, T) }));
    }
    // armor column advancing down the valley road toward friendly positions
    const road = ROADS[1].slice().reverse();
    const start = road.findIndex(([x, z]) => x < 11000); const path = road.slice(Math.max(0, start - 1));
    this.tanks = [];
    const colStart = [11000, -1600];
    for (let i = 0; i < 6; i++) {
      const apc = i === 2 || i === 5;
      this.tanks.push(new Tank(this, { team: 'red', apc, x: colStart[0] + i * 35, z: colStart[1] - i * 60, heading: 210, path: path.slice(1), speed: 3.2 }));
    }
    this.flak = [new Flak(this, { x: 11200, z: -2100, heading: 210 }), new Flak(this, { x: 9200, z: 600, heading: 210 })];
    // friendly armor at the front line
    for (const [dx, dz, apc] of [[-80, 120, false], [60, 160, false], [10, 260, true]]) this.tanks.push(new Tank(this, { team: 'blue', apc, x: SITES.frontline.x + dx, z: SITES.frontline.z + dz, heading: 30 }));
    // airbase structures (destructible targets)
    const A = SITES.airbase;
    this.structures = [];
    const addStruct = (kind, x, z, rot, name, hp) => {
      const { geometry, material } = buildBuildingGeometry(kind);
      const m = new THREE.Mesh(geometry, material); m.castShadow = true; m.receiveShadow = true;
      const y = T.heightAt(x, z); m.position.set(x, y, z); m.rotation.y = rot; this.scene.add(m);
      geometry.computeBoundingSphere();
      const e = new Entity(this.world, { team: 'red', kind: 'structure', name, label: 'B', radius: geometry.boundingSphere.radius * 0.8, hp, root: m, rcs: 500, ir: 0.4, value: 15 });
      e.pos.copy(geometry.boundingSphere.center).applyMatrix4(m.matrix.compose(m.position, m.quaternion, m.scale)); e.mats = { m: material };
      e.hitSpheres = [{ c: geometry.boundingSphere.center.clone(), r: geometry.boundingSphere.radius * 0.75 }];
      this.world.add(e); this.structures.push(e); return e;
    };
    for (let i = 0; i < 3; i++) addStruct('hangar', A.x - 600 + i * 260, A.z - 260, 0, 'HANGAR', 600);
    for (let i = 0; i < 4; i++) addStruct('shelter', A.x + 250 + i * 120, A.z - 220, 0, 'AIRCRAFT SHELTER', 450);
    addStruct('tower', A.x - 120, A.z - 200, 0, 'CONTROL TOWER', 300);
    for (let i = 0; i < 3; i++) addStruct('tank', A.x + 820 + i * 34, A.z - 300, 0, 'FUEL DEPOT', 160);
    // parked enemy jets on the apron (targets)
    for (let i = 0; i < 3; i++) {
      const f = buildEnemyFighter('striker'); const x = A.x - 250 + i * 60, z = A.z - 150;
      f.root.position.set(x, T.heightAt(x, z) + 2.4, z); f.root.rotation.y = Math.PI; this.scene.add(f.root);
      const e = new Entity(this.world, { team: 'red', kind: 'structure', name: 'PARKED FLANKER', label: 'AC', radius: 11, hp: 60, root: f.root, hitSpheres: f.info.hitSpheres, value: 25, ir: 0.5 });
      e.pos.copy(f.root.position); e.mats = f.mats; this.world.add(e); this.structures.push(e);
    }
    // trucks near the SAM site
    for (let i = 0; i < 3; i++) groundEntity(this, buildTruck(i === 1 ? 'fuel' : 'cargo'), { x: SITES.samPlateau.x - 200 + i * 14, z: SITES.samPlateau.z + 150, team: 'red', name: 'SUPPLY TRUCK', hp: 60, heading: 90 });
    // enemy air
    this.aiJets = [];
    this.mission = new Missions(this);
    this.mission.spawnWorld(2);
  }

  spawnCAP() {
    const names = ['FLANKER 1', 'FLANKER 2'];
    for (let i = 0; i < 2; i++) {
      const j = new AIJet(this, { name: names[i], pos: new THREE.Vector3(-3000 + i * 1500, 6500 + i * 400, -9000 - i * 800), heading: 90 + i * 20, speed: 230, cap: new THREE.Vector3(0, 6500, -4000), capAlt: 6500 + i * 500 });
      this.world.add(j); this.aiJets.push(j);
    }
  }

  buildScenery() {
    const T = this.terrain; const rnd = mulberry32(77);
    // city buildings (instanced per type)
    const C = SITES.city; const kinds = ['apartment', 'office', 'house', 'industrial', 'warehouse', 'midrise', 'highrise1', 'highrise2', 'highrise3'];
    const lists = {}; for (const k of kinds) lists[k] = [];
    const keepOut = (x, z, pad = 0) => CITY_KEEP_OUT.some(k => Math.hypot(x - k.x, z - k.z) < k.r + pad);
    // downtown core: a tight street grid of glass towers with two landmark skyscrapers
    let landmarks = 0;
    for (let gx = -7; gx <= 7; gx++) for (let gz = -4; gz <= 4; gz++) {
      const x = C.x + gx * 64 + (gx > 0 ? 18 : 0), z = C.z + gz * 64 + (gz > 0 ? 18 : 0); // wider avenues through the centre
      const dc = Math.hypot((x - C.x) / C.rx, (z - C.z) / C.rz);
      if (dc > 0.34 || keepOut(x, z, 30) || rnd() < 0.07) continue;
      const r = rnd(); let k;
      if (dc < 0.13 && landmarks < 2 && r < 0.45) { k = 'highrise3'; landmarks++; }
      else k = r < 0.34 ? 'highrise2' : r < 0.7 ? 'highrise1' : 'midrise';
      lists[k].push([x, z, rnd() < 0.5 ? 0 : Math.PI / 2, 0.85 + rnd() * 0.4]);
    }
    for (let gx = -14; gx <= 14; gx++) for (let gz = -9; gz <= 9; gz++) {
      const x = C.x + gx * 85 + (rnd() - 0.5) * 20, z = C.z + gz * 85 + (rnd() - 0.5) * 20;
      const f = T.featuresAt(x, z); if (f[1] < 0.35 || rnd() < 0.18) continue;
      const dc = Math.hypot((x - C.x) / C.rx, (z - C.z) / C.rz);
      if (dc < 0.37 || keepOut(x, z, 20)) continue;
      const k = dc < 0.35 ? (rnd() < 0.5 ? 'office' : 'apartment') : dc < 0.7 ? (rnd() < 0.6 ? 'apartment' : 'house') : (rnd() < 0.5 ? 'house' : rnd() < 0.5 ? 'industrial' : 'warehouse');
      lists[k].push([x, z, rnd() < 0.5 ? 0 : Math.PI / 2, 0.8 + rnd() * 0.5]);
    }
    // port industry
    for (let i = 0; i < 14; i++) { const x = SITES.port.x + (rnd() - 0.5) * 900, z = SITES.port.z + (rnd() - 0.5) * 500; if (T.heightAt(x, z) > 2) lists[rnd() < 0.5 ? 'warehouse' : 'industrial'].push([x, z, rnd() * Math.PI, 1]); }
    this.nightMats = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (const k of kinds) {
      const L = lists[k]; if (!L.length) continue;
      const { geometry, material } = buildBuildingGeometry(k);
      const im = new THREE.InstancedMesh(geometry, material, L.length); im.castShadow = true; im.receiveShadow = true;
      L.forEach(([x, z, r, s], i) => { const hs = k === 'office' || k === 'apartment' || k.startsWith('highrise') || k === 'midrise' ? s : 1; m4.compose(_v.set(x, T.heightAt(x, z) - 0.5, z), q.setFromAxisAngle(_v2.set(0, 1, 0), r), sc.set(1, hs, 1)); im.setMatrixAt(i, m4); });
      im.computeBoundingSphere(); this.scene.add(im);
      if (material.emissiveMap) this.nightMats.push(material);
    }
    // chimneys & tanks in the port
    for (const [k, n] of [['chimney', 3], ['tank', 5]]) {
      const { geometry, material } = buildBuildingGeometry(k); const im = new THREE.InstancedMesh(geometry, material, n);
      for (let i = 0; i < n; i++) { const x = SITES.port.x - 200 + i * 70, z = SITES.port.z - 250 + (k === 'tank' ? 90 : 0); m4.compose(_v.set(x, T.heightAt(x, z), z), q.identity(), sc.set(1, 1, 1)); im.setMatrixAt(i, m4); }
      im.computeBoundingSphere(); im.castShadow = true; this.scene.add(im);
    }
    // forests
    const pine = buildTreeGeometry('pine'), broad = buildTreeGeometry('broad');
    const tp = [], tb = [];
    const maxTrees = this.opts.quality === 'low' ? 3500 : this.opts.quality === 'high' ? 14000 : 8000;
    for (let i = 0; i < maxTrees * 6 && tp.length + tb.length < maxTrees; i++) {
      const x = (rnd() - 0.5) * 30000, z = (rnd() - 0.5) * 26000; const f = T.featuresAt(x, z);
      if (f[2] < 0.35 || rnd() > f[2]) continue;
      const h = T.heightAt(x, z); if (h < 3) continue;
      (h > 450 || rnd() < 0.4 ? tp : tb).push([x, h, z, 0.7 + rnd() * 0.7, rnd() * 6.28]);
    }
    for (const [geo, list] of [[pine, tp], [broad, tb]]) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geo.geometry, geo.material, list.length); im.castShadow = false; im.receiveShadow = true;
      list.forEach(([x, y, z, s, r], i) => { m4.compose(_v.set(x, y - 0.3, z), q.setFromAxisAngle(_v2.set(0, 1, 0), r), sc.set(s, s, s)); im.setMatrixAt(i, m4); });
      im.computeBoundingSphere(); this.scene.add(im);
    }
    // runway with markings
    const A = SITES.airbase;
    const rwTex = (() => { const c = document.createElement('canvas'); c.width = 2048; c.height = 64; const x = c.getContext('2d');
      x.fillStyle = '#4a4a46'; x.fillRect(0, 0, 2048, 64); x.fillStyle = 'rgba(30,30,30,0.5)'; for (let i = 0; i < 400; i++) x.fillRect(Math.random() * 2048, Math.random() * 64, 30, 2);
      x.fillStyle = '#e8e8e2'; for (let i = 80; i < 1968; i += 40) x.fillRect(i, 31, 22, 2);
      for (const e of [8, 2014]) for (let k = 0; k < 8; k++) x.fillRect(e + (e > 1000 ? -10 : 0), 6 + k * 7, 26, 4);
      x.fillRect(0, 2, 2048, 1.5); x.fillRect(0, 60.5, 2048, 1.5);
      x.font = 'bold 26px Arial'; x.save(); x.translate(60, 32); x.rotate(Math.PI / 2); x.textAlign = 'center'; x.fillText('09', 0, 9); x.restore(); x.save(); x.translate(1988, 32); x.rotate(-Math.PI / 2); x.textAlign = 'center'; x.fillText('27', 0, 9); x.restore();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; })();
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(A.len, A.wid), new THREE.MeshStandardMaterial({ map: rwTex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2 }));
    rw.rotation.x = -Math.PI / 2; rw.position.set(A.x, A.elev + 0.25, A.z); rw.receiveShadow = true; this.scene.add(rw);
  }

  buildVaporCone() {
    const g = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.62); g.scale(3.3, 3.3, 5.5); g.rotateX(-Math.PI / 2); g.translate(0, 0.2, 0.5);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 }, uNoiseTex: GU.uNoiseTex, uTime: GU.uTime, uSkyAmb: GU.uSkyAmb, uSunColor: GU.uSunColor },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uA; uniform sampler2D uNoiseTex; uniform float uTime; uniform vec3 uSkyAmb; uniform vec3 uSunColor; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ float rim = 1.0 - abs(dot(vN, vV)); float n = texture(uNoiseTex, vec2(atan(vP.x, vP.y) * 0.5, vP.z * 0.08 - uTime * 2.0)).r;
          float edge = smoothstep(-5.5, -1.0, vP.z) * smoothstep(3.0, 0.0, vP.z);
          float a = uA * (0.35 + 0.65 * rim) * smoothstep(0.3, 0.75, n) * edge * 0.75;
          gl_FragColor = vec4(vec3(0.95) * (uSkyAmb * 1.3 + uSunColor * 0.06), a); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(g, mat); m.position.set(0, 0, -1.0); m.renderOrder = 10; m.frustumCulled = false;
    this.player.model.root.add(m);
    this.vaporCone = { set: (k) => { mat.uniforms.uA.value += (k - mat.uniforms.uA.value) * 0.2; m.visible = mat.uniforms.uA.value > 0.01; } };
  }

  // ---------------- scenarios ----------------
  setupScenario(name) {
    const P = this.player, ac = P.ac, ops = this.ops;
    ac.extForce = null; ac.kinematic = null; ops.release(ac); ops.cat.state = 'none'; ops.trap = null; ops.passTrack.length = 0; ops.prevTipLocal = null; ac.crashed = null;
    if (P.wreck) { if (P.wreck.fire) P.wreck.fire.life = 0; if (P.wreck.trail) P.wreck.trail.stop(); P.wreck = null; }
    this.respawnT = 0; P.killed = false;
    P.alive = true; P.hp = 100; P.root.visible = true; ac.health = 100; ac.engineHealth = 1; ac.fuel = 6560 * 0.9; ac.maxG = 1;
    ac.ctl.limiter = true; this.scenario = name; if (this.assist) { this.assist.reset(); this.landAssist.reset(); }
    const yawQ = (hdg) => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -hdg * D2R, 0));
    if (name === 'carrier' || name === 'deck') {
      ac.gear = 1; ac.ctl.gearCmd = 1; ac.ctl.hookCmd = 0; ac.rpm = 0.72; ac.ab = 0; ac.ctl.throttle = 0;
      if (name === 'carrier') { ops.placeOnCat(ac, 0); this.msg('ON THE CATAPULT — FOLLOW THE STEPS ON THE LEFT', 6); }
      else {
        const p = this.carrier.toWorld(new THREE.Vector3(CATS[0].x, DECK_Y + 2.05, CATS[0].z0 + 6.25 + 45));
        ac.reset(p, this.carrier.quat.clone(), this.carrier.vel.clone());
        this.msg('TAXI ONTO THE CATAPULT — FOLLOW THE STEPS ON THE LEFT', 7);
      }
      this.rig.setMode('chase');
    } else if (name === 'approach') {
      const sh = this.carrier;
      const p = this.approachPoint(2600);
      const fwdW = new THREE.Vector3(LANDING.dir.x, 0, LANDING.dir.y).applyQuaternion(sh.quat).normalize();
      const hdg = Math.atan2(fwdW.x, -fwdW.z) / D2R;
      const q = yawQ(hdg).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 5 * D2R));
      this.loadWeapons();
      // start on speed (on-speed angle of attack) and on the glide slope. sh.vel is still zero before the ship's first
      // update, so take the ship's velocity from its heading and speed
      const shipV = new THREE.Vector3(Math.sin(sh.heading), 0, -Math.cos(sh.heading)).multiplyScalar(sh.speed);
      const air = shipV.clone().sub(this.wind), fa = fwdW.dot(air), Va = onSpeedTAS(ac, isa(p.y).rho);
      const closure = -fa + Math.sqrt(Math.max(0, fa * fa - air.lengthSq() + Va * Va));
      ac.reset(p, q, fwdW.clone().multiplyScalar(closure).add(shipV).add(new THREE.Vector3(0, -closure * Math.tan(LANDING.glide * D2R), 0)));
      ac.gear = 1; ac.ctl.gearCmd = 1; ac.ctl.hookCmd = 1; ops.hookAngle = 1.1; ac.rpm = 0.86; ac.ctl.throttle = 0.45; ac.flap = 1;
      this.msg('LANDING — FOLLOW THE STEPS ON THE LEFT', 6);
      this.rig.setMode('cockpit');
    } else {
      // airborne strike start south of the island
      // city strike: 30 km south of the city over the sea, outside the SAM envelope; dogfight: over the strait;
      // campaign: the stage's own start (st.dx/dz: from the carrier)
      // ring course: before the first ring, or (practice respawn) just past the last ring flown
      const ctl = this.mission.ctl, rs = name === 'rings' && ctl && ctl.startPoint ? ctl.startPoint() : null;
      const st = name === 'campaign' && this.mission.stage ? this.mission.stage.start : rs ? { x: rs.pos.x, y: rs.pos.y, z: rs.pos.z, hdg: rs.hdg, v: rs.v } : null, cv = this.carrier.pos;
      const p = st ? new THREE.Vector3(st.dx != null ? cv.x + st.dx : st.x, st.y, st.dz != null ? cv.z + st.dz : st.z)
        : name === 'strike' ? new THREE.Vector3(2500, 4500, 36000) : new THREE.Vector3(2000, 4200, 33000);
      const hdg = st ? st.hdg : name === 'strike' ? 0 : 340;
      ac.reset(p, yawQ(hdg), new THREE.Vector3(Math.sin(hdg * D2R), 0, -Math.cos(hdg * D2R)).multiplyScalar(st ? st.v : name === 'strike' ? 230 : 240));
      ac.gear = 0; ac.ctl.gearCmd = 0; ac.ctl.hookCmd = 0; ac.rpm = 0.92; ac.ctl.throttle = 0.75; ops.hookAngle = 0;
      this.rig.setMode('chase');
    }
    P.sync();
  }

  // practice mode: put the player back where the scenario starts, mission progress kept
  practiceRespawn() {
    const P = this.player; this.respawnT = 0;
    if (P.wreck) { if (P.wreck.fire) P.wreck.fire.life = 0; if (P.wreck.trail) P.wreck.trail.stop(); P.wreck = null; }
    const name = this.scenario === 'deck' ? 'carrier' : this.scenario;
    if (name === 'carrier') this.respawnOnCat(); else { this.setupScenario(name); this.loadWeapons(); }
    P.root.visible = true; this.rig.setMode('chase');
    this.msg('PRACTICE: RESPAWNED — KEEP GOING', 2.5, '#b0ffb0');
    // practice: a lost wingman comes back too; one still flying rejoins at the start point (unless he's busy)
    const W = this.wingman;
    if (!W || !W.alive) this.spawnWingman(name);
    else if (name !== 'carrier' && !W.deck && !W.fighting() && !W.strike) W.placeInSlot();
  }

  // ---------------- wingman ----------------
  // Spear 1-2 flies every mission except landing practice and the ring course: in formation when the flight starts
  // in the air, on catapult 2 when it starts on the carrier (he launches a few seconds after the player, see onCatShot)
  spawnWingman(scenario) {
    this.clearWingman();
    if (this.attract || scenario === 'approach' || scenario === 'rings') return null;
    const P = this.player, deck = scenario === 'carrier' || scenario === 'deck', st = scenario === 'campaign' && this.mission.stage;
    const W = new Wingman(this, { loadout: st ? st.wing : scenario === 'air' ? 'air' : 'strike', deck, pos: P.pos });
    this.world.add(W); this.aiJets.push(W); this.wingman = W;
    if (!deck) W.placeInSlot();
    this.comms.later(deck ? 3 : 4, () => { if (this.wingman === W) W.checkIn(); });
    return W;
  }
  clearWingman() { if (this.wingman) this.wingman.despawn(); this.wingman = null; this.wingMenu = false; }
  wingmanLost(src) {
    this.wingMenu = false;
    const by = src === this.player ? '' : src && src.kind === 'air' ? ` by ${src.name}` : src && (src.kind === 'sam' || src.kind === 'ground') ? ' by ground fire' : src && src.kind === 'ship' ? ' by a warship' : '';
    this.msg(src === this.player ? 'FRIENDLY FIRE — YOU HIT YOUR WINGMAN' : 'YOUR WINGMAN SPEAR 1-2 WAS SHOT DOWN', 4, '#ff9080');
    this.comms.call('awacs', 'Spear 1-2 is down, good chute. SAR is launching.', `Your wingman was shot down${by}. He ejected and a rescue helicopter is on the way. You fly alone from here.`, { pri: 5, ttl: 8, say: 'Spear one-two is down, good chute. Search and rescue is launching.' });
  }
  // the menu's weapons pick, loaded the way the mission needs it
  loadWeapons() { const P = this.player, M = this.mission; P.applyLoadout(missionLoadout(P.loadoutName, M && M.kind, M && M.stage && M.stage.loadout)); }
  respawnOnCat() {
    const P = this.player; this.loadWeapons(); P.trails.smoke && P.trails.smoke.stop(); P.trails.smoke = null;
    this.ops.release(P.ac); this.ops.trap = null; this.setupScenario('carrier');
    this.msg('REARMED AND REFUELED — BACK ON THE CATAPULT', 3);
  }
  // world point at glide-slope height `back` metres behind the touchdown point and `right` metres to starboard of the
  // landing line (where the jet's centre is when the hook is on the glide slope)
  approachPoint(back, right = 0, out = new THREE.Vector3()) {
    const T = landingPoint(LANDING.targetS);
    out.set(T.x - LANDING.dir.x * back + LANDING.perp.x * right, DECK_Y + back * Math.tan(LANDING.glide * D2R) + 4, T.y - LANDING.dir.y * back + LANDING.perp.y * right);
    return this.carrier.toWorld(out, out);
  }
  // landing practice: Enter puts the jet back at the start of the approach, any time
  retryApproach() {
    const P = this.player; P.trails.smoke && P.trails.smoke.stop(); P.trails.smoke = null;
    this.setupScenario('approach');
    this.msgs = []; this.comms.clear(); this.comms.later(0.8, () => this.comms.opening('approach'));
    this.msg('BACK BEHIND THE SHIP — HERE WE GO AGAIN', 3, '#b0ffb0');
  }

  // ---------------- helpers used by subsystems ----------------
  msg(text, dur = 2, color) { this.msgs = this.msgs.filter(m => m.text !== text); this.msgs.push({ text, t: dur, color }); if (this.msgs.length > 5) this.msgs.shift(); }
  radio(text, team, plain) { this.comms.call(team === 'red' ? 'enemy' : 'awacs', text, plain || '', { pri: 1, ttl: 6 }); }
  get sunDir() { return GU.uSunDir.value; }
  // how much light (or a seeker's view) gets through the clouds between a and b, 0..1
  cloudTransmittance(a, b) {
    const base = GU.uCloudBase.value, top = GU.uCloudTop.value; if (GU.uCloudCover.value <= 0.005) return 1;
    const d = _v3.copy(b).sub(a); const L = d.length(); if (L < 1) return 1; d.multiplyScalar(1 / L);
    let t0, t1; if (Math.abs(d.y) < 1e-4) { if (a.y < base || a.y > top) return 1; t0 = 0; t1 = L; } else { const ta = (base - a.y) / d.y, tb = (top - a.y) / d.y; t0 = Math.max(Math.min(ta, tb), 0); t1 = Math.min(Math.max(ta, tb), L); }
    if (t1 <= t0) return 1;
    const W = this.weatherData; let od = 0; const n = 6;
    for (let i = 0; i < n; i++) {
      const t = t0 + (i + 0.5) / n * (t1 - t0);
      od += cloudBulkCPU(W, 512, a.x + d.x * t, a.y + d.y * t, a.z + d.z * t) * (t1 - t0) / n;
    }
    return Math.exp(-od * 0.02);
  }
  raycastGround(o, dir, maxD) {
    let t = 0, step = 20;
    while (t < maxD) {
      t += step; step = Math.min(step * 1.08, 250);
      const x = o.x + dir.x * t, y = o.y + dir.y * t, z = o.z + dir.z * t;
      const h = Math.max(this.terrain.heightAt(x, z), 0);
      if (y <= h) return new THREE.Vector3(x, h, z);
    }
    return null;
  }
  findEmitter(p) {
    let best = null, bs = -1e9; const f = p.ac.forward(new THREE.Vector3());
    for (const r of this.world.radars) {
      if (!r.on || !r.owner.alive || r.owner.team === p.team || r.isAir) continue;
      const d = r.pos.clone().sub(p.pos); const R = d.length(); if (R > 100000) continue; d.normalize();
      const s = d.dot(f) * 2 - R / 50000; if (d.dot(f) < 0.5) continue;
      if (s > bs) { bs = s; best = r.owner; }
    }
    return best;
  }
  takeover(m) { if (!m || m.dead) return; this.rig.missile = m; this.rig.setMode('seeker'); this.seekerReturn = this.rig.prevMode; this.msg('MISSILE CAMERA — STEER WITH W A S D · M = BACK TO THE JET', 2.5); }
  onCatShot() {
    this.rig.shake = 1.2;
    const W = this.wingman; if (W && W.alive && W.deck && W.deck.launchAt == null) W.deck.launchAt = this.time + 8;
    // once airborne off the catapult, MAGIC hands out the strike tasking
    const M = this.mission; if (M && M.kind === 'strike' && !M.tasked) { M.tasked = true; this.comms.later(6, () => this.comms.strikeIn()); }
  }
  onTrap(trap) {
    // any trap is a safe landing, so the headline praises it; the LSO's grade and a one-line tip come after
    const head = trap.wire === 3 && trap.grade === 'OK' ? 'PERFECT LANDING' : trap.wire >= 2 && trap.wire <= 3 ? 'GREAT LANDING' : 'GOOD LANDING';
    this.msg(`${head} — WIRE ${trap.wire} OF 4 (3 IS BEST)`, 6, '#ffe680');
    const gr = trap.grade === 'OK' ? 'OK' : trap.grade === 'FAIR' ? 'Fair' : 'No grade';
    const tip = trap.wire === 1 ? 'You were a little low at the end: keep the orange ball level with the green lights all the way down.'
      : trap.wire === 4 ? 'You were a little high at the end: keep the orange ball level with the green lights all the way down.'
      : trap.grade === 'OK' ? 'On the glide path and lined up the whole way. Textbook.'
      : 'Safe and on target. For a better grade, keep the ball centred and the jet on the centre line all the way in.';
    this.comms.call('lso', `${gr}, ${trap.wire} wire.`, `Landing officer's grade: ${trap.grade === 'NO GRADE' ? 'safe landing, no grade' : trap.grade}. ${tip}`, { pri: 3, ttl: 6, dur: 8, say: `${gr === 'OK' ? 'Okay' : gr}, ${trap.wire} wire.` });
    setTimeout(() => this.msg(this.scenario === 'approach' ? 'PRESS ENTER TO FLY ANOTHER APPROACH · F = BACK TO THE CATAPULT' : 'PRESS F TO GO AGAIN FROM THE CATAPULT', 6), 3500);
  }
  // an escort fired a SAM: say who is shooting at what, so the player knows help is coming
  escortShot(s, T) {
    const nm = s.name.charAt(0) + s.name.slice(1).toLowerCase(), chasing = T.isMissile && T.target === this.player;
    if (T.isMissile) this.comms.call('ship', `${CS}, ${nm}, birds away on the missile ${chasing ? 'chasing you' : 'inbound'}.`, chasing ? 'A friendly warship fired at the missile chasing you. Keep defending anyway: turn hard and drop flares (X).' : 'A friendly warship fired at an incoming enemy missile.', { from: s.name, key: 'escort', every: 10, pri: 4, ttl: 4 });
    else if (T.isDrone) this.comms.call('ship', `${CS}, ${nm}, birds away on the ${T.type === 'cruise' ? 'vampire' : 'drone'}.`, `A friendly warship fired at an incoming ${T.type === 'cruise' ? 'anti-ship missile' : 'attack drone'}.`, { from: s.name, key: 'escort', every: 12, pri: 2, ttl: 4 });
    else this.comms.call('ship', `${CS}, ${nm}, birds away on the bandit.`, 'A friendly warship fired a missile at the enemy fighter near the fleet.', { from: s.name, key: 'escort', every: 10, pri: 3, ttl: 5 });
  }
  onEnemyLaunch(m, shooter) {
    if (m.def.seeker === 'ir') return; // no missile approach warner: IR shots are silent
    this.audio.voice('missile');
    this.comms.launch(m, shooter);
  }
  onMissileGone(m) { const i = this.world.missiles.indexOf(m); if (i >= 0) this.world.missiles.splice(i, 1); }
  onBlast(p, size) {
    const P = this.player; if (!P.alive) return;
    const d = P.pos.distanceTo(p); const R = 20 + size * 22;
    if (d < R * 2.5) {
      const k = (1 - d / (R * 2.5)) * size * 0.08;
      P.ac.s.w.x += (Math.random() - 0.5) * k; P.ac.s.w.y += (Math.random() - 0.5) * k; P.ac.s.w.z += (Math.random() - 0.5) * k * 2;
      this.rig.shake = Math.min(2, this.rig.shake + k * 4);
    }
  }
  dispenseCluster(m) {
    const p = m.pos.clone(); const fwd = m.vel.clone().setY(0).normalize();
    for (let i = 0; i < m.cluster; i++) {
      const off = fwd.clone().multiplyScalar((Math.random() - 0.3) * 120).add(new THREE.Vector3((Math.random() - 0.5) * 90, 0, (Math.random() - 0.5) * 90));
      const q = p.clone().add(off); q.y = this.terrain.heightAt(q.x, q.z);
      // skeet submunitions seek nearby vehicles
      let tgt = null, bd = 60; for (const e of this.world.entities) { if (!e.alive || e.team === 'blue' || (e.kind !== 'ground' && e.kind !== 'sam')) continue; const d = e.pos.distanceTo(q); if (d < bd) { bd = d; tgt = e; } }
      const at = tgt ? tgt.pos.clone().add(new THREE.Vector3(0, 1.5, 0)) : q;
      setTimeout(() => { this.fx.explosion(at, 2.5, { surface: 'ground' }); this.world.damageArea(at, 4, 12, 220, this.player); }, 300 + Math.random() * 1400);
    }
  }
  onDestroyed(e, src, point) {
    const byPlayer = src === this.player || (src && src.isPlayer);
    const p = e.pos.clone();
    const byWing = !!(src && src.isWingman);
    if (e.isDrone) {
      e.onDestroyedVisual(); droneKilled(this, e, src, byPlayer);
    } else if (e instanceof AIJet) {
      this.fx.explosion(p, 4.5, { surface: 'air', fuel: true }); e.onDestroyedVisual();
      if (e === this.wingman) this.wingmanLost(src);
      else if (e.isWingman) {
        // another friendly flight (Hammer in the campaign)
        this.msg(src === this.player ? `FRIENDLY FIRE — YOU HIT ${e.name}` : `${e.name} WAS SHOT DOWN`, 4, '#ff9080');
        this.comms.call('awacs', `${e.callsign} is down, good chute.`, `${e.callsign}, one of the friendly Hornets, was shot down. A rescue helicopter is on the way.`, { pri: 4, ttl: 8 });
      }
      else if (byPlayer) { this.kills++; this.msg(`ENEMY JET DOWN — ${e.name}`, 3, '#ffe680'); this.comms.killed(e); this.audio.killConfirm(); }
      else if (byWing) src.creditKill(e);
      else if (src && src.kind === 'ship' && src.team === 'blue') {
        this.msg(`OUR SHIP ${src.name} SHOT DOWN ${e.name}`, 3, '#b0ffb0');
        this.comms.call('ship', `Splash one, ${src.name.charAt(0) + src.name.slice(1).toLowerCase()}.`, `The friendly warship ${src.name} shot down an enemy fighter.`, { from: src.name, pri: 3, ttl: 6 });
      }
    } else if (e === this.player) {
      this.playerKilled('SHOT DOWN');
    } else if (e.kind === 'ship') {
      this.fx.explosion(p.add(new THREE.Vector3(0, 10, 0)), 9, { surface: 'target' });
      if (e.ship) { e.ship.alive = false; e.ship.sinkPitch = (Math.random() - 0.5) * 0.15; e.ship.sinkRoll = (Math.random() - 0.5) * 0.5; }
      this.fx.addFire(e.pos.clone().add(new THREE.Vector3(0, 12, 0)), 3, 400, { follow: () => e.ship.root.position.clone().add(new THREE.Vector3(0, 12, 0)) });
      if (byPlayer) { this.kills++; this.msg(`WARSHIP SUNK — ${tagOf(e)}`, 3.5, '#ffe680'); this.comms.killed(e); this.audio.killConfirm(); }
      else if (byWing && e.team === 'red') src.creditKill(e);
    } else {
      const size = e.kind === 'structure' ? 6 : 5;
      this.fx.explosion(p.add(new THREE.Vector3(0, 1.5, 0)), size, { surface: 'target' });
      this.terrain.addCrater(e.pos.x, e.pos.z, 8);
      this.fx.addFire(e.pos.clone().add(new THREE.Vector3(0, 1, 0)), e.kind === 'structure' ? 2.2 : 1.0, 300);
      // charred look
      if (e.mats) for (const m of Object.values(e.mats)) if (m && m.color) { m.color.setRGB(0.1, 0.09, 0.085); if (m.emissive) m.emissive.setRGB(0, 0, 0); }
      if (e.kind === 'structure' && e.root) { e.root.scale.y *= 0.55; }
      // turret pops off and tumbles, burning
      const tur = e.model && e.model.nodes && e.model.nodes.turret;
      if (tur && Math.random() < 0.7) this.popTurret(e, tur);
      if (e.radar) e.radar.on = false;
      if (byPlayer && !e.isBunker) { this.kills++; this.msg(`TARGET DESTROYED — ${tagOf(e)}`, 3, '#ffe680'); this.comms.killed(e); this.audio.killConfirm(); }
      else if (byWing && !e.isBunker && e.team === 'red') src.creditKill(e);
      if (e.isBunker) this.kills++;
    }
    if (this.mission) this.mission.onDestroyed(e, byPlayer, byWing);
  }
  popTurret(e, tur) {
    tur.updateMatrixWorld();
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(); tur.getWorldPosition(wp); tur.getWorldQuaternion(wq);
    tur.parent.remove(tur); this.scene.add(tur); tur.position.copy(wp); tur.quaternion.copy(wq);
    const item = { o: tur, v: new THREE.Vector3((Math.random() - 0.5) * 8, 14 + Math.random() * 10, (Math.random() - 0.5) * 8), w: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6), t: 0, rest: false };
    (this.flying || (this.flying = [])).push(item);
    item.fire = this.fx.addFire(wp, 0.6, 90, { follow: () => tur.position });
  }
  playerKilled(reason) {
    const P = this.player; if (P.killed) return; P.killed = true; // (damage() may already have cleared P.alive)
    this.timeScale = 1; this.mapOpen = false;
    const ac = P.ac, crash = ac.crashed, p = ac.s.p.clone();
    P.alive = false; P.deadT = 0; P.wreckPos = p.clone();
    P.flames.forEach(f => f.set(0, 0));
    this.audio.setPlayerEngine({ alive: false, rpm: 0, ab: 0 }); this.audio.setPlayerGun(false);
    this.audio.setRwrLock(false); this.audio.setRwrLaunch(false); this.audio.setSeekerTone(0);
    if (crash) this.wreckImpact(p, crash.kind === 'water');
    else {
      // shot down in the air: the airframe breaks up and the burning wreck tumbles down until it hits the ground
      this.fx.explosion(p, 7, { surface: 'air', fuel: true });
      P.wreck = { v: ac.s.v.clone().multiplyScalar(0.85).add(new THREE.Vector3(0, -45, 0)), spin: new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6), fire: this.fx.addFire(p, 1.4, 60, { follow: () => P.wreckPos }), trail: this.fx.trails.create({ kind: 'smoke', width: 3, grow: 2.2, maxAge: 14, opacity: 0.85, color: [0.1, 0.1, 0.1] }) };
      for (let i = 0; i < 14; i++) { const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize(); this.fx.debris.spawn(p, d.multiplyScalar(15 + Math.random() * 30).addScaledVector(ac.s.v, 0.8), 0.3 + Math.random() * 0.9, 8 + Math.random() * 6, Math.random() < 0.6); }
    }
    this.rig.setMode('dead');
    const practice = this.opts.invulnerable;
    this.msg(practice ? `${reason} — PRACTICE MODE: YOU'LL RESPAWN IN A MOMENT` : `${reason} — PRESS ENTER TO TRY AGAIN`, practice ? 4 : 30, '#ff9080');
    if (practice) this.respawnT = 4.5;
    else { this.comms.playerDown(); if (this.mission) this.mission.onPlayerKilled(reason); }
  }
  // fuel-fed impact: fireball, flying wreckage, crater and a burning wreck (or a big splash at sea)
  wreckImpact(p, water) {
    const P = this.player;
    this.fx.explosion(p.clone(), 9, { surface: water ? 'water' : 'ground', water, fuel: true });
    setTimeout(() => this.fx.explosion(p.clone().add(new THREE.Vector3(0, 8, 0)), 7, { surface: water ? 'water' : 'target', fuel: true }), 180);
    for (let i = 0; i < 26; i++) { const d = new THREE.Vector3(Math.random() - 0.5, 0.3 + Math.random() * 0.7, Math.random() - 0.5).normalize(); this.fx.debris.spawn(p, d.multiplyScalar(14 + Math.random() * 34), 0.35 + Math.random() * 1.2, 8 + Math.random() * 10, Math.random() < 0.55); }
    if (!water) { this.terrain.addCrater(p.x, p.z, 11); this.fx.addFire(p.clone().add(new THREE.Vector3(0, 1, 0)), 2.6, 240); }
    else this.ocean.addSplash(p.x, p.z, 14);
    P.root.visible = false;
  }
  updateWreck(dt) {
    const P = this.player, W = P.wreck; if (!W) return;
    W.v.y -= 9.81 * dt; W.v.multiplyScalar(1 - dt * 0.03);
    P.wreckPos.addScaledVector(W.v, dt);
    P.root.position.copy(P.wreckPos);
    P.root.quaternion.multiply(_q.setFromEuler(new THREE.Euler(W.spin.x * dt, W.spin.y * dt, W.spin.z * dt)));
    if (W.trail) W.trail.add(P.wreckPos);
    const ground = this.terrain.heightAt(P.wreckPos.x, P.wreckPos.z);
    if (P.wreckPos.y <= Math.max(ground, 0) + 1) {
      if (W.fire) W.fire.life = 0; if (W.trail) W.trail.stop();
      this.wreckImpact(P.wreckPos.clone(), ground <= 0);
      P.wreck = null;
    }
  }

  // ---------------- main loop ----------------
  startLoop() {
    if (this.running) return;
    this.running = true; this.last = performance.now(); this.acc = 0;
    const loop = (t) => { if (!this.running) return; requestAnimationFrame(loop); this.frame(t); };
    requestAnimationFrame(loop);
  }
  stop() { this.running = false; this.audio.setPaused(true); }
  enterAttract() {
    this.attract = true; this.paused = false; this.timeScale = 1; this.mapOpen = false;
    this.clearWingman();
    this.setupScenario('carrier'); this.msgs = []; this.comms.clear();
    for (const m of this.world.missiles.slice()) m.destroy('reset', true);
    this.rig.setMode('attract'); this.rig.attractT = 0;
    this.audio.setPlayerGun(false); this.audio.setRwrLock(false); this.audio.setRwrLaunch(false); this.audio.setSeekerTone(0); this.audio.setMasterCaution(false);
  }
  launch(o) {
    this.attract = false; this.paused = false; this.timeScale = 1; this.mapOpen = false; Object.assign(this.opts, o);
    if (o.hour != null && Math.abs(o.hour - this.sky.hours) > 0.01) this.setTime(o.hour);
    if (o.weather) this.setWeather(o.weather);
    for (const m of this.world.missiles.slice()) m.destroy('reset', true);
    this.player.loadoutName = o.loadout || 'auto';
    this.player.hp = 100; this.player.trails.smoke && this.player.trails.smoke.stop(); this.player.trails.smoke = null;
    this.bingoCalled = false; this.kills = 0;
    this.comms.clear();
    this.mission.begin(o.scenario || 'carrier');
    this.loadWeapons();
    this.setupScenario(o.scenario || 'carrier');
    this.spawnWingman(o.scenario || 'carrier');
  }
  setTime(h) {
    this.sky.setTime(h); this.sky.update(this.camera.position, 0);
    this.scene.environment = this.sky.updateEnv();
    this.terrain.updateShadows(GU.uSunDir.value); this.applyNight();
  }
  setWeather(w) {
    const wx = WEATHER[w] || WEATHER.scattered; this.opts.weather = w;
    this.ocean.uniforms.uRough.value = wx.rough;
    if (GU.uCloudCover.value === wx.cover && this.sky.overcast === wx.grey) return;
    GU.uCloudCover.value = wx.cover; this.sky.setOvercast(wx.grey);
    // the grey of the sky light reaches the sky picture, the ambient light and the reflections on lit materials
    this.sky.update(this.camera.position, 0); this.scene.environment = this.sky.updateEnv();
  }
  setQuality(q) {
    this.opts.quality = q; const p = this.pipe;
    p.scale = { low: 0.7, medium: 0.9, high: 1 }[q] || 0.9; p.setQuality(q);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q === 'high' ? 1.5 : 1));
    this.resize();
  }

  frame(now) {
    let dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (this.paused) { this.input.endFrame(); this.render(0); return; }
    this.fps = this.fps ? this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05 : 60;
    this.handleInput(dt);
    // fixed-step simulation (J speeds it up; everything timed by the sim runs faster with it)
    const ts = this.timeScale || 1;
    this.acc += dt * ts; let n = 0;
    while (this.acc >= DT && n < 12 * ts) { this.physics(DT); this.acc -= DT; n++; }
    if (n >= 12 * ts) this.acc = 0;
    this.update(dt * ts);
    if (ts > 1) { const why = this.timeHold(); if (why) { this.timeScale = 1; this.msg(`NORMAL SPEED — ${why}`, 3, '#ffe680'); } }
    // the map gets out of the way when a missile comes
    if (this.mapOpen && (!this.player.alive || this.world.missiles.some(m => !m.dead && m.target === this.player))) { this.mapOpen = false; if (this.player.alive) this.msg('MISSILE! MAP CLOSED — FOLLOW THE BREAK CUE', 3, '#ff9080'); }
    this.render(dt);
    if (this.onFrame) this.onFrame(dt);
    this.input.endFrame();
  }

  handleInput(dt) {
    const I = this.input, P = this.player, ac = P.ac, c = ac.ctl;
    I.updateAxes(dt);
    if (this.attract) return;
    const mode = this.rig.mode;
    // camera modes
    if (I.hit('F1')) { this.rig.setMode('cockpit'); }
    if (I.hit('F2')) { this.rig.setMode('chase'); }
    if (I.hit('F3')) { const ms = this.world.missiles.filter(m => m.shooter === P && !m.dead); if (ms.length) { this.rig.missile = ms[(this.missileCamIdx++) % ms.length]; this.rig.setMode('missile'); } else this.msg('NO MISSILE IN FLIGHT', 1.2); }
    if (I.hit('F4') || I.hit('KeyM')) {
      if (mode === 'seeker') this.rig.setMode(this.seekerReturn || 'cockpit');
      else { const ms = this.world.missiles.filter(m => m.shooter === P && !m.dead); const m = this.rig.missile && !this.rig.missile.dead ? this.rig.missile : ms[ms.length - 1]; if (m) this.takeover(m); else this.msg('FIRE A GUIDED MISSILE FIRST (3 = MAVERICK)', 1.4); }
    }
    if (mode === 'seeker' && (!this.rig.missile || this.rig.missile.dead)) {
      this.seekerGoneT = (this.seekerGoneT || 0) + dt;
      if (this.seekerGoneT > 1.6) { this.seekerGoneT = 0; this.rig.setMode(this.seekerReturn && this.seekerReturn !== 'seeker' ? this.seekerReturn : 'chase'); this.msg('BACK IN YOUR JET', 1.2); }
    } else this.seekerGoneT = 0;
    if (mode !== 'seeker' && !this.mapOpen) { this.apAlt = null; this.apActive = false; }
    if (I.hit('KeyN') && P.alive) { this.mapOpen = !this.mapOpen; if (this.mapOpen) this.msg('THEATER MAP — AUTOPILOT HOLDS THE JET · N = BACK', 2.5); }
    if (I.hit('KeyJ')) this.cycleTimeScale();
    if (I.hit('F5')) this.msg('SHIP DEFENSE VIEW IS COMING IN A LATER VERSION', 2.5);
    if (I.hit('Escape') || I.hit('KeyP')) { this.togglePause(); return; }
    if (I.hit('Enter') && !P.alive) { if (this.mission && this.mission.kind) this.launch({ ...this.opts }); else this.respawnOnCat(); this.rig.setMode('chase'); return; }
    if (!P.alive) return;
    if (I.hit('Enter') && this.scenario === 'approach') { this.retryApproach(); return; }
    if (I.hit('Enter') && this.scenario === 'rings') { this.launch({ ...this.opts }); this.msg('RING COURSE — CLOCK RESTARTED', 2); return; }
    let land = null;
    // seeker takeover steering
    if (mode === 'seeker' && this.rig.missile && !this.rig.missile.dead) {
      const m = this.rig.missile;
      const mx = I.mouse.dx * 0.03 + I.axes.roll * 0.9, my = -I.mouse.dy * 0.03 - I.axes.pitch * 0.9;
      if (Math.abs(mx) > 0.12 || Math.abs(my) > 0.12 || m.manual) {
        if (!m.manual && m.def.seeker !== 'ir') { m.manual = true; this.msg('YOU ARE STEERING THE MISSILE', 1.2); }
        if (m.manual) { m.manualCmd.x += (THREE.MathUtils.clamp(mx, -1, 1) - m.manualCmd.x) * 0.5; m.manualCmd.y += (THREE.MathUtils.clamp(my, -1, 1) - m.manualCmd.y) * 0.5; }
      }
      if (I.hit('KeyT')) { // lock whatever is under the crosshair
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        let best = null, bc = Math.cos(3 * D2R);
        for (const e of this.world.entities) { if (!e.alive || e.team === 'blue') continue; const d = e.pos.clone().sub(this.camera.position).normalize(); const cc = d.dot(dir); if (cc > bc) { bc = cc; best = e; } }
        if (best) { m.target = best; m.manual = false; m.lostT = 0; this.msg(`MISSILE LOCKED ON ${best.name}`, 1.5); this.audio.lockTone(); }
        else { const hit = this.raycastGround(this.camera.position, dir, 30000); if (hit) { m.target = null; m.targetPoint = hit; m.lastKnown.copy(hit); m.manual = false; this.msg('MISSILE AIMED AT THAT SPOT', 1.5); } }
      }
      if (I.hit('KeyV')) { this.sensorSeeker = this.sensorSeeker === SENSOR.TV ? SENSOR.WHOT : this.sensorSeeker === SENSOR.WHOT ? SENSOR.BHOT : SENSOR.TV; }
      // the jet flies itself meanwhile: wings level, holds its altitude, and climbs away from terrain
      this.autopilot(dt);
    } else if (this.mapOpen && !ac.onGround) {
      this.assist.reset(); this.autopilot(dt);
    } else {
      const gloc = P.gloc > 0;
      const keys = { left: I.down('KeyA') || I.down('ArrowLeft'), right: I.down('KeyD') || I.down('ArrowRight'), pull: I.down('KeyS') || I.down('ArrowDown'), push: I.down('KeyW') || I.down('ArrowUp') };
      // easy controls: the landing assist flies the carrier approach, the touchdown and a bolter climb-out
      land = this.opts.realistic ? null : this.landAssist.update(dt, this, keys);
      if (land && land.pitch != null) {
        this.assist.reset();
        c.pitch = gloc ? 0 : land.pitch; c.roll = gloc ? 0 : land.roll;
        c.yaw = gloc ? 0 : THREE.MathUtils.clamp(I.axes.yaw + land.yaw, -1, 1);
      } else if (!this.opts.realistic && !ac.onGround && !(ac.handsOff > 0)) {
        // easy controls: bank-to-turn with auto-level and automatic back-pressure (see assist.js)
        const a = this.assist.update(dt, ac, keys);
        c.pitch = gloc ? 0 : a.pitch; c.roll = gloc ? 0 : a.roll;
        c.yaw = gloc ? 0 : THREE.MathUtils.clamp(I.axes.yaw + a.yaw, -1, 1);
      } else {
        this.assist.reset();
        c.pitch = gloc ? 0 : THREE.MathUtils.clamp(I.axes.pitch, -1, 1);
        c.roll = gloc ? 0 : THREE.MathUtils.clamp(I.axes.roll, -1, 1);
        c.yaw = gloc ? 0 : THREE.MathUtils.clamp(I.axes.yaw, -1, 1);
      }
      if (I.hit('KeyV')) {
        this.sensorMain = this.sensorMain === SENSOR.NORMAL ? SENSOR.NVG : this.sensorMain === SENSOR.NVG ? SENSOR.WHOT : this.sensorMain === SENSOR.WHOT ? SENSOR.BHOT : SENSOR.NORMAL;
        this.tgpMode = this.sensorMain === SENSOR.BHOT ? SENSOR.BHOT : this.sensorMain === SENSOR.NORMAL || this.sensorMain === SENSOR.NVG ? (this.tgpMode) : SENSOR.WHOT;
        this.msg(['NORMAL VIEW', 'TV', 'FLIR WHITE-HOT', 'FLIR BLACK-HOT', 'NIGHT VISION'][this.sensorMain], 1.2);
      }
    }
    // throttle with afterburner detent at 80%
    const up = I.down('ShiftLeft') || I.down('ShiftRight') || I.down('Equal') || I.down('NumpadAdd') || I.down('PageUp');
    const dn = I.down('ControlLeft') || I.down('ControlRight') || I.down('Minus') || I.down('NumpadSubtract') || I.down('PageDown');
    if (up) {
      const next = Math.min(1, c.throttle + dt * 0.45);
      if (c.throttle < 0.8 && next >= 0.8 && !this.abArmed) { c.throttle = 0.8; this.detentWait = true; }
      else if (!this.detentWait) c.throttle = next;
    } else if (this.detentWait) { this.detentWait = false; this.abArmed = true; this.msg('FULL POWER (80%) — PRESS SHIFT AGAIN FOR AFTERBURNER', 1.6); }
    if (dn) c.throttle = Math.max(0, c.throttle - dt * 0.55);
    if (land && land.throttle != null) {
      const LA = this.landAssist;
      if ((up || dn) && (LA.state === 'approach' || LA.pattern) && !(this.atcHintT > this.time)) {
        this.atcHintT = this.time + 6;
        this.msg(LA.pattern ? 'AUTO-THROTTLE HOLDS THE SPEED WHILE THE GEAR IS DOWN — G RAISES THE GEAR' : 'AUTO-THROTTLE IS HOLDING LANDING SPEED — NO NEED FOR SHIFT / CTRL', 2.5);
      }
      c.throttle = land.throttle; this.detentWait = false;
    }
    if (c.throttle < 0.8) { this.abArmed = false; }
    if (I.hit('KeyB')) { if (!ac.onGround) { c.airbrake = c.airbrake ? 0 : 1; this.msg(c.airbrake ? 'SPEEDBRAKE OUT' : 'SPEEDBRAKE IN', 1); } }
    c.brake = ac.onGround && (I.down('KeyB') || (c.throttle < 0.08 && ac.tas - (this.carrier.speed) < 3 && ac.contactSurface === 'deck')) ? 1 : 0;
    if (I.hit('KeyG')) { if (ac.onGround && c.gearCmd) this.msg("CAN'T RAISE THE GEAR ON THE GROUND", 1.2); else { c.gearCmd = c.gearCmd ? 0 : 1; this.msg(c.gearCmd ? 'GEAR DOWN' : 'GEAR UP', 1); this.audio.gearMotor(); } }
    if (I.hit('KeyH')) { c.hookCmd = c.hookCmd ? 0 : 1; this.msg(c.hookCmd ? 'HOOK DOWN' : 'HOOK UP', 1); this.audio.hookMotor(); }
    if (I.hit('KeyK') && !this.opts.realistic) this.msg('THE G LIMITER STAYS ON WITH EASY CONTROLS — TURN ON REALISTIC CONTROLS IN SETTINGS', 2.5);
    else if (I.hit('KeyK')) { c.limiter = !c.limiter; this.msg(c.limiter ? 'G-LIMITER ENGAGED' : 'G-LIMITER OVERRIDE — POST-STALL ENABLED', 2, c.limiter ? '#b0ffb0' : '#ff9080'); }
    if (I.hit('KeyF')) { if (!this.ops.actionKey(ac)) this.msg('F ONLY WORKS ON THE CATAPULT', 1.6); }
    // wingman orders: O opens the menu, then a number gives the order (the numbers don't change weapons meanwhile)
    const W = this.wingman && this.wingman.alive ? this.wingman : null;
    if (I.hit('KeyO')) {
      if (W) { this.wingMenu = !this.wingMenu; this.wingMenuT = 10; }
      else this.msg(this.wingman ? 'YOUR WINGMAN WAS SHOT DOWN — YOU FLY ALONE' : 'NO WINGMAN ON THIS FLIGHT', 2);
    }
    if (this.wingMenu && (!W || (this.wingMenuT -= dt) <= 0)) this.wingMenu = false;
    if (this.wingMenu) {
      for (const o of ORDERS) if (I.hit(`Digit${o.n}`) || I.hit(`Numpad${o.n}`)) { this.wingMenu = false; if (W.command(o.id)) this.msg(`ORDER TO WINGMAN: ${o.text}`, 2, '#b0ffb0'); }
    } else for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']) if (I.hit(k)) P.selectKey(k);
    if (I.hit('KeyT') && mode !== 'seeker') { const vd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion); P.designate(mode === 'cockpit' ? vd : ac.forward(new THREE.Vector3())); }
    if (I.hit('KeyR')) { P.radar.rangeIdx = (P.radar.rangeIdx + 1) % P.radar.ranges.length; this.msg(`RADAR RANGE ${Math.round(P.radar.range / 1852)} NM`, 1); }
    if (I.hit('Space') && mode !== 'seeker') P.fireSelected(I);
    if (I.hit('KeyX')) { P.dropCountermeasure('flare'); P.dropCountermeasure('chaff'); } // countermeasure salvo: flares + chaff
    if (I.hit('KeyZ')) P.dropCountermeasure('chaff');
    if (I.hit('KeyI')) { this.input.wantLock = !this.input.wantLock; if (!this.input.wantLock) document.exitPointerLock?.(); this.msg(this.input.wantLock ? 'MOUSE CAPTURE ON (CLICK VIEW)' : 'MOUSE CAPTURE OFF', 1.2); }
  }

  // autopilot used while the player rides a missile: wings level, altitude hold, ground avoidance
  autopilot(dt) {
    const P = this.player, ac = P.ac, s = ac.s, c = ac.ctl;
    if (this.apAlt == null) this.apAlt = s.p.y;
    const ahead = _v.copy(s.p).addScaledVector(s.v, 5);
    const floor = Math.max(this.terrain.heightAt(ahead.x, ahead.z), this.terrain.heightAt(s.p.x, s.p.z), 0) + 450;
    const tgtAlt = Math.max(this.apAlt, floor);
    const phi = ac.rollDeg() * D2R, p = -s.w.z;
    c.roll = THREE.MathUtils.clamp(-phi * 1.6 - p * 0.35, -0.8, 0.8);
    const nDes = THREE.MathUtils.clamp(1 + (tgtAlt - s.p.y) * 0.004 - s.v.y * 0.06, -0.5, s.p.y < floor ? 4.5 : 2.2) / Math.max(Math.cos(phi), 0.5);
    c.pitch = ac.stickForG(nDes); c.yaw = 0;
    this.apActive = true;
  }

  // J: the long legs at ×2 or ×4. Back to normal speed by itself whenever something needs the pilot (timeHold)
  cycleTimeScale() {
    const next = this.timeScale >= 4 ? 1 : (this.timeScale || 1) * 2;
    if (next > 1) { const why = this.timeHold(); if (why) { this.msg(`CAN'T SPEED UP TIME NOW — ${why}`, 2.5, '#ff9080'); return; } }
    this.timeScale = next;
    this.msg(next > 1 ? `TIME ×${next} — PRESS J ${next === 4 ? 'FOR NORMAL SPEED' : 'AGAIN FOR ×4'}` : 'NORMAL SPEED', 2);
  }
  // why time has to run at normal speed now (null: it may run faster)
  timeHold() {
    const P = this.player, ac = P.ac, p = ac.s.p;
    if (!P.alive || this.attract) return 'NOT FLYING';
    if (this.mission && this.mission.kind === 'rings' && !this.mission.ended) return 'RACING THE CLOCK';
    if (ac.onGround || this.ops.inApproach || ac.ctl.gearCmd) return 'LANDING';
    if (p.y - Math.max(this.terrain.heightAt(p.x, p.z), 0) < 450) return 'TOO LOW';
    if (this.world.missiles.some(m => !m.dead && m.target === P)) return 'MISSILE INBOUND';
    if (P.rwr && P.rwr.some(e => e.level === 'lock' || e.level === 'launch')) return 'AN ENEMY RADAR IS LOCKED ON YOU';
    for (const j of this.aiJets) if (j.alive && j.team === 'red' && j.pos.distanceTo(p) < 30000) return 'ENEMY FIGHTER CLOSE';
    for (const d of this.drones) if (d.alive && d.team === 'red' && (d.pos.distanceTo(p) < 12000 || (d.target && d.pos.distanceTo(this.carrier.pos) < 16000))) return d.target ? 'ENEMY DRONES CLOSING ON THE SHIPS' : 'ENEMY DRONE CLOSE';
    return null;
  }
  togglePause(force) {
    if (this.attract) return;
    this.paused = force != null ? force : !this.paused;
    this.audio.setPaused(this.paused);
    if (this.onPause) this.onPause(this.paused);
    if (this.paused) document.exitPointerLock?.();
  }

  physics(dt) {
    this.time += dt; this.clock.t = this.time;
    for (const s of this.ships) s.update(dt, this.time, this.ocean);
    for (const s of this.ships) if (s.entity) { s.entity.pos.copy(s.root.position); s.entity.vel.copy(s.vel); }
    for (const h of this.helos) h.update(dt, this.time);
    const P = this.player, ac = P.ac;
    if (P.alive) {
      const wasGround = ac.onGround; const vy = ac.s.v.y - (ac.lastSurfaceVel ? ac.lastSurfaceVel.y : 0);
      ac.step(dt, this.time);
      this.ops.update(ac, dt);
      if (!wasGround && ac.onGround) { this.audio.touchdown(Math.min(1, -vy / 5)); }
      P.sync();
      // hull / island collision with ships
      for (const s of this.ships) {
        if (s.pos.distanceToSquared(ac.s.p) > 250 * 250) continue;
        const L = s.toLocal(ac.s.p, _v);
        const inHull = Math.abs(L.z) < s.length * 0.48 && Math.abs(L.x) < s.beam * 0.55 && L.y < s.deckY - 1.5 && L.y > -s.draft;
        const inIsland = s.deck && L.x > 21.5 && L.x < 32.5 && L.z > -7 && L.z < 37 && L.y < 46 && L.y > DECK_Y;
        if (inHull || inIsland) ac.crashed = { kind: 'ship', point: ac.s.p.clone(), speed: ac.s.v.length() };
      }
      // hitting the ground or the sea is always fatal, practice mode included (practice just respawns you)
      if (ac.crashed) this.playerKilled(ac.crashed.kind === 'water' ? 'DITCHED IN THE SEA' : ac.crashed.kind === 'ship' || ac.crashed.kind === 'deck' ? 'CRASHED INTO THE SHIP' : 'CRASHED INTO THE GROUND');
      if (ac.nz > 12.5 && !this.opts.invulnerable) { P.damage(ac.nz > 14 ? 100 : 2, null); this.msg('JET OVERSTRESSED — TOO MANY G', 1.5, '#ff8080'); }
    }
    for (const j of this.aiJets) j.update(dt);
    for (const d of this.drones) d.update(dt);
    for (const m of this.world.missiles.slice()) m.update(dt);
    this.bulletTick = !this.bulletTick; if (this.bulletTick) this.bullets.update(dt * 2);
  }

  update(dt) {
    const P = this.player, ac = P.ac;
    this.frameN++;
    GU.uTime.value = this.time;
    updateLights(GU.uNight.value, innerHeight * this.renderer.getPixelRatio());
    GU.uWind.value.x += -this.wind.x * dt * 1.4; GU.uWind.value.y += -this.wind.z * dt * 1.4; // cloud drift with the wind
    this.gciSees = false;
    for (const d of this.drones) d.sense(dt);
    sweepDrones(this);
    for (const s of this.sams) s.update(dt);
    for (const p of this.pointDef) p.update(dt);
    for (const f of this.flak) f.update(dt);
    for (const d of this.shipDefs) d.update(dt);
    this.mission.update(dt);
    if (!this.attract) this.comms.update(dt);
    if (P.alive) this.missileOutcomes();
    if (!P.alive) {
      this.updateWreck(dt);
      if (this.respawnT > 0 && (this.respawnT -= dt) <= 0) this.practiceRespawn();
    }
    for (const t of this.tanks) t.update(dt);
    P.update(dt, this.input);
    // countermeasures
    for (let i = this.world.flares.length - 1; i >= 0; i--) { const f = this.world.flares[i]; f.update(dt); this.fx.flareVisual(f); if (Math.random() < 0.6) this.fx.ps.alpha.spawn(PT.SMOKE, f.pos.x, f.pos.y, f.pos.z, 0, 0, 0, 1.2, 3, { grow: 1.8, color: [0.85, 0.85, 0.85], alpha: 0.45, drag: 1.5 }); if (f.age > f.life) this.world.flares.splice(i, 1); }
    for (let i = this.world.chaff.length - 1; i >= 0; i--) { const c = this.world.chaff[i]; c.update(dt); if (c.age > c.life) this.world.chaff.splice(i, 1); }
    // tumbling turrets
    if (this.flying) for (const it of this.flying) { if (it.rest) continue; it.t += dt; it.v.y -= 9.81 * dt; it.o.position.addScaledVector(it.v, dt); it.o.rotation.x += it.w.x * dt; it.o.rotation.y += it.w.y * dt; it.o.rotation.z += it.w.z * dt; const h = this.terrain.heightAt(it.o.position.x, it.o.position.z); if (it.o.position.y < h + 0.5) { it.o.position.y = h + 0.5; if (it.v.y < -4) { it.v.y *= -0.25; it.v.x *= 0.4; it.v.z *= 0.4; it.w.multiplyScalar(0.3); this.fx.dustPuff(it.o.position, 3); } else it.rest = true; } }
    // catapult steam
    if (this.catStroke) {
      const c = CATS[this.ops.cat.idx]; const s = this.carrier;
      for (let i = 0; i < 4; i++) { const z = c.z0 - Math.random() * (this.catStroke.s + 5); this.fx.steam(s.toWorld(_v.set(c.x, DECK_Y + 0.3, z)), 0.9, s.fwd); }
    } else if (this.ops.cat.state === 'tension' || this.ops.cat.state === 'salute') {
      if (Math.random() < 0.3) { const c = CATS[this.ops.cat.idx]; this.fx.steam(this.carrier.toWorld(_v.set(c.x + (Math.random() - 0.5), DECK_Y + 0.2, c.z0 - Math.random() * 100)), 0.35, this.carrier.fwd); }
    }
    // radar / RWR
    this.rwrTimer = (this.rwrTimer || 0) - dt;
    if (this.rwrTimer <= 0 && P.alive && !this.attract) {
      this.rwrTimer = 0.1;
      const rwr = computeRWR(this.world, P, this.time); P.rwr = rwr;
      P.detect = rwr.some(e => e.level === 'lock' || e.level === 'launch') ? 'LOCKED' : rwr.length ? 'SCANNED' : 'HIDDEN';
      P.rcs = 1.6 + P.stores.length * 0.55 + (P.racks || []).length * 0.8; // every pylon store adds radar signature
      const lock = rwr.some(e => e.level === 'lock'), launch = rwr.some(e => e.level === 'launch');
      this.audio.setRwrLock(lock && !launch); this.audio.setRwrLaunch(launch);
      for (const e of rwr) if (e.ping) this.audio.rwrPing(0.6);
      if (rwr.length > (this.prevRwrN || 0)) this.audio.rwrNewContact();
      this.prevRwrN = rwr.length;
    }
    // warnings
    if (!this.attract) this.warnings();
    // camera
    this.rig.update(dt, this, this.input);
    if (this.rig.mode === 'seeker' && (!this.rig.missile || this.rig.missile.dead)) {
      this.seekerLostT = (this.seekerLostT || 0) + dt;
      if (this.seekerLostT > 1.3) { this.seekerLostT = 0; this.rig.setMode(this.seekerReturn || 'cockpit'); }
    } else this.seekerLostT = 0;
    if (this.rig.mode === 'missile' && (!this.rig.missile || this.rig.missile.dead)) { this.missileHoldT = (this.missileHoldT || 0) + dt; if (this.missileHoldT > 2.5) { this.missileHoldT = 0; this.rig.setMode('chase'); } }
    // shadows follow the camera focus
    const focus = this.rig.mode === 'chase' || this.rig.mode === 'cockpit' ? P.pos : this.camera.position;
    this.sky.followCamera(this.camera, focus);
    if (this.sky.update(this.camera.position, this.frameN)) { /* sky texture refreshed */ }
    // ships and aircraft (three's lights) darken in a cloud's shadow like the sea and the land around them
    const shade = this.sunShade(focus);
    this.sunShadeK = this.sunShadeK == null ? shade : this.sunShadeK + (shade - this.sunShadeK) * Math.min(1, dt * 3);
    this.sky.sunLight.intensity = (this.sky.sunI ?? this.sky.sunLight.intensity) * this.sunShadeK;
    this.terrain.updateLOD(this.camera);
    this.ocean.update(this.camera.position, this.ships);
    // ship animations
    this.carrierModel.radars[0].rotation.y += dt * 2.0; this.carrierModel.radars[1].rotation.y -= dt * 1.2;
    for (const s of this.ships.slice(1)) s.model.radar.rotation.y += dt * 3;
    // missile plume lighting the clouds (camera-tracked missile)
    const cm = this.rig.missile && !this.rig.missile.dead && this.rig.missile.motorOn ? this.rig.missile : null;
    this.pipe.cloudMat.uniforms.uPlumePos.value.copy(cm ? cm.pos : _v.set(0, -1e6, 0)); this.pipe.cloudMat.uniforms.uPlumeCol.value.set(cm ? 1.0 : 0, cm ? 0.55 : 0, cm ? 0.25 : 0);
    if (cm && !cm._light) cm._light = this.fx.lights.add(cm.pos, [1, 0.6, 0.3], 9000, -1, { follow: (s) => { s.pos.copy(cm.pos); s.I = cm.motorOn && !cm.dead ? 9000 : 0; if (cm.dead) s.life = 0.001; } });
    // player afterburner glow light
    if (!this.abLight) this.abLight = this.fx.lights.add(P.pos, [1, 0.55, 0.25], 0, -1, { follow: (s) => { s.pos.copy(P.pos).addScaledVector(P.ac.forward(_v2), -12); s.I = P.alive ? P.ac.ab * 4500 : 0; } });
    this.fx.update(dt, this.camera);
    // audio
    const cam = this.camera; const cf = _v.set(0, 0, -1).applyQuaternion(cam.quaternion), cu = _v2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const lv = this.rig.mode === 'cockpit' || this.rig.mode === 'chase' ? P.vel : (this.rig.mode === 'missile' || this.rig.mode === 'seeker') && this.rig.missile ? this.rig.missile.vel : _v3.set(0, 0, 0);
    this.audio.setListener(cam.position, cf, cu, lv);
    this.audio.setCockpit(this.rig.mode === 'cockpit');
    if (P.alive && !this.attract) this.audio.setPlayerEngine({ rpm: ac.rpm, ab: ac.ab, throttle: ac.ctl.throttle, mach: ac.mach, q: ac.qbar, aoa: ac.alpha, gLoad: ac.nz, buffet: ac.buffet, gearDown: ac.gear > 0.5, airbrake: ac.airbrakePos, onGround: ac.onGround, camDist: this.rig.mode === 'cockpit' ? 0 : cam.position.distanceTo(P.pos), alive: true });
    const nearSea = Math.max(0, 1 - Math.max(0, cam.position.y) / 120);
    this.audio.setAmbient({ ocean: nearSea, wind: 0 });
    this.audio.update();
    // messages
    for (const m of this.msgs) m.t -= dt; this.msgs = this.msgs.filter(m => m.t > 0);
    // night lighting of windows
    if (this.frameN % 60 === 0) this.applyNight();
    // sonic boom when crossing Mach 1 (heard from chase/external cams)
    const sup = ac.mach > 1.0; if (sup !== this.wasSup) { if (sup && this.rig.mode !== 'cockpit') { this.audio.sonicBoom(0.05); this.rig.shake = Math.max(this.rig.shake, 0.8); } this.wasSup = sup; }
    // afterburner light-off: a thump and a small kick of the chase camera (not again for a quick off-on)
    const abLit = P.alive && !this.attract && ac.ab > 0.06;
    if (abLit && !this.abWasLit && this.time - (this.abOffT ?? -9) > 0.8) {
      this.audio.abLight(this.rig.mode === 'cockpit');
      if (this.rig.mode === 'chase') { this.rig.fovKick = 2.5; this.rig.shake = Math.max(this.rig.shake, 0.35); }
    }
    if (!abLit && this.abWasLit) this.abOffT = this.time;
    this.abWasLit = abLit;
  }

  warnings() {
    const P = this.player, ac = P.ac; if (!P.alive) { this.warn = null; return; }
    const s = ac.s; const agl = s.p.y - Math.max(this.terrain.heightAt(s.p.x, s.p.z), 0);
    let w = null; const a = this.audio;
    const sink = -s.v.y; const tti = sink > 1 ? agl / sink : 99;
    if (!ac.onGround && ac.gear < 0.5 && tti < 5 && agl < 1200) { w = 'PULL UP'; a.voice('pullup'); }
    else if (!ac.onGround && agl < 150 && ac.gear < 0.5 && sink > 2) { w = 'ALTITUDE'; a.voice('altitude'); }
    else if (Math.abs(ac.alpha) > 26 * D2R && ac.tas > 30 && !ac.onGround) { w = 'STALL'; a.voice('stall'); }
    else if (ac.nz > 7.8) { w = 'OVER-G'; a.voice('overg'); }
    if (P.rwr && P.rwr.some(e => e.level === 'launch')) { w = w || 'MISSILE LAUNCH'; }
    if (ac.fuel < 1300 && !this.bingoCalled) { this.bingoCalled = true; a.voice('bingo'); this.msg('FUEL LOW — HEAD BACK TO THE CARRIER', 3); this.comms.bingo(); }
    if (P.hp < 50 && !this.damageCalled) { this.damageCalled = true; a.voice('damage'); }
    if (P.hp > 50) this.damageCalled = false;
    a.setMasterCaution(P.hp < 35);
    this.warn = w;
  }

  // ---------------- rendering ----------------
  render(dt) {
    const P = this.player; const mode = this.rig.mode;
    P.model.cockpit.group.visible = mode === 'cockpit';
    // targeting pod / sensor view (every other frame)
    const needTGP = P.alive && (!P.airWeapon) && (mode === 'cockpit' || mode === 'chase');
    if (needTGP && this.frameN % 2 === 0) this.renderTGP();
    // main view
    const seeker = mode === 'seeker' && this.rig.missile;
    let sensor = seeker ? this.sensorSeeker : this.sensorMain;
    if (seeker && this.rig.missile.def.seeker === 'tv' && sensor === SENSOR.TV) sensor = SENSOR.TV;
    const m = this.rig.missile;
    const fxp = {
      mode: sensor, exposure: this.sky.exposure * (sensor === SENSOR.NVG ? 1 : 1),
      grey: P.alive && mode === 'cockpit' ? Math.min(1, P.gStress) : 0, red: P.alive && mode === 'cockpit' ? P.redStress : 0,
      flash: 0, noise: seeker ? 0.05 + (m && m.tti < 1.5 ? (1.5 - m.tti) * 0.5 : 0) : 0,
      degrade: seeker ? (m && !m.dead ? Math.max(0, 1 - (m.tti || 99) / 1.2) * 0.8 : 1) : 0,
      hurt: P.alive ? Math.max(0, (50 - P.hp) / 50) * 0.6 : 0,
      inCloud: this.inCloud(this.camera.position) ? 1 : 0, fade: this.fade || 0,
      underwater: this.camera.position.y < this.ocean.heightAt(this.camera.position.x, this.camera.position.z, this.time) - 0.3,
    };
    if (seeker && (!m || m.dead)) { fxp.degrade = 1; fxp.noise = 1; }
    this.terrain.updateLOD(this.camera);
    this.pipe.render(this.scene, this.fx.scene, this.camera, fxp);
    // picture-in-picture TGP in chase view
    if (needTGP && mode === 'chase') {
      const r = this.renderer; const sz = Math.round(Math.min(innerWidth, innerHeight) * 0.28);
      r.setViewport(innerWidth - sz - 16, 16, sz, sz); r.setScissor(innerWidth - sz - 16, 16, sz, sz); r.setScissorTest(true);
      r.render(this.pipScene, this.pipCam); r.setScissorTest(false); r.setViewport(0, 0, innerWidth, innerHeight);
      this.pip = [innerWidth - sz - 16, innerHeight - sz - 16, sz, sz];
    } else this.pip = null;
    this.drawHUD();
    if (mode === 'cockpit' && this.frameN % 4 === 0) this.drawMFDs();
  }

  renderTGP() {
    const P = this.player; const T = P.tgp; const cam = this.tgpCam;
    if (!T.podPos) return;
    cam.position.copy(T.podPos);
    if (T.point) cam.lookAt(T.point); else cam.lookAt(_v.copy(T.podPos).add(P.ac.forward(_v2).multiplyScalar(1000)));
    const R = T.point ? T.point.distanceTo(T.podPos) : 5000;
    cam.fov = THREE.MathUtils.clamp(2 * Math.atan(260 / R) / D2R, 0.8, 30); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const ckVis = P.model.cockpit.group.visible; P.model.cockpit.group.visible = false;
    this.terrain.updateLOD(cam);
    this.tgpPipe.render(this.scene, this.fx.scene, cam, { mode: this.tgpMode, exposure: this.sky.exposure, noise: 0.05, target: this.tgpRT, cloudsOn: true });
    P.model.cockpit.group.visible = ckVis;
  }

  inCloud(p) { return cloudBulkCPU(this.weatherData, 512, p.x, p.y, p.z) > 0.1; }
  // sunlight left at p after the cloud layer above (the CPU twin of cloudShadowAt in glsl.js)
  sunShade(p) {
    const sd = GU.uSunDir.value; if (sd.y < 0.03 || GU.uCloudCover.value < 0.01) return 1;
    const base = GU.uCloudBase.value, th = GU.uCloudTop.value - base, seg = Math.min(th * 0.25 / sd.y, 1600);
    let od = 0;
    for (let i = 0; i < 4; i++) {
      const hy = base + th * (0.08 + 0.22 * i), t = (hy - p.y) / sd.y; if (t < 0) continue;
      od += cloudBulkCPU(this.weatherData, 512, p.x + sd.x * t, hy, p.z + sd.z * t) * seg;
    }
    const k = THREE.MathUtils.smoothstep(sd.y, 0.03, 0.12);
    return 1 - k + k * (0.16 + 0.84 * Math.exp(-od * 0.0056));
  }

  drawHUD() {
    const P = this.player, ac = P.ac, s = ac.s, cam = this.camera; const mode = this.rig.mode;
    if (this.attract) { this.hud.draw({ hidden: true }, cam); return; }
    const S = { messages: this.msgs, mode: mode === 'seeker' ? 'seeker' : 'normal', leftInset: this.attract ? 0 : (this.cardRight || 404) + 12 }; // messages stay clear of the coach card
    const W = this.wingman;
    if (W && P.alive) {
      const T = this.wingMenu && W.alive ? W.playerTarget() : null;
      S.wing = { alive: W.alive, status: W.statusText(), ammo: W.alive ? W.ammoText() : '', menu: this.wingMenu ? ORDERS : null, target: T ? tagOf(T) : null };
    }
    if (mode === 'seeker' && this.rig.missile) {
      const m = this.rig.missile; const alive = !m.dead;
      const fwdm = new THREE.Vector3(0, 0, -1).applyQuaternion(m.quat);
      const sd = m.track && m.track.pos ? m.track.pos.clone().sub(m.pos).normalize() : fwdm;
      const qi = m.quat.clone().invert(); const local = sd.clone().applyQuaternion(qi);
      S.seeker = { name: m.def.name, sensor: ['', 'TV', 'WHOT', 'BHOT', 'NVG'][this.sensorSeeker] || 'TV', manual: m.manual, locked: !!m.track, tti: m.tti || 99, vc: m.closing || 0,
        range: m.track && m.track.pos ? m.track.pos.distanceTo(m.pos) : 0, alt: m.pos.y, mach: m.vel.length() / 340, g: m.aCmd.length() / 9.81, lost: !alive,
        targetPos: m.target && m.target.alive ? m.target.pos : m.targetPoint, gimbalX: THREE.MathUtils.clamp(local.x * 1.5, -1, 1), gimbalY: THREE.MathUtils.clamp(local.y * 1.5, -1, 1) };
      S.threat = P.alive ? this.threatInfo() : null;
      this.hud.draw(S, cam); return;
    }
    if (!P.alive) { this.hud.draw(S, cam); return; }
    const fc = P.fireControl();
    const fwd = ac.forward(new THREE.Vector3());
    const agl = s.p.y - Math.max(this.terrain.heightAt(s.p.x, s.p.z), 0);
    let deckAgl = agl; if (this.ops.inApproach || ac.contactSurface === 'deck') deckAgl = s.p.y - (this.carrier.root.position.y + DECK_Y);
    Object.assign(S, {
      ac, showHud: mode === 'cockpit' || mode === 'chase', chase: mode === 'chase', fwd, vel: s.v.clone().sub(ac.onGround ? ac.lastSurfaceVel : _v.set(0, 0, 0)), roll: ac.rollDeg(), pitch: ac.pitchDeg(), heading: ac.heading(),
      ias: ac.ias() * KTS, mach: ac.mach, g: ac.nz, maxG: ac.maxG, aoa: ac.alpha / D2R, alt: s.p.y * FT, radalt: Math.max(0, deckAgl) * FT, vs: s.v.y * FT * 60,
      throttle: ac.ctl.throttle, ab: ac.ab, fuel: ac.fuel, limiter: ac.ctl.limiter, gearDown: ac.gear > 0.5, hook: ac.ctl.hookCmd, airbrake: ac.airbrakePos > 0.5, brake: ac.ctl.brake > 0,
      ball: this.ops.inApproach ? this.ops.ball / 0.75 : null, warn: this.warn, rounds: P.gunRounds,
      rwr: P.rwr, showRwrOverlay: mode !== 'cockpit', inventory: P.inventory(), score: this.kills, objective: this.objectiveText(), camLabel: { cockpit: 'F1 COCKPIT', chase: 'F2 CHASE', missile: 'F3 WEAPON CAM', dead: 'EJECTED' }[mode] || '',
      pip: this.pip, pipLabel: `TGP ${['', 'TV', 'WHOT', 'BHOT'][this.tgpMode] || ''}${P.tgp.laser.on ? ' LASE' : ''}`,
    });
    if (this.ops.nearCat(ac) >= 0 && this.ops.cat.state === 'none' && ac.onGround) S.catPrompt = 'PRESS F TO HOOK UP TO THE CATAPULT';
    if (this.ops.cat.state === 'tension') S.catPrompt = ac.ctl.throttle < 0.78 ? `HOLD SHIFT — THROTTLE UP TO 80%  (NOW ${Math.round(ac.ctl.throttle * 100)}%)` : 'PRESS F TO LAUNCH';
    if (this.ops.cat.state === 'salute') S.catPrompt = 'LAUNCHING — HANDS OFF…';
    // weapon text & target
    const key = P.sel; const d = DEFS[key];
    S.weaponText = d ? `${d.short} ${P.count(key)} ${key === 'aim9x' ? (P.seeker9.lock ? 'TONE' : 'SRCH') : key === 'aim120' ? (P.radar.stt ? 'RDY' : 'NO LOCK') : (key === 'gbu31' || key === 'gbu39') ? (P.tgp.target && P.tgp.target.alive ? (P.jdamLAR(P.tgp.target.pos, key).inRange ? 'IN RANGE' : `${(P.jdamLAR(P.tgp.target.pos, key).range / 1000).toFixed(1)} KM`) : 'MARK TGT (T)') : d.bomb ? (P.ccrp ? 'CCRP' : 'CCIP') : key === 'agm88' ? 'POS' : P.tgp.target ? 'TGT' : 'BORE'}` : 'GUN';
    const tgt = P.airWeapon ? P.radar.stt : P.tgp.target;
    if (tgt && tgt.alive) {
      const R = tgt.pos.distanceTo(s.p); const rel = tgt.vel.clone().sub(s.v); const los = tgt.pos.clone().sub(s.p).normalize();
      S.target = { pos: tgt.pos, label: tgt.name, locked: true, range: R, closure: -rel.dot(los), alt: tgt.pos.y };
      if (P.airWeapon) {
        const aspect = tgt.vel.lengthSq() > 1 ? tgt.vel.clone().normalize().dot(los.clone().negate()) : 1;
        const z = { aim9x: [16000, 7000, 600], aim120: [72000, 28000, 1500] }[key] || [10000, 5000, 500];
        const altF = 0.55 + 0.45 * Math.min(1, s.p.y / 9000) * 1.6, spdF = 0.75 + Math.min(0.6, s.v.length() / 600), asp = 0.6 + 0.4 * (0.5 + 0.5 * aspect);
        const rmax = z[0] * altF * spdF * asp * 0.85, rne = z[1] * altF * asp;
        S.dlz = { rmax, rne, rmin: z[2], scale: Math.max(rmax * 1.25, R * 1.1) };
        S.shoot = R < rmax && R > z[2];
      }
    }
    if (key === 'aim9x') { S.seekerDir = P.seeker9.dir; S.seekerLock = !!P.seeker9.lock; }
    if (fc.ccip) S.ccip = fc.ccip; if (fc.ccrp) S.ccrp = fc.ccrp; if (fc.gun) S.gun = fc.gun;
    // HUD clip polygon in cockpit (projected combiner glass)
    if (mode === 'cockpit') {
      const ck = P.model.cockpit; const pts = [];
      for (const c of ck.hudCorners) { const w = c.clone().applyQuaternion(s.q).add(s.p); const p = this.hud.projPoint(cam, w); if (!p) { pts.length = 0; break; } pts.push([p[0] / this.hud.dpr, p[1] / this.hud.dpr]); }
      // enlarge the combiner field of view a bit for playability
      if (pts.length === 4) { const cx = pts.reduce((a, p) => a + p[0], 0) / 4, cy = pts.reduce((a, p) => a + p[1], 0) / 4; S.clip = pts.map(([x, y]) => [cx + (x - cx) * 1.9, cy + (y - cy) * 1.7]); }
      else S.showHud = false;
    }
    S.markers = this.buildMarkers();
    S.banner = (this.opts.realistic ? null : this.landAssist.status(this)) || (this.timeScale > 1 ? { text: `TIME ×${this.timeScale} · J = ${this.timeScale === 4 ? 'NORMAL SPEED' : '×4'}`, color: '#ffe680' } : null);
    S.threat = this.threatInfo();
    S.detect = P.detect; S.ap = this.apActive;
    this.hud.draw(S, cam);
  }

  // ---------------- inbound-missile assessment (defensive cue) ----------------
  threatInfo() {
    const P = this.player, s = P.ac.s;
    let best = null, bt = 1e9, n = 0;
    for (const m of this.world.missiles) {
      if (m.dead || m.team === 'blue' || m.target !== P) continue;
      n++;
      const rel = _v.copy(m.pos).sub(s.p); const d = rel.length(); rel.multiplyScalar(1 / Math.max(d, 1));
      const vc = Math.max(60, -_v2.copy(m.vel).sub(s.v).dot(rel));
      const tti = d / vc; if (tti < bt) { bt = tti; best = m; }
    }
    if (!best) return null;
    const radar = best.def.seeker !== 'ir';
    // radar-guided: what matters is the radar doing the guiding (ground site, or the missile once it goes active);
    // put THAT on your beam and its Doppler filter loses you (the "notch"), which also makes chaff work
    const ref = radar && best.radar && best.radar.on && !best.active ? best.radar.pos : best.pos;
    const f = P.ac.forward(_v3); const dx = ref.x - s.p.x, dz = ref.z - s.p.z;
    let b = (Math.atan2(dx, -dz) - Math.atan2(f.x, -f.z)) * 180 / Math.PI; b = ((b % 360) + 540) % 360 - 180;
    const dpsi = b - 90 * (b >= 0 ? 1 : -1);
    const los = _v.copy(s.p).sub(ref); const R = Math.max(los.length(), 1);
    const vr = s.v.dot(los) / R;                                   // closing/opening speed seen by that radar
    const notching = radar && Math.abs(vr) < 55;
    let mb = (Math.atan2(best.pos.x - s.p.x, -(best.pos.z - s.p.z)) - Math.atan2(f.x, -f.z)) * 180 / Math.PI; mb = ((mb % 360) + 540) % 360 - 180;
    const clock = ((Math.round(mb / 30) + 12) % 12) || 12;
    return { m: best, n, radar, bearing: b, clock, d: best.pos.distanceTo(s.p), tti: bt, turn: Math.abs(dpsi) < 14 ? 0 : Math.sign(dpsi), notching, ref: ref === best.pos ? 'missile' : 'radar',
      cmNow: radar ? (notching || bt < 6) : bt < 4.5 };
  }
  // tell the player when a defence worked
  missileOutcomes() {
    const P = this.player; const seen = this.inbound || (this.inbound = new Map());
    for (const m of this.world.missiles) if (!m.dead && m.team !== 'blue' && m.target === P && !seen.has(m)) {
      seen.set(m, { decoyed: false, lost: false });
      if (m.def.seeker === 'ir' && !this.opts.realistic) this.audio.voice('missile'); // easy mode: warn about heat-seekers too
    }
    for (const [m, st] of seen) {
      if (m.dead) {
        if (P.alive && m.reason !== 'detonated' && m.reason !== 'reset') this.msg(m.reason === 'energy' || m.reason === 'timeout' ? 'MISSILE DEFEATED — IT RAN OUT OF ENERGY' : 'MISSILE DEFEATED — IT LOST ITS LOCK', 2.5, '#b0ffb0');
        seen.delete(m); continue;
      }
      if (!st.decoyed && m.track && (m.track.isFlare || m.track.isChaff)) { st.decoyed = true; this.msg(`MISSILE DECOYED BY ${m.track.isFlare ? 'A FLARE' : 'CHAFF'}!`, 2.5, '#b0ffb0'); }
      if (!st.lost && !st.decoyed && m.lostT > 0.8) { st.lost = true; this.msg('MISSILE LOST TRACK OF YOU — KEEP IT UP!', 2.2, '#b0ffb0'); }
      if (m.target !== P) seen.delete(m);
    }
  }

  // ---------------- on-screen target markers ----------------
  buildMarkers() {
    const P = this.player, s = P.ac.s, out = [];
    const lock = P.radar.stt && P.radar.stt.alive ? P.radar.stt : null;
    const tone = P.seeker9.lock && P.seeker9.lock.alive ? P.seeker9.lock : null;
    const marked = P.tgp.target && P.tgp.target.alive ? P.tgp.target : null;
    const objs = this.mission ? this.mission.currentTargets() : null;
    let nearestObj = null, nd = Infinity;
    for (const e of this.world.entities) {
      if (!e.alive || e === P || e.kind === 'missile' || e.hidden) continue;
      const d = e.pos.distanceTo(s.p);
      if (e.team === 'red') {
        const isObj = !!(objs && objs.has(e));
        if (isObj && d < nd) { nd = d; nearestObj = e; }
        // drones: a swarm would fill the screen edge with arrows, so only the near ones (and the spy drone) get one
        if (e.kind === 'air') out.push({ pos: e.pos, kind: e.isDrone ? 'drone' : 'air', label: e.name, d, r: e.isDrone ? 4 : 9, lock: e === lock, tone: e === tone, arrow: e.isDrone ? d < 25000 || e.type === 'recon' : d < 120000 });
        else if (e.kind === 'ship') { if (d < 80000) out.push({ pos: e.pos, kind: isObj ? 'objective' : 'ship', label: tagOf(e), d, r: e.radius, lock: e === marked, arrow: isObj && d > 3000 }); }
        else if (isObj || e === marked) { if (d < 45000) out.push({ pos: e.pos, kind: 'objective', label: tagOf(e), d, r: e.radius, lock: e === marked, obj: isObj }); }
        else if (e.spotted && e.targetable && d < 80000) out.push({ pos: e.pos, kind: d < 12000 ? 'ground' : 'spotted', label: tagOf(e), d, r: e.radius });
        else if (d < 12000 && e.targetable) out.push({ pos: e.pos, kind: 'ground', label: d < 6000 ? tagOf(e) : '', d, r: e.radius });
      } else if (e.isDrone && e.team === 'blue' && d > 1500) out.push({ pos: e.pos, kind: 'friendly', label: e.name, d, r: 9 });
    }
    if (nearestObj && nd > 2500) { const m = out.find(o => o.pos === nearestObj.pos); if (m) m.arrow = true; }
    // the wingman: a blue chevron once he's away from the formation (on your wing you can see him)
    const W = this.wingman;
    if (W && W.alive && !W.deck) { const d = W.pos.distanceTo(s.p); if (d > 400) out.push({ pos: W.pos, kind: 'friendly', label: 'SPEAR 1-2', d, r: 9 }); }
    for (const m of this.world.missiles) if (!m.dead && m.team !== 'blue' && m.target === P) out.push({ pos: m.pos, kind: 'missile', label: 'MISSILE', d: m.pos.distanceTo(s.p), r: 2, arrow: true });
    const ctl = this.mission && this.mission.ctl; if (ctl && ctl.markers) ctl.markers(out, s.p);
    const cv = this.carrier; if (cv.alive !== false) {
      const d = cv.root.position.distanceTo(s.p); const home = this.ops.inApproach || P.ac.ctl.gearCmd || P.ac.fuel < 0.2 * 6560 || (this.mission && this.mission.state === 'rtb');
      const LA = this.landAssist, easy = !this.opts.realistic;
      if (this.ops.inApproach || (easy && LA.state === 'approach')) {
        // on the approach the carrier marker moves to the spot where the hook touches down
        const T = landingPoint(LANDING.targetS), spot = cv.toWorld(new THREE.Vector3(T.x, DECK_Y, T.y));
        out.push({ pos: spot, kind: 'spot', label: 'LANDING SPOT', d: spot.distanceTo(s.p), r: 20 });
      } else out.push({ pos: cv.root.position.clone().add(_v.set(0, 30, 0)), kind: 'friendly', label: 'CARRIER', d, r: 160, arrow: home && d > 1500 });
      // gear down near the ship: the circle that leads the jet to where the landing assist takes over
      if (easy && LA.inPattern(this)) {
        const jp = LA.joinPoint(this, new THREE.Vector3());
        out.push({ pos: jp, kind: 'join', label: 'FLY HERE', d: jp.distanceTo(s.p), r: 40, arrow: true });
      }
    }
    return out;
  }

  objectiveText() {
    if (this.mission && this.mission.kind) return this.mission.objectiveText();
    const samAlive = this.sams.some(s => s.track.alive || s.launchers.some(l => l.alive));
    const armor = this.tanks.filter(t => t.team === 'red' && t.e.alive).length;
    const jets = this.aiJets.filter(j => j.alive && j.team === 'red').length;
    return `MISSILE SITE ${samAlive ? 'ACTIVE' : 'DESTROYED'} · TANKS ${armor} · ENEMY JETS ${jets}`;
  }

  drawMFDs() {
    const P = this.player; const L = this.mfdL;
    if (this.frameN % 8 === 0) {
      // radar page on top half, RWR on bottom half alternating by selected weapon
      const ctx = L.ctx; const s = P.ac.s;
      if (P.airWeapon || this.mfdPage === 'radar') {
        const fwd = P.ac.forward(new THREE.Vector3()); const hd = Math.atan2(fwd.x, -fwd.z);
        const contacts = P.radar.contacts.map(c => { const d = c.e.pos.clone().sub(s.p); const az = Math.atan2(d.x, -d.z) - hd; const vh = Math.atan2(c.e.vel.x, -c.e.vel.z) - hd; return { az: Math.atan2(Math.sin(az), Math.cos(az)), range: d.length(), alt: c.e.pos.y * FT, aspect: vh, locked: c.e === P.radar.stt }; });
        drawRadarMFD(ctx, L.n, { mode: P.radar.stt ? 'STT' : 'RWS', range: P.radar.range, contacts, t: this.time, lockText: P.radar.stt ? `STT ${P.radar.stt.name}` : 'RWS' });
      } else drawRWRMFD(ctx, L.n, P.rwr || [], this.time);
      L.tex.needsUpdate = true;
      // center: engine/fuel
      const c = this.mfdC.ctx; const n = this.mfdC.n; c.fillStyle = '#020a05'; c.fillRect(0, 0, n, n); c.fillStyle = '#7dff95'; c.font = 'bold 18px monospace'; c.textAlign = 'left';
      c.fillText(`RPM ${Math.round(P.ac.rpm * 100)}%`, 10, 30); c.fillText(`AB  ${P.ac.ab > 0.01 ? 'STG ' + Math.max(1, Math.ceil(P.ac.ab * 5)) : 'OFF'}`, 10, 54); c.fillText(`FF  ${Math.round(P.ac.fuelFlow * 7936)} PPH`, 10, 78);
      c.fillText(`FUEL ${Math.round(P.ac.fuel * 2.2046)} LB`, 10, 102); c.fillText(`FLR ${P.flares} CHF ${P.chaff}`, 10, 126); c.fillText(`GUN ${P.gunRounds}`, 10, 150); c.fillText(`HP ${Math.round(P.hp)}%`, 10, 174);
      this.mfdC.tex.needsUpdate = true;
    }
  }
}
