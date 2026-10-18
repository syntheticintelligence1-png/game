// The theater map (N while flying): the briefing chart drawn live, with every jet, drone and ship where it is now,
// and a side panel of who is still in the fight. The sim keeps running underneath while the autopilot holds the
// jet (game.js); the map only reads game state.
import { drawBriefMap, MAP_EXT } from './briefmap.js';

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (e) => Math.max(0, Math.round(e.hp / e.maxHp * 100));

export class TheaterMap {
  constructor(game) {
    this.g = game; this.el = document.getElementById('theater'); this.t = 0; this.open = false;
    if (!this.el) return;
    this.canvas = document.getElementById('th-canvas'); this.side = document.getElementById('th-side'); this.head = document.getElementById('th-head');
  }
  update(dt) {
    if (!this.el) return;
    const g = this.g, want = !!g.mapOpen && !g.attract;
    if (want !== this.open) { this.open = want; this.el.hidden = !want; this.t = 0; document.body.classList.toggle('map-open', want); if (want) this.layout(); }
    if (!want) return;
    this.t -= dt; if (this.t > 0) return; this.t = 0.25;
    try { drawBriefMap(this.canvas, g, g.scenario, { live: true }); } catch (e) { console.warn('theater map failed', e); }
    this.panel();
  }
  layout() {
    const aspect = (MAP_EXT.x1 - MAP_EXT.x0) / (MAP_EXT.z1 - MAP_EXT.z0);
    const h = Math.round(Math.max(320, Math.min(innerHeight - 120, 900))), w = Math.round(Math.min(h * aspect, innerWidth - 380));
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${Math.round(w / aspect)}px`;
  }
  panel() {
    const g = this.g, M = g.mission, P = g.player, st = M && M.stage;
    const ts = g.timeScale || 1;
    const race = M && M.kind === 'rings';
    this.head.innerHTML = `<b>THEATER MAP · LIVE</b><span>${esc(st ? `STAGE ${M.ctl.stageNo} · ${st.name}` : race ? 'RING COURSE' : (M && M.kind ? M.kind.toUpperCase() : 'FREE FLIGHT'))}</span><span>${esc(M && M.objectiveText ? M.objectiveText().replace(/^STAGE \d+ · /, '') : '')}</span><span>TIME ×${ts}</span>`;
    const friends = [], foes = [];
    friends.push(`YOU · ${P.alive ? `${Math.round(P.hp)}% · ${Math.round(P.ac.fuel / 65.6)}% FUEL` : 'DOWN'}`);
    const W = g.wingman; if (W) friends.push(`SPEAR 1-2 · ${W.alive ? W.statusText() : 'SHOT DOWN'}`);
    for (const j of g.aiJets) if (j.isStrikeWing) friends.push(`${j.name} · ${j.alive ? `${j.kills} KILL${j.kills === 1 ? '' : 'S'}` : 'SHOT DOWN'}`);
    for (const d of g.drones || []) if (d.team === 'blue' && d.alive) friends.push(`${d.name} · ON STATION`);
    for (const s of g.ships) if (s.team === 'blue' && s.entity) friends.push(`${s === g.carrier ? 'MOTHER (CARRIER)' : s.name} · ${s.entity.alive ? `${pct(s.entity)}%` : 'SUNK'}`);
    const jets = g.aiJets.filter(j => j.alive && j.team === 'red').length;
    const drones = (g.drones || []).filter(d => d.alive && d.team === 'red');
    const n = (t) => drones.filter(d => d.type === t).length;
    if (jets) foes.push(`FIGHTERS · ${jets}`);
    if (n('recon')) foes.push(`SPY DRONE · ${n('recon')}`);
    if (n('attack')) foes.push(`ATTACK DRONES · ${n('attack')}`);
    if (n('cruise')) foes.push(`ANTI-SHIP MISSILES · ${n('cruise')}`);
    const defs = (M && M.defenses || []).filter(e => e.alive).length; if (defs) foes.push(`AIR DEFENSES · ${defs}`);
    const ships = (M && M.fleet || []).filter(e => e.alive).length; if (ships) foes.push(`WARSHIPS · ${ships}`);
    if (M && M.bunker && M.bunker.alive && !race) foes.push('COMMAND BUNKER');
    const li = (a) => a.map(x => `<li>${esc(x)}</li>`).join('');
    this.side.innerHTML = `<h3>Friendly</h3><ul>${li(friends)}</ul><h3>Enemy</h3><ul class="red">${li(foes.length ? foes : [race ? 'NONE · TRAINING RANGE' : 'NOTHING LEFT'])}</ul>
      <p class="th-keys"><kbd>N</kbd> close map · <kbd>J</kbd> time ×1 / ×2 / ×4 · <kbd>O</kbd> wingman orders</p>
      <p class="th-note">The autopilot holds your jet level while the map is open. It closes by itself if a missile is fired at you.</p>`;
  }
}
