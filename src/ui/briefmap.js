// Briefing map: a kneeboard chart drawn from the real terrain — relief shading, contours and coastline, a 10 km
// grid, roads and the city — with the enemy threat rings, targets, fighter patrols, ships and the planned route.
import { STRIKE } from '../game/mission.js';
import { WAVES } from '../game/campaign.js';
import { SITES, ROADS } from '../world/terrain.js';

export const MAP_EXT = { x0: -11000, x1: 21000, z0: -12000, z1: 41000 };
export const GRID = { x0: -10000, z0: -10000, step: 10000 };
// grid square name for a world position, e.g. "B2" (columns A.. west to east, rows 1.. north to south)
export function gridRef(x, z) {
  const col = Math.floor((x - GRID.x0) / GRID.step), row = Math.floor((z - GRID.z0) / GRID.step) + 1;
  return `${String.fromCharCode(65 + Math.max(0, col))}${Math.max(1, row)}`;
}

const FONT = '"B612 Mono", ui-monospace, Menlo, Consolas, monospace';
const COL = { red: '#ff6a5a', amber: '#f3a83a', blue: '#7fd0ff', route: '#eef3f6', text: '#dbe4ea', muted: '#9fb0bb', halo: 'rgba(4,8,12,0.92)' };
const LAND = [[0, 49, 61, 47], [60, 58, 70, 51], [250, 80, 84, 59], [550, 106, 99, 72], [900, 132, 122, 96], [1400, 168, 160, 140]];
const SEA = [[0, 26, 58, 72], [40, 19, 44, 58], [300, 9, 22, 32]];
function ramp(stops, v, out) {
  if (v <= stops[0][0]) { out[0] = stops[0][1]; out[1] = stops[0][2]; out[2] = stops[0][3]; return out; }
  for (let k = 1; k < stops.length; k++) if (v <= stops[k][0]) {
    const a = stops[k - 1], b = stops[k], t = (v - a[0]) / (b[0] - a[0]);
    out[0] = a[1] + (b[1] - a[1]) * t; out[1] = a[2] + (b[2] - a[2]) * t; out[2] = a[3] + (b[3] - a[3]) * t; return out;
  }
  const z = stops[stops.length - 1]; out[0] = z[1]; out[1] = z[2]; out[2] = z[3]; return out;
}

// relief bitmaps; the terrain never changes, so each is built once per canvas size (briefing and theater map)
const cache = new Map();
function relief(game, ctx, W, H, E) {
  const key = `${W}x${H}`;
  if (cache.has(key)) return cache.get(key);
  const T = game.terrain, mx = (E.x1 - E.x0) / W, mz = (E.z1 - E.z0) / H;
  const h = new Float32Array(W * H);
  for (let j = 0; j < H; j++) { const z = E.z0 + (j + 0.5) * mz; for (let i = 0; i < W; i++) h[j * W + i] = T.heightAt(E.x0 + (i + 0.5) * mx, z); }
  const img = ctx.createImageData(W, H), d = img.data, col = [0, 0, 0];
  const Lx = -0.539, Ly = 0.647, Lz = -0.539, ex = 2.4; // sun from the north-west, relief exaggerated for legibility
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, v = h[k];
    const hl = h[k - (i > 0 ? 1 : 0)], hr = h[k + (i < W - 1 ? 1 : 0)], hu = h[k - (j > 0 ? W : 0)], hd = h[k + (j < H - 1 ? W : 0)];
    if (v > 0) {
      ramp(LAND, v, col);
      const dx = (hr - hl) / (2 * mx) * ex, dz = (hd - hu) / (2 * mz) * ex, nl = Math.hypot(dx, 1, dz);
      const s = Math.min(1.45, Math.max(0.42, ((-dx * Lx + Ly - dz * Lz) / nl) / Ly));
      col[0] *= s; col[1] *= s; col[2] *= s;
      // 250 m contours and the coastline
      const c0 = Math.floor(v / 250);
      if (c0 !== Math.floor(Math.max(hr, 0) / 250) || c0 !== Math.floor(Math.max(hd, 0) / 250)) { col[0] *= 0.82; col[1] *= 0.82; col[2] *= 0.8; }
      if (hl <= 0 || hr <= 0 || hu <= 0 || hd <= 0) { col[0] = col[0] * 0.3 + 196 * 0.7; col[1] = col[1] * 0.3 + 210 * 0.7; col[2] = col[2] * 0.3 + 214 * 0.7; }
    } else ramp(SEA, -v, col);
    const o = k * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
  }
  if (cache.size > 3) cache.delete(cache.keys().next().value);
  cache.set(key, img);
  return img;
}

// scenario: carrier | deck | strike | air | approach | campaign (the stage is game.mission.stage).
// opts.live: the in-flight theater map (every jet and drone where it is now, instead of the planned patrols)
export function drawBriefMap(canvas, game, scenario, opts = {}) {
  const E = MAP_EXT;
  const cssW = canvas.clientWidth || 360, cssH = canvas.clientHeight || Math.round(cssW * (E.z1 - E.z0) / (E.x1 - E.x0));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(cssW * dpr)), H = Math.max(1, Math.round(cssH * dpr));
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  c.putImageData(relief(game, c, W, H, E), 0, 0);
  c.save(); c.scale(dpr, dpr);
  const k = cssW / (E.x1 - E.x0);
  const X = (x) => (x - E.x0) * k, Z = (z) => (z - E.z0) * (cssH / (E.z1 - E.z0)), R = (r) => r * k;
  const label = (txt, x, y, col = COL.text, align = 'left', size = 10, weight = 400) => {
    c.font = `${weight} ${size}px ${FONT}`; c.textAlign = align; c.textBaseline = 'middle';
    // keep every label on the chart: slide it back inside the edge instead of clipping it
    const w = c.measureText(txt).width, x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
    x += Math.max(0, 3 - x0) - Math.max(0, x0 + w - (cssW - 3));
    c.lineJoin = 'round'; c.lineWidth = 3.2; c.strokeStyle = COL.halo; c.strokeText(txt, x, y); c.fillStyle = col; c.fillText(txt, x, y);
  };
  const M = game.mission, combat = scenario !== 'approach' && scenario !== 'rings', sid = M && M.stage ? M.stage.id : null, live = !!opts.live;

  // 10 km grid with column letters and row numbers
  c.strokeStyle = 'rgba(230,240,245,0.14)'; c.lineWidth = 1;
  for (let x = GRID.x0; x <= E.x1; x += GRID.step) { c.beginPath(); c.moveTo(X(x), 0); c.lineTo(X(x), cssH); c.stroke(); }
  for (let z = GRID.z0; z <= E.z1; z += GRID.step) { c.beginPath(); c.moveTo(0, Z(z)); c.lineTo(cssW, Z(z)); c.stroke(); }
  for (let x = GRID.x0, n = 0; x + GRID.step <= E.x1 + 1; x += GRID.step, n++) label(String.fromCharCode(65 + n), X(x + GRID.step / 2), 9, COL.muted, 'center', 9);
  for (let z = GRID.z0, n = 1; z + GRID.step <= E.z1 + 1; z += GRID.step, n++) label(String(n), 7, Z(z + GRID.step / 2), COL.muted, 'center', 9);

  // roads, city, airfield
  c.strokeStyle = 'rgba(214,196,140,0.55)'; c.lineWidth = 1;
  for (const r of ROADS) { c.beginPath(); r.forEach(([x, z], i) => (i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z)))); c.stroke(); }
  const C = SITES.city;
  c.beginPath(); c.ellipse(X(C.x), Z(C.z), R(C.rx), R(C.rz), 0, 0, Math.PI * 2); c.fillStyle = 'rgba(220,214,196,0.32)'; c.fill();
  c.strokeStyle = 'rgba(230,224,206,0.6)'; c.stroke();
  const A = SITES.airbase;
  c.strokeStyle = 'rgba(225,230,235,0.75)'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(X(A.x - A.len / 2), Z(A.z)); c.lineTo(X(A.x + A.len / 2), Z(A.z)); c.stroke();
  label('AIRFIELD', X(A.x), Z(A.z) + (scenario === 'rings' ? -13 : 10), COL.muted, 'center', 9); // rings 5 and 6 sit on the runway
  label('PORT', X(SITES.port.x) + 6, Z(SITES.port.z) + 4, COL.muted, 'left', 9);

  if (combat && M) {
    // threat rings (what can shoot at you, and from how far)
    const ring = (x, z, r, txt, labelAt = 'south') => {
      c.beginPath(); c.arc(X(x), Z(z), R(r), 0, Math.PI * 2);
      c.fillStyle = 'rgba(255,90,75,0.07)'; c.fill();
      c.setLineDash([6, 4]); c.strokeStyle = 'rgba(255,106,90,0.85)'; c.lineWidth = 1.3; c.stroke(); c.setLineDash([]);
      if (txt) label(txt, X(x), labelAt === 'south' ? Z(z) + R(r) - 8 : Z(z) - R(r) + 8, COL.red, 'center', 9, 700);
    };
    const diamond = (x, z, txt, align = 'left', dx = 8) => {
      const px = X(x), pz = Z(z); c.beginPath(); c.moveTo(px, pz - 4.5); c.lineTo(px + 4.5, pz); c.lineTo(px, pz + 4.5); c.lineTo(px - 4.5, pz); c.closePath();
      c.fillStyle = COL.amber; c.fill(); c.strokeStyle = COL.halo; c.lineWidth = 1; c.stroke();
      if (txt) label(txt, px + (align === 'left' ? dx : -dx), pz, COL.amber, align, 9, 700);
    };
    // destroyed already (an earlier stage, or this flight): a grey cross
    const wreck = (x, z, txt) => {
      const px = X(x), pz = Z(z); c.strokeStyle = 'rgba(190,198,204,0.8)'; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(px - 4, pz - 4); c.lineTo(px + 4, pz + 4); c.moveTo(px + 4, pz - 4); c.lineTo(px - 4, pz + 4); c.stroke();
      if (txt) label(txt, px + 8, pz, COL.muted, 'left', 8);
    };
    // air defenses still up
    const sam = M.samSite, pd = M.pd;
    if (sam && sam.alive) ring(STRIKE.sam.x, STRIKE.sam.z, sam.maxR, `SA-21 · ${Math.round(sam.maxR / 1000)} KM`);
    if (pd && pd.e.alive) ring(STRIKE.sa15.x, STRIKE.sa15.z, 12000, 'SA-15 · 12 KM');
    for (const e of M.defenses || []) if (e.alive && e.tag === 'AA GUN') ring(e.pos.x, e.pos.z, 3200, null);
    const ships = (M.fleet || []).filter(e => e.alive);
    if (ships.length) {
      const cx = ships.reduce((s, e) => s + e.pos.x, 0) / ships.length, cz = ships.reduce((s, e) => s + e.pos.z, 0) / ships.length;
      const rr = 13000 + Math.max(...ships.map(e => Math.hypot(e.pos.x - cx, e.pos.z - cz)));
      ring(cx, cz, rr, 'SHIP SAMs · 13 KM');
      for (const e of ships) shipIcon(c, X(e.pos.x), Z(e.pos.z), e.ship ? e.ship.heading : 4.45, COL.red, 0.8);
      if (M.kind === 'naval') for (const e of ships) diamond(e.pos.x, e.pos.z, e.name === 'DESTROYER' ? 'TGT · DESTROYER' : null, 'left', 10);
      label(`ENEMY SHIPS ×${ships.length}${M.kind === 'naval' ? ' · YOUR TARGETS' : ''}`, X(cx), Z(cz) + 16, M.kind === 'naval' ? COL.amber : COL.red, 'center', 9, 700);
    }
    // what is already destroyed
    if (!sam) { wreck(STRIKE.ew.x, STRIKE.ew.z, 'EW (DESTROYED)'); wreck(STRIKE.sam.x, STRIKE.sam.z, 'SA-21 (DESTROYED)'); }
    if (!pd) for (const p of [STRIKE.sa15, ...STRIKE.aaa]) wreck(p.x, p.z, null);
    for (const e of M.defenses || []) if (!e.alive) wreck(e.pos.x, e.pos.z, null);
    for (const e of M.fleet || []) if (!e.alive) wreck(e.pos.x, e.pos.z, null);
    if (M.bunker && !M.bunker.alive) wreck(STRIKE.hq.x, STRIKE.hq.z, 'HQ (DESTROYED)');
    if (M.kind === 'strike') {
      // targets: the air defenses (the bunker stage leaves them to Hammer flight)
      if (sid !== 'bunker') {
        for (const e of M.defenses || []) if (e.alive) diamond(e.pos.x, e.pos.z, null);
        if (sam && sam.alive) { diamond(STRIKE.ew.x, STRIKE.ew.z, 'EW RADAR'); diamond(STRIKE.sam.x, STRIKE.sam.z, 'SA-21 SITE', 'right'); }
      }
      // the bunker: crosshair and a callout for the cluster around it
      if (sid !== 'sead' && M.bunker && M.bunker.alive) {
        const bx = X(STRIKE.hq.x), bz = Z(STRIKE.hq.z);
        c.strokeStyle = COL.amber; c.lineWidth = 1.6; c.beginPath(); c.arc(bx, bz, 7, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.moveTo(bx - 11, bz); c.lineTo(bx - 3, bz); c.moveTo(bx + 3, bz); c.lineTo(bx + 11, bz); c.moveTo(bx, bz - 11); c.lineTo(bx, bz - 3); c.moveTo(bx, bz + 3); c.lineTo(bx, bz + 11); c.stroke();
        // callout to the open water south-west of the city, clear of the other labels
        c.strokeStyle = 'rgba(243,168,58,0.85)'; c.lineWidth = 1; c.beginPath(); c.moveTo(bx - 6, bz + 7); c.lineTo(bx - 26, bz + 38); c.lineTo(bx - 34, bz + 38); c.stroke();
        label('TGT · COMMAND BUNKER', bx - 37, bz + 38, COL.amber, 'right', 10, 700);
        label(`grid ${gridRef(STRIKE.hq.x, STRIKE.hq.z)}${pd ? ' · SA-15 + 2 AAA' : ''}`, bx - 37, bz + 51, COL.text, 'right', 9);
      }
    }
    if (!live) {
      // enemy fighter patrols
      const caps = [];
      for (const j of M.jets || []) if (j.alive && j.cap) { const cp = caps.find(q => Math.hypot(q.x - j.cap.x, q.z - j.cap.z) < 3000); if (cp) cp.n++; else caps.push({ x: j.cap.x, z: j.cap.z, n: 1 }); }
      for (const cp of caps) {
        const px = X(cp.x), pz = Z(cp.z), rx = R(4200), rz = R(1600);
        c.setLineDash([4, 3]); c.strokeStyle = COL.red; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(px - rx + rz, pz - rz); c.lineTo(px + rx - rz, pz - rz); c.arc(px + rx - rz, pz, rz, -Math.PI / 2, Math.PI / 2); c.lineTo(px - rx + rz, pz + rz); c.arc(px - rx + rz, pz, rz, Math.PI / 2, Math.PI * 1.5); c.stroke(); c.setLineDash([]);
        label(`CAP · ${cp.n}× SU-27`, px, pz - rz - 9, COL.red, 'center', 9, 700);
      }
      // drones on station: their orbits
      for (const d of game.drones || []) if (d.alive && d.orbit && !d.target) {
        const blue = d.team === 'blue';
        c.setLineDash([2, 4]); c.strokeStyle = blue ? COL.blue : COL.red; c.lineWidth = 1.2;
        c.beginPath(); c.arc(X(d.orbit.x), Z(d.orbit.z), R(d.orbitR), 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
        label(blue ? 'REAPER DRONE (FRIENDLY)' : 'ENEMY SPY DRONE', X(d.orbit.x), Z(d.orbit.z) - R(d.orbitR) - 8, blue ? COL.blue : COL.red, 'center', 9, 700);
      }
    }
    // the drone and missile waves of the last stage: where they come from
    if (M.kind === 'defense' && M.ctl) {
      const cv = game.carrier.pos;
      WAVES.forEach((W, wi) => {
        if (wi < M.ctl.waveI - 1) return; // long gone
        for (const G of W.groups) {
          const b = G.brg * Math.PI / 180, r0 = Math.min(G.R, 15000), r1 = 6000;
          const x0 = cv.x + Math.sin(b) * r0, z0 = cv.z - Math.cos(b) * r0, x1 = cv.x + Math.sin(b) * r1, z1 = cv.z - Math.cos(b) * r1;
          c.strokeStyle = wi < M.ctl.waveI ? COL.red : 'rgba(255,106,90,0.55)'; c.lineWidth = 1.6; c.setLineDash(wi < M.ctl.waveI ? [] : [5, 4]);
          c.beginPath(); c.moveTo(X(x0), Z(z0)); c.lineTo(X(x1), Z(z1)); c.stroke(); c.setLineDash([]);
          const a = Math.atan2(Z(z1) - Z(z0), X(x1) - X(x0));
          c.beginPath(); c.moveTo(X(x1), Z(z1)); c.lineTo(X(x1) - Math.cos(a - 0.45) * 8, Z(z1) - Math.sin(a - 0.45) * 8); c.lineTo(X(x1) - Math.cos(a + 0.45) * 8, Z(z1) - Math.sin(a + 0.45) * 8); c.closePath(); c.fillStyle = c.strokeStyle; c.fill();
          label(`W${wi + 1} · ${G.n}× ${G.type === 'cruise' ? 'MISSILE' : 'DRONE'}`, X(x0), Z(z0) - 9, COL.red, 'center', 8, 700);
        }
      });
    }
    if (live) {
      // everything flying, where it is now
      for (const j of game.aiJets) if (j.alive) {
        const blue = j.team === 'blue', h = Math.atan2(j.vel.x, -j.vel.z);
        jetIcon(c, X(j.pos.x), Z(j.pos.z), h, blue ? COL.blue : COL.red, 0.7);
        if (blue) label(j.isStrikeWing ? j.name : 'SPEAR 1-2', X(j.pos.x) + 9, Z(j.pos.z) + 8, COL.blue, 'left', 8);
      }
      for (const d of game.drones || []) if (d.alive) {
        const blue = d.team === 'blue', px = X(d.pos.x), pz = Z(d.pos.z), h = Math.atan2(d.vel.x, -d.vel.z);
        c.save(); c.translate(px, pz); c.rotate(h); c.beginPath(); c.moveTo(0, -5); c.lineTo(4, 4); c.lineTo(-4, 4); c.closePath();
        c.fillStyle = blue ? COL.blue : d.type === 'cruise' ? '#ff3b30' : '#ff9a4d'; c.fill(); c.lineWidth = 1; c.strokeStyle = COL.halo; c.stroke(); c.restore();
        if (d.type === 'recon' || d.type === 'reaper') label(blue ? 'REAPER' : 'SPY DRONE', px + 8, pz, blue ? COL.blue : COL.red, 'left', 8);
      }
      for (const m of game.world.missiles) if (!m.dead && m.target === game.player) { c.beginPath(); c.arc(X(m.pos.x), Z(m.pos.z), 3, 0, Math.PI * 2); c.fillStyle = '#ff2a2a'; c.fill(); }
    }
  }

  // friendly ships: the carrier (MOTHER) and its escorts
  for (const s of game.ships) if (s.team === 'blue' && s.alive) shipIcon(c, X(s.pos.x), Z(s.pos.z), s.heading, COL.blue, s === game.carrier ? 1.25 : 0.75);
  const cv = game.carrier.pos;
  label('CVN-90 · MOTHER', X(cv.x) + 16, Z(cv.z) + 1, COL.blue, 'left', 9, 700);

  // you, and the planned route
  const P = game.player, pp = P.pos, f = P.ac.forward(P.pos.clone());
  const hdg = Math.atan2(f.x, -f.z);
  const route = [];
  const dashed = (pts) => { c.setLineDash([2, 5]); c.lineCap = 'round'; c.strokeStyle = COL.route; c.lineWidth = 1.6; c.beginPath(); pts.forEach(([x, z], i) => (i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z)))); c.stroke(); c.setLineDash([]); };
  const point = (x, z, txt, align = 'right') => { c.beginPath(); c.arc(X(x), Z(z), 4, 0, Math.PI * 2); c.fillStyle = COL.route; c.fill(); label(txt, X(x) + (align === 'right' ? -8 : 8), Z(z), COL.route, align, 9); };
  const strikeRoute = scenario === 'strike' || scenario === 'carrier' || scenario === 'deck' || sid === 'sead' || sid === 'bunker';
  const RC = M && M.kind === 'rings' && M.ctl;
  if (RC && RC.rings.length) {
    // the ring course: numbered rings joined in flying order; flown ones grey, the next green, the one after orange
    const rs = RC.rings, GREEN = '#7dffb0';
    if (!RC.i) dashed([[pp.x, pp.z], [rs[0].pos.x, rs[0].pos.z]]);
    c.lineWidth = 1.8; c.setLineDash([6, 4]);
    for (let k = 1; k < rs.length; k++) {
      c.strokeStyle = k <= RC.i ? 'rgba(200,210,215,0.35)' : 'rgba(125,255,176,0.8)';
      c.beginPath(); c.moveTo(X(rs[k - 1].pos.x), Z(rs[k - 1].pos.z)); c.lineTo(X(rs[k].pos.x), Z(rs[k].pos.z)); c.stroke();
    }
    c.setLineDash([]);
    rs.forEach((r, k) => {
      const rad = k === RC.i ? 8 : 6.5;
      // the westernmost ring sits just past the chart edge: pin it inside
      const px = Math.max(rad + 2, Math.min(cssW - rad - 2, X(r.pos.x))), pz = Z(r.pos.z);
      const done = k < RC.i, next = k === RC.i, then = k === RC.i + 1;
      c.beginPath(); c.arc(px, pz, rad, 0, Math.PI * 2);
      c.fillStyle = done ? 'rgba(120,130,136,0.85)' : next ? GREEN : then ? COL.amber : 'rgba(8,18,24,0.88)'; c.fill();
      c.lineWidth = 1.4; c.strokeStyle = done ? COL.halo : next || then ? COL.halo : GREEN; c.stroke();
      c.font = `700 ${k >= 9 ? 8 : 9}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = next || then ? '#08140d' : done ? '#20282c' : COL.text; c.fillText(String(k + 1), px, pz + 0.5);
    });
    const f0 = rs[rs.length - 1].pos;
    label('FINISH', X(f0.x) + 12, Z(f0.z), GREEN, 'left', 9, 700);
    if (!RC.i && !live) label('RING 1', X(rs[0].pos.x) + 12, Z(rs[0].pos.z), GREEN, 'left', 9, 700);
  }
  if (live || RC) { /* the plan is in the briefing; the live map shows where everyone is */ }
  else if (strikeRoute) {
    const ip = { x: 2400, z: 30500 };
    route.push([pp.x, pp.z], [ip.x, ip.z], [STRIKE.hq.x, STRIKE.hq.z + 400], [cv.x, cv.z]);
    dashed(route);
    point(ip.x, ip.z, sid === 'bunker' ? 'IP · turn in for the bunker' : 'IP · fire anti-radar missiles');
  } else if (sid === 'naval' && M.fleet && M.fleet.length) {
    // a firing point 25 km short of the warships, then away from their SAMs and home
    const f = M.fleet[0].pos, dx = pp.x - f.x, dz = pp.z - f.z, d = Math.hypot(dx, dz) || 1;
    const fp = { x: f.x + dx / d * 25000, z: f.z + dz / d * 25000 };
    dashed([[pp.x, pp.z], [fp.x, fp.z], [cv.x, cv.z]]);
    point(fp.x, fp.z, 'FIRE HARPOONS HERE · 25 KM', 'left');
  } else if (sid === 'defense') {
    // the outer patrol, north of the ship where the waves come from
    const px = cv.x + 1500, pz = cv.z - 9000;
    c.setLineDash([2, 5]); c.strokeStyle = COL.route; c.lineWidth = 1.6; c.beginPath(); c.arc(X(px), Z(pz), R(4000), 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    label('PATROL HERE', X(px), Z(pz) + R(4000) + 9, COL.route, 'center', 9, 700);
  } else if (scenario === 'air' || sid === 'air') {
    dashed([[pp.x, pp.z], [pp.x + Math.sin(hdg) * 16000, pp.z - Math.cos(hdg) * 16000]]);
  }
  jetIcon(c, X(pp.x), Z(pp.z), hdg, live ? '#ffffff' : COL.blue);
  if (scenario !== 'carrier' && scenario !== 'deck') label(live ? 'YOU' : 'SPEAR 1-1 (YOU)', X(pp.x) + 12, Z(pp.z) - 10, live ? '#ffffff' : COL.blue, 'left', 9, 700);
  else label('YOU START HERE', X(cv.x) + 16, Z(cv.z) + 13, COL.blue, 'left', 9);

  // north arrow and scale bar
  const nx = cssW - 18, ny = 26;
  c.fillStyle = COL.text; c.beginPath(); c.moveTo(nx, ny - 12); c.lineTo(nx + 5, ny + 2); c.lineTo(nx, ny - 1); c.lineTo(nx - 5, ny + 2); c.closePath(); c.fill();
  label('N', nx, ny + 10, COL.text, 'center', 10, 700);
  const sx0 = 14, sy = cssH - 14, L10 = R(10000);
  c.strokeStyle = COL.text; c.lineWidth = 1.5; c.beginPath(); c.moveTo(sx0, sy - 4); c.lineTo(sx0, sy); c.lineTo(sx0 + L10, sy); c.lineTo(sx0 + L10, sy - 4); c.moveTo(sx0 + L10 / 2, sy); c.lineTo(sx0 + L10 / 2, sy - 3); c.stroke();
  label('10 KM', sx0 + L10 + 6, sy - 2, COL.text, 'left', 9);
  c.restore();
}

// map symbols
function shipIcon(c, x, y, hdg, col, s = 1) {
  c.save(); c.translate(x, y); c.rotate(hdg); c.scale(s, s);
  c.beginPath(); c.moveTo(0, -9); c.quadraticCurveTo(4, -3, 3.4, 6); c.lineTo(-3.4, 6); c.quadraticCurveTo(-4, -3, 0, -9); c.closePath();
  c.fillStyle = col; c.fill(); c.lineWidth = 1.2; c.strokeStyle = COL.halo; c.stroke();
  c.restore();
}
function jetIcon(c, x, y, hdg, col, s = 1) {
  c.save(); c.translate(x, y); c.rotate(hdg); c.scale(s, s);
  c.beginPath(); c.moveTo(0, -9); c.lineTo(2, -3); c.lineTo(8, 2); c.lineTo(8, 4); c.lineTo(2, 2); c.lineTo(1.5, 6); c.lineTo(4, 8); c.lineTo(-4, 8); c.lineTo(-1.5, 6); c.lineTo(-2, 2); c.lineTo(-8, 4); c.lineTo(-8, 2); c.lineTo(-2, -3); c.closePath();
  c.fillStyle = col; c.fill(); c.lineWidth = 1.4; c.strokeStyle = COL.halo; c.stroke();
  c.restore();
}
