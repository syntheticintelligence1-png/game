// Briefing map: a kneeboard chart drawn from the real terrain — relief shading, contours and coastline, a 10 km
// grid, roads and the city — with the enemy threat rings, targets, fighter patrols, ships and the planned route.
import { STRIKE } from '../game/mission.js';
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

let cache = null; // relief bitmap; the terrain never changes, so it is built once per canvas size
function relief(game, ctx, W, H, E) {
  if (cache && cache.W === W && cache.H === H) return cache.img;
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
  cache = { W, H, img };
  return img;
}

// scenario: carrier | deck | strike | air | approach
export function drawBriefMap(canvas, game, scenario) {
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
  const M = game.mission, combat = scenario !== 'approach';

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
  label('AIRFIELD', X(A.x), Z(A.z) + 10, COL.muted, 'center', 9);
  label('PORT', X(SITES.port.x) + 6, Z(SITES.port.z) + 4, COL.muted, 'left', 9);

  if (combat && M) {
    // threat rings (what can shoot at you, and from how far)
    const ring = (x, z, r, txt, labelAt = 'south') => {
      c.beginPath(); c.arc(X(x), Z(z), R(r), 0, Math.PI * 2);
      c.fillStyle = 'rgba(255,90,75,0.07)'; c.fill();
      c.setLineDash([6, 4]); c.strokeStyle = 'rgba(255,106,90,0.85)'; c.lineWidth = 1.3; c.stroke(); c.setLineDash([]);
      if (txt) label(txt, X(x), labelAt === 'south' ? Z(z) + R(r) - 8 : Z(z) - R(r) + 8, COL.red, 'center', 9, 700);
    };
    if (M.kind === 'strike') {
      const sam = M.samSite, pd = M.pd;
      if (sam && sam.alive) ring(STRIKE.sam.x, STRIKE.sam.z, sam.maxR, `SA-21 · ${Math.round(sam.maxR / 1000)} KM`);
      if (pd && pd.e.alive) ring(STRIKE.sa15.x, STRIKE.sa15.z, 12000, 'SA-15 · 12 KM');
      for (const a of STRIKE.aaa) ring(a.x, a.z, 3200, null);
      const ships = (M.fleet || []).filter(e => e.alive);
      if (ships.length) {
        const cx = ships.reduce((s, e) => s + e.pos.x, 0) / ships.length, cz = ships.reduce((s, e) => s + e.pos.z, 0) / ships.length;
        const rr = 13000 + Math.max(...ships.map(e => Math.hypot(e.pos.x - cx, e.pos.z - cz)));
        ring(cx, cz, rr, 'SHIP SAMs · 13 KM');
        for (const e of ships) shipIcon(c, X(e.pos.x), Z(e.pos.z), e.ship ? e.ship.heading : 4.45, COL.red, 0.8);
        label(`ENEMY SHIPS ×${ships.length}`, X(cx), Z(cz) + 16, COL.red, 'center', 9, 700);
      }
      // targets
      const diamond = (x, z, txt, align = 'left', dx = 8) => {
        const px = X(x), pz = Z(z); c.beginPath(); c.moveTo(px, pz - 4.5); c.lineTo(px + 4.5, pz); c.lineTo(px, pz + 4.5); c.lineTo(px - 4.5, pz); c.closePath();
        c.fillStyle = COL.amber; c.fill(); c.strokeStyle = COL.halo; c.lineWidth = 1; c.stroke();
        if (txt) label(txt, px + (align === 'left' ? dx : -dx), pz, COL.amber, align, 9, 700);
      };
      for (const e of M.defenses || []) if (e.alive) diamond(e.pos.x, e.pos.z, null);
      diamond(STRIKE.ew.x, STRIKE.ew.z, 'EW RADAR');
      diamond(STRIKE.sam.x, STRIKE.sam.z, 'SA-21 SITE', 'right');
      // the bunker: crosshair and a callout for the cluster around it
      const bx = X(STRIKE.hq.x), bz = Z(STRIKE.hq.z);
      c.strokeStyle = COL.amber; c.lineWidth = 1.6; c.beginPath(); c.arc(bx, bz, 7, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(bx - 11, bz); c.lineTo(bx - 3, bz); c.moveTo(bx + 3, bz); c.lineTo(bx + 11, bz); c.moveTo(bx, bz - 11); c.lineTo(bx, bz - 3); c.moveTo(bx, bz + 3); c.lineTo(bx, bz + 11); c.stroke();
      // callout to the open water south-west of the city, clear of the other labels
      c.strokeStyle = 'rgba(243,168,58,0.85)'; c.lineWidth = 1; c.beginPath(); c.moveTo(bx - 6, bz + 7); c.lineTo(bx - 26, bz + 38); c.lineTo(bx - 34, bz + 38); c.stroke();
      label('TGT · COMMAND BUNKER', bx - 37, bz + 38, COL.amber, 'right', 10, 700);
      label(`grid ${gridRef(STRIKE.hq.x, STRIKE.hq.z)} · SA-15 + 2 AAA`, bx - 37, bz + 51, COL.text, 'right', 9);
    }
    // enemy fighter patrols
    const caps = [];
    for (const j of M.jets || []) if (j.alive) { const cp = caps.find(q => Math.hypot(q.x - j.cap.x, q.z - j.cap.z) < 3000); if (cp) cp.n++; else caps.push({ x: j.cap.x, z: j.cap.z, n: 1 }); }
    for (const cp of caps) {
      const px = X(cp.x), pz = Z(cp.z), rx = R(4200), rz = R(1600);
      c.setLineDash([4, 3]); c.strokeStyle = COL.red; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(px - rx + rz, pz - rz); c.lineTo(px + rx - rz, pz - rz); c.arc(px + rx - rz, pz, rz, -Math.PI / 2, Math.PI / 2); c.lineTo(px - rx + rz, pz + rz); c.arc(px - rx + rz, pz, rz, Math.PI / 2, Math.PI * 1.5); c.stroke(); c.setLineDash([]);
      label(`CAP · ${cp.n}× SU-27`, px, pz - rz - 9, COL.red, 'center', 9, 700);
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
  if (scenario === 'strike' || scenario === 'carrier' || scenario === 'deck') {
    const ip = { x: 2400, z: 30500 };
    route.push([pp.x, pp.z], [ip.x, ip.z], [STRIKE.hq.x, STRIKE.hq.z + 400], [cv.x, cv.z]);
    c.setLineDash([2, 5]); c.lineCap = 'round'; c.strokeStyle = COL.route; c.lineWidth = 1.6;
    c.beginPath(); route.forEach(([x, z], i) => (i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z)))); c.stroke(); c.setLineDash([]);
    c.beginPath(); c.arc(X(ip.x), Z(ip.z), 4, 0, Math.PI * 2); c.fillStyle = COL.route; c.fill();
    label('IP · fire anti-radar missiles', X(ip.x) - 8, Z(ip.z), COL.route, 'right', 9);
  } else if (scenario === 'air') {
    c.setLineDash([2, 5]); c.strokeStyle = COL.route; c.lineWidth = 1.6; c.beginPath(); c.moveTo(X(pp.x), Z(pp.z)); c.lineTo(X(pp.x + Math.sin(hdg) * 16000), Z(pp.z - Math.cos(hdg) * 16000)); c.stroke(); c.setLineDash([]);
  }
  jetIcon(c, X(pp.x), Z(pp.z), hdg, COL.blue);
  if (scenario !== 'carrier' && scenario !== 'deck') label('SPEAR 1-1 (YOU)', X(pp.x) + 12, Z(pp.z) - 10, COL.blue, 'left', 9, 700);
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
function jetIcon(c, x, y, hdg, col) {
  c.save(); c.translate(x, y); c.rotate(hdg);
  c.beginPath(); c.moveTo(0, -9); c.lineTo(2, -3); c.lineTo(8, 2); c.lineTo(8, 4); c.lineTo(2, 2); c.lineTo(1.5, 6); c.lineTo(4, 8); c.lineTo(-4, 8); c.lineTo(-1.5, 6); c.lineTo(-2, 2); c.lineTo(-8, 4); c.lineTo(-8, 2); c.lineTo(-2, -3); c.closePath();
  c.fillStyle = col; c.fill(); c.lineWidth = 1.4; c.strokeStyle = COL.halo; c.stroke();
  c.restore();
}
