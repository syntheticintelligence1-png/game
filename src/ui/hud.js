// HUD (collimated symbology projected through the active camera, clipped to the combiner in the cockpit),
// missile seeker telemetry overlay, and cockpit MFD pages (radar B-scope + RWR).
import * as THREE from 'three';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const HUD_HALF_W = 262; // half-width of the flight HUD (speed box to altitude box) in HUD units

export class HUD {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.green = '#62ff7a'; this.t = 0;
    this.resize();
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.c.width = Math.floor(innerWidth * dpr); this.c.height = Math.floor(innerHeight * dpr);
    this.c.style.width = innerWidth + 'px'; this.c.style.height = innerHeight + 'px';
    // scale with the window height, but in narrow windows with the width, so the HUD keeps clear of the cards at the sides
    this.dpr = dpr; this.W = this.c.width; this.H = this.c.height; this.s = Math.min(this.H / 900, this.W / 1500);
    this.cssHalfW = HUD_HALF_W * this.s / dpr; // the flight HUD spans the screen centre ± this (CSS px)
    this.topRightCss = 60; // bottom of the weapon list / wingman text at the top right (CSS px), set while drawing
  }
  // world direction -> screen px (null when behind camera)
  proj(cam, dir) {
    _v.copy(cam.position).addScaledVector(dir, 1000);
    _v2.copy(_v).applyMatrix4(cam.matrixWorldInverse);
    if (_v2.z > -1) return null;
    _v.project(cam);
    return [(_v.x * 0.5 + 0.5) * this.W, (-_v.y * 0.5 + 0.5) * this.H];
  }
  projPoint(cam, p) {
    _v2.copy(p).applyMatrix4(cam.matrixWorldInverse);
    if (_v2.z > -0.5) return null;
    _v.copy(p).project(cam);
    return [(_v.x * 0.5 + 0.5) * this.W, (-_v.y * 0.5 + 0.5) * this.H];
  }
  line(x0, y0, x1, y1) { const c = this.ctx; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
  text(t, x, y, align = 'center', size = 15) { const c = this.ctx; c.font = `bold ${Math.round(size * this.s)}px "Consolas","Menlo","Courier New",monospace`; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(t, x, y); }
  glow(fn) {
    const c = this.ctx; c.save(); c.globalAlpha = 0.28; c.lineWidth = 3.6 * this.s; fn(); c.restore();
    c.save(); c.lineWidth = 1.5 * this.s; fn(); c.restore();
  }

  draw(S, cam) {
    const c = this.ctx; this.t += 1 / 60;
    c.clearRect(0, 0, this.W, this.H);
    if (!S || S.hidden) return;
    if (S.mode === 'seeker') {
      this.drawSeeker(S, cam);
      const c = this.ctx, s = this.s;
      c.save(); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(this.W / 2 - 170 * s, 14 * s, 340 * s, 24 * s); c.fillStyle = '#9fffb5';
      this.text('AUTOPILOT FLYING YOUR JET · M = TAKE BACK CONTROL', this.W / 2, 26 * s, 'center', 12); c.restore();
      if (S.threat) { this.drawThreat(S.threat); c.save(); c.fillStyle = '#ffe14d'; this.text('MISSILE COMING AT YOUR JET — PRESS M NOW', this.W / 2, this.H * 0.6, 'center', 16); c.restore(); }
      const wy = S.wing && S.wing.menu ? this.drawWing(S.wing, this.W - 18 * s, 60 * s) : 80 * s;
      this.topRightCss = wy / this.dpr;
      this.drawMessages(S); return;
    }
    if (S.mode === 'defender') { this.topRightCss = 80 * this.s / this.dpr; this.drawDefender(S, cam); this.drawMessages(S); return; }
    if (S.ac && S.showHud) {
      c.save();
      c.strokeStyle = this.green; c.fillStyle = this.green;
      if (S.clip) { c.beginPath(); S.clip.forEach(([x, y], i) => (i ? c.lineTo(x * this.dpr, y * this.dpr) : c.moveTo(x * this.dpr, y * this.dpr))); c.closePath(); c.clip(); }
      else { c.beginPath(); c.rect(this.W * 0.18, this.H * 0.06, this.W * 0.64, this.H * 0.88); c.clip(); }
      this.glow(() => this.drawFlight(S, cam));
      c.restore();
    }
    if (S.markers) this.drawMarkers(S.markers, cam);
    if (S.threat) this.drawThreat(S.threat);
    this.drawOverlay(S, cam);
    if (S.banner) this.drawBanner(S.banner, S.leftInset);
    this.drawMessages(S);
  }

  // landing-assist strip at the top of the screen, kept clear of the coach card on the left
  drawBanner(B, leftInset) {
    const c = this.ctx, s = this.s;
    c.save(); c.font = `bold ${Math.round(12 * s)}px "Consolas","Menlo","Courier New",monospace`;
    const w = c.measureText(B.text).width + 24 * s, inset = (leftInset || 0) * this.dpr;
    const cx = Math.min(Math.max(this.W / 2, inset + w / 2 + 12 * s), this.W - w / 2 - 12 * s);
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(cx - w / 2, 14 * s, w, 24 * s);
    c.fillStyle = B.color || '#9fffb5'; this.text(B.text, cx, 26 * s, 'center', 12); c.restore();
  }

  // defensive cue: what is coming, from where, and which way to break
  drawThreat(T) {
    const c = this.ctx, s = this.s, W = this.W, H = this.H;
    const flash = (this.t * 3) % 1 < 0.6;
    const cx = W / 2, cy = H * 0.7, w = 420 * s, h = 92 * s;
    c.save();
    c.fillStyle = 'rgba(40,0,0,0.55)'; c.fillRect(cx - w / 2, cy - h / 2, w, h);
    c.strokeStyle = flash ? '#ff3b30' : '#a01d18'; c.lineWidth = 2.5 * s; c.strokeRect(cx - w / 2, cy - h / 2, w, h);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffd6d2';
    c.font = `bold ${Math.round(12 * s)}px "Consolas","Menlo",monospace`;
    c.fillText(`${T.n > 1 ? T.n + ' MISSILES' : 'MISSILE'} · ${T.radar ? 'RADAR-GUIDED' : 'HEAT-SEEKER'} · ${T.clock} O'CLOCK · ${(T.d / 1000).toFixed(1)} KM · ${Math.max(0, T.tti).toFixed(0)} S`, cx, cy - h * 0.3);
    c.font = `bold ${Math.round(24 * s)}px "Consolas","Menlo",monospace`; c.fillStyle = '#ffffff';
    const what = T.ref === 'radar' ? 'THE RADAR' : 'IT';
    const big = T.turn < 0 ? '◀  BREAK LEFT' : T.turn > 0 ? 'BREAK RIGHT  ▶' : T.notching ? `NOTCHING — HOLD ${T.bearing > 0 ? 'RIGHT' : 'LEFT'} BEAM` : `HOLD ${what} AT ${T.bearing > 0 ? '3' : '9'} O'CLOCK`;
    c.fillText(big, cx, cy + h * 0.02);
    c.font = `bold ${Math.round(12 * s)}px "Consolas","Menlo",monospace`;
    c.fillStyle = T.cmNow ? (flash ? '#ffe14d' : '#ffffff') : '#ffd6d2';
    c.fillText(T.cmNow ? 'NOW — PRESS X (CHAFF + FLARES), KEEP IT ON THE BEAM' : T.radar ? `turn until ${what.toLowerCase()} is beside you (3 or 9 o'clock), then X` : 'press X for flares when it is close · keep turning hard', cx, cy + h * 0.33);
    c.restore();
  }

  // target markers: boxes on enemy jets, diamonds on mission targets, edge arrows for things off-screen
  drawMarkers(list, cam) {
    const c = this.ctx, s = this.s, W = this.W, H = this.H;
    const COL = { air: '#ff5a4f', drone: '#ff9a4d', objective: '#ffb03b', ground: '#ff8a6b', spotted: '#ffa54a', ship: '#ff6f5e', missile: '#ff2a2a', friendly: '#7fd0ff', join: '#7dffb0', spot: '#7dffb0', ring2: '#ffb347' };
    const fmt = (d) => d < 1000 ? `${Math.round(d / 10) * 10} m` : d < 20000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 1000)} km`;
    const flash = (this.t * 4) % 1 < 0.55;
    const tanHalf = Math.tan(cam.fov * Math.PI / 360);
    const PRI = { missile: 1, objective: 2, join: 2.5, spot: 2.5, ring2: 2.7, air: 3, drone: 3.2, ship: 4, ground: 5, spotted: 5.5, friendly: 6 };
    const labels = [];
    c.save(); c.lineJoin = 'round'; c.textBaseline = 'middle';
    for (const m of list) {
      const col = m.lock ? '#ffe14d' : COL[m.kind] || '#ffffff';
      _v2.copy(m.pos).applyMatrix4(cam.matrixWorldInverse);
      const inFront = _v2.z < -1;
      let sx = 0, sy = 0, on = false;
      if (inFront) { _v.copy(m.pos).project(cam); sx = (_v.x * 0.5 + 0.5) * W; sy = (-_v.y * 0.5 + 0.5) * H; on = sx > 0 && sx < W && sy > 0 && sy < H; }
      if (on) {
        if (m.kind === 'missile' && !flash) continue;
        const px = Math.max(9 * s, Math.min(46 * s, (m.r || 6) / (m.d * tanHalf) * H * 0.5 * 1.4));
        c.strokeStyle = col; c.fillStyle = col; c.lineWidth = (m.lock ? 2.6 : 1.7) * s;
        c.shadowColor = 'rgba(0,0,0,0.75)'; c.shadowBlur = 3 * s;
        c.beginPath();
        if (m.kind === 'air') {
          const k = px * 0.45; // corner brackets
          for (const [ax, ay] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.moveTo(sx + ax * px, sy + ay * (px - k)); c.lineTo(sx + ax * px, sy + ay * px); c.lineTo(sx + ax * (px - k), sy + ay * px); }
        } else if (m.kind === 'drone') { const r = Math.max(7 * s, px * 0.8); c.moveTo(sx - r, sy - r * 0.6); c.lineTo(sx + r, sy - r * 0.6); c.lineTo(sx, sy + r); c.closePath(); }
        else if (m.kind === 'missile') { c.arc(sx, sy, 10 * s, 0, Math.PI * 2); c.moveTo(sx - 6 * s, sy - 6 * s); c.lineTo(sx + 6 * s, sy + 6 * s); c.moveTo(sx + 6 * s, sy - 6 * s); c.lineTo(sx - 6 * s, sy + 6 * s); }
        else if (m.kind === 'friendly') { c.moveTo(sx - 9 * s, sy - 6 * s); c.lineTo(sx, sy + 4 * s); c.lineTo(sx + 9 * s, sy - 6 * s); }
        else if (m.kind === 'join') { const r = m.r >= 60 ? Math.max(13 * s, px * 0.9) : 13 * s; c.arc(sx, sy, r, 0, Math.PI * 2); c.moveTo(sx + 2.5 * s, sy); c.arc(sx, sy, 2.5 * s, 0, Math.PI * 2); }
        else if (m.kind === 'ring2') { const r = Math.max(9 * s, px * 0.9); c.setLineDash([4 * s, 4 * s]); c.arc(sx, sy, r, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); c.beginPath(); }
        else if (m.kind === 'spot') { const w = Math.max(12 * s, px * 0.9), h = Math.max(4 * s, w * 0.3); c.rect(sx - w, sy - h, 2 * w, 2 * h); c.moveTo(sx - w * 0.4, sy); c.lineTo(sx + w * 0.4, sy); }
        else if (m.kind === 'ground') { const r = 5 * s; c.moveTo(sx, sy - r); c.lineTo(sx + r, sy); c.lineTo(sx, sy + r); c.lineTo(sx - r, sy); c.closePath(); }
        else { const r = Math.max(9 * s, px * 0.8); c.moveTo(sx, sy - r); c.lineTo(sx + r, sy); c.lineTo(sx, sy + r); c.lineTo(sx - r, sy); c.closePath(); if (m.kind === 'objective' && flash) { c.moveTo(sx + 2.5 * s, sy); c.arc(sx, sy, 2.5 * s, 0, Math.PI * 2); } }
        c.stroke();
        if (m.lock) { const r = px + 7 * s; c.beginPath(); c.moveTo(sx, sy - r); c.lineTo(sx + r, sy); c.lineTo(sx, sy + r); c.lineTo(sx - r, sy); c.closePath(); c.stroke(); }
        const label = m.label ? `${m.lock ? (m.kind === 'air' || m.kind === 'drone' ? 'LOCKED ' : 'MARKED ') : m.tone ? 'TONE ' : ''}${m.label}` : '';
        if (label || m.kind !== 'ground') labels.push({ m, x: sx, y: sy + Math.max(px, 9 * s) + 10 * s, col, label, dist: fmt(m.d), pri: m.lock ? 0 : PRI[m.kind] ?? 7 });
      } else if (m.arrow) {
        // edge arrow toward the target (works for things behind the camera too)
        let ax = _v2.x, ay = -_v2.y; if (!inFront && Math.hypot(ax, ay) < 1e-3) ay = 1;
        const a = Math.atan2(ay, ax);
        const rx = W / 2 - 46 * s, ry = H / 2 - 46 * s;
        const ex = W / 2 + Math.cos(a) * rx, ey = H / 2 + Math.sin(a) * ry;
        if (m.kind === 'missile' && !flash) continue;
        c.save(); c.translate(ex, ey); c.rotate(a);
        c.fillStyle = col; c.shadowColor = 'rgba(0,0,0,0.75)'; c.shadowBlur = 3 * s;
        c.beginPath(); c.moveTo(14 * s, 0); c.lineTo(-6 * s, -9 * s); c.lineTo(-2 * s, 0); c.lineTo(-6 * s, 9 * s); c.closePath(); c.fill();
        c.restore();
        const lx = ex - Math.cos(a) * 26 * s, ly = ey - Math.sin(a) * 22 * s;
        labels.push({ m, x: lx, y: ly - 6 * s, col, label: m.label, dist: fmt(m.d), pri: (m.lock ? 0 : PRI[m.kind] ?? 7) + 0.5 });
      }
    }
    // labels, most important first (locked, incoming missiles, objectives, jets…); a label that would overlap one
    // already placed is folded into it as "+N" so clustered targets stay readable
    labels.sort((a, b) => a.pri - b.pri || a.m.d - b.m.d);
    c.font = `bold ${Math.round(11 * s)}px "Consolas","Menlo",monospace`; c.textAlign = 'center';
    const placed = [];
    for (const L of labels) {
      const w = Math.max(L.label ? c.measureText(L.label).width : 0, c.measureText(L.dist).width) + 8 * s, h = (L.label ? 26 : 13) * s;
      const r = { x0: L.x - w / 2, x1: L.x + w / 2, y0: L.y - 7 * s, y1: L.y - 7 * s + h };
      const hit = placed.find((p) => r.x0 < p.r.x1 && r.x1 > p.r.x0 && r.y0 < p.r.y1 && r.y1 > p.r.y0);
      if (hit) { hit.more++; continue; }
      placed.push({ L, r, more: 0 });
    }
    c.shadowColor = 'rgba(0,0,0,0.85)'; c.shadowBlur = 3 * s;
    for (const p of placed) {
      const L = p.L; let y = L.y; c.fillStyle = L.col;
      if (L.label) { c.fillText(p.more ? `${L.label} +${p.more}` : L.label, L.x, y); y += 13 * s; }
      c.fillText(L.dist, L.x, y);
    }
    c.restore();
  }

  drawFlight(S, cam) {
    const c = this.ctx; const s = this.s; const W = this.W, H = this.H;
    const ac = S.ac;
    // boresight (gun cross / waterline)
    const bs = this.proj(cam, S.fwd);
    if (bs) { const [x, y] = bs; const k = 12 * s; this.line(x - k, y, x - k * 0.4, y); this.line(x + k * 0.4, y, x + k, y); this.line(x, y - k * 0.4, x, y - k); this.line(x - k * 0.4, y, x, y + k * 0.35); this.line(x, y + k * 0.35, x + k * 0.4, y); }
    // flight path marker
    const vdir = S.vel.lengthSq() > 4 ? S.vel.clone().normalize() : S.fwd.clone();
    const fpm = this.proj(cam, vdir);
    // pitch ladder centered on FPM heading
    const psi = Math.atan2(vdir.x, -vdir.z);
    const roll = S.roll * D2R;
    const pitchAt = (p, dpsi = 0) => _v2.set(Math.sin(psi + dpsi) * Math.cos(p), Math.sin(p), -Math.cos(psi + dpsi) * Math.cos(p));
    const pitch = S.pitch;
    // outside view: a lighter ladder (horizon and every 10 degrees, dimmer) so the jet and the world stay readable
    const lite = !!S.chase; if (lite) { c.save(); c.globalAlpha *= 0.55; }
    for (let p = -90; p <= 90; p += 5) {
      if (Math.abs(p - pitch) > (lite ? 22 : 28) || (lite && p % 10 !== 0)) continue;
      const pr = p * D2R;
      const cen = this.proj(cam, pitchAt(pr).clone()); if (!cen) continue;
      const a = this.proj(cam, pitchAt(pr, 0.12).clone()); if (!a) continue;
      let dx = a[0] - cen[0], dy = a[1] - cen[1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const half = (p === 0 ? 230 : 95) * s, gap = (p === 0 ? 30 : 34) * s;
      if (p === 0) { this.line(cen[0] - dx * half, cen[1] - dy * half, cen[0] - dx * gap, cen[1] - dy * gap); this.line(cen[0] + dx * gap, cen[1] + dy * gap, cen[0] + dx * half, cen[1] + dy * half); continue; }
      const nx = -dy, ny = dx; const tick = (p > 0 ? 9 : -9) * s;
      const seg = (x0, y0, x1, y1) => {
        if (p > 0) this.line(x0, y0, x1, y1);
        else { const n = 4; for (let i = 0; i < n; i++) { const t0 = i / n, t1 = t0 + 0.6 / n; this.line(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0, x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1); } }
      };
      // bend negative lines toward the horizon (as on real HUDs)
      const bend = p < 0 ? Math.min(0.35, -p / 180) : 0;
      for (const sd of [-1, 1]) {
        const x0 = cen[0] + dx * gap * sd, y0 = cen[1] + dy * gap * sd;
        const x1 = cen[0] + dx * half * sd + nx * half * bend, y1 = cen[1] + dy * half * sd + ny * half * bend;
        seg(x0, y0, x1, y1);
        this.line(x0, y0, x0 + nx * tick, y0 + ny * tick);
        this.ctx.save(); this.ctx.translate(x1 + dx * 16 * s * sd, y1 + dy * 16 * s * sd); this.ctx.rotate(Math.atan2(dy, dx)); this.text(String(Math.abs(p)), 0, 0, 'center', 12); this.ctx.restore();
      }
    }
    if (lite) c.restore();
    if (fpm) {
      const [x, y] = fpm; const r = 7 * s;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
      this.line(x - r * 2.4, y, x - r, y); this.line(x + r, y, x + r * 2.4, y); this.line(x, y - r, x, y - r * 2);
      // AoA E-bracket (on-speed 8.1 deg) when gear down
      if (S.gearDown) {
        const off = (S.aoa - 8.1) * 9 * s; const bx = x - 30 * s; const by = y + off;
        this.line(bx, by - 18 * s, bx, by + 18 * s); this.line(bx, by - 18 * s, bx + 6 * s, by - 18 * s); this.line(bx, by + 18 * s, bx + 6 * s, by + 18 * s); this.line(bx, by, bx + 5 * s, by);
      }
      // IFLOLS repeater
      if (S.ball != null) {
        const bx = x + 46 * s, by = y; c.save(); c.globalAlpha = 0.9;
        this.line(bx - 18 * s, by, bx - 6 * s, by); this.line(bx + 6 * s, by, bx + 18 * s, by);
        const bb = by - S.ball * 24 * s; c.beginPath(); c.arc(bx, bb, 4.5 * s, 0, Math.PI * 2); c.fillStyle = S.ball < -0.8 ? '#ff5050' : '#ffc040'; c.fill(); c.restore();
      }
    }
    // heading tape
    const hd = S.heading; const cx = W / 2, ty = H * 0.12;
    for (let d = -25; d <= 25; d++) {
      const h = Math.round(hd) + d; const x = cx + (h - hd) * 7 * s;
      if (h % 5 !== 0) continue;
      this.line(x, ty, x, ty + (h % 10 === 0 ? 10 : 5) * s);
      if (h % 10 === 0) this.text(String(((h % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), x, ty - 10 * s, 'center', 13);
    }
    this.line(cx, ty + 14 * s, cx - 6 * s, ty + 22 * s); this.line(cx, ty + 14 * s, cx + 6 * s, ty + 22 * s);
    // airspeed & altitude boxes
    const lx = W / 2 - 210 * s, rx = W / 2 + 210 * s, my = H / 2 - 40 * s;
    c.strokeRect(lx - 40 * s, my - 14 * s, 80 * s, 28 * s); this.text(String(Math.round(S.ias)), lx, my, 'center', 18);
    this.text('M ' + S.mach.toFixed(2), lx, my + 28 * s, 'center', 13);
    this.text('G ' + S.g.toFixed(1), lx, my + 48 * s, 'center', 13);
    this.text('α ' + S.aoa.toFixed(1), lx, my - 34 * s, 'center', 13);
    c.strokeRect(rx - 48 * s, my - 14 * s, 96 * s, 28 * s); this.text(String(Math.round(S.alt / 10) * 10), rx, my, 'center', 18);
    if (S.radalt < 5000) this.text(Math.round(S.radalt) + ' R', rx, my + 28 * s, 'center', 13);
    this.text((S.vs >= 0 ? '+' : '') + Math.round(S.vs), rx, my - 34 * s, 'center', 12);
    // lower-left: weapon & engine
    const bx = W / 2 - 230 * s, by = H / 2 + 150 * s;
    this.text(S.weaponText || '', bx, by, 'left', 14);
    this.text(`THR ${Math.round(S.throttle * 100)}%${S.ab > 0.05 ? ' AB' + Math.max(1, Math.ceil(S.ab * 5)) : ''}`, bx, by + 20 * s, 'left', 13);
    this.text(`FUEL ${Math.round(S.fuel * 2.2046)}`, bx, by + 38 * s, 'left', 13);
    this.text(`MAX ${S.maxG.toFixed(1)}`, bx, by + 56 * s, 'left', 12);
    if (!S.limiter) this.text('G-LIM OFF', W / 2 + 150 * s, by + 56 * s, 'center', 14);
    const st = [];
    if (S.gearDown) st.push('GEAR'); if (S.hook) st.push('HOOK'); if (S.airbrake) st.push('SPDBRK'); if (S.brake) st.push('BRAKE');
    this.text(st.join(' '), W / 2 + 150 * s, by + 20 * s, 'center', 13);
    // target designation
    if (S.target) this.drawTarget(S, cam);
    if (S.gun) this.drawGun(S, cam);
    if (S.ccip) { const p = this.projPoint(cam, S.ccip.point); if (p && fpm) { this.line(fpm[0], fpm[1], p[0], p[1]); c.beginPath(); c.arc(p[0], p[1], 9 * s, 0, Math.PI * 2); c.stroke(); c.fillRect(p[0] - 1.5 * s, p[1] - 1.5 * s, 3 * s, 3 * s); } else if (fpm) this.text('DELAY CUE', fpm[0], fpm[1] + 60 * s); }
    if (S.ccrp) this.drawCCRP(S, cam, fpm);
    if (S.seekerDir) { const p = this.proj(cam, S.seekerDir); if (p) { c.beginPath(); c.arc(p[0], p[1], (S.seekerLock ? 10 : 16) * s, 0, Math.PI * 2); c.stroke(); if (S.seekerLock) { this.line(p[0] - 18 * s, p[1], p[0] - 10 * s, p[1]); this.line(p[0] + 10 * s, p[1], p[0] + 18 * s, p[1]); } } }
    // warnings
    const blink = (this.t * 2.5) % 1 < 0.6;
    if (S.warn && blink) { c.save(); c.fillStyle = '#ff5a4a'; this.text(S.warn, W / 2, H / 2 + 95 * s, 'center', 22); c.restore(); }
    if (S.shoot && blink) this.text('SHOOT', W / 2, H / 2 + 60 * s, 'center', 20);
  }

  drawTarget(S, cam) {
    const c = this.ctx, s = this.s, T = S.target;
    const p = this.projPoint(cam, T.pos);
    if (p) {
      const k = 12 * s; c.beginPath(); c.moveTo(p[0], p[1] - k); c.lineTo(p[0] + k, p[1]); c.lineTo(p[0], p[1] + k); c.lineTo(p[0] - k, p[1]); c.closePath(); c.stroke();
      if (T.locked) c.strokeRect(p[0] - k * 1.4, p[1] - k * 1.4, k * 2.8, k * 2.8);
      this.text(T.label, p[0], p[1] - k * 2.1, 'center', 12);
    } else {
      // target locator line from boresight
      const d = T.pos.clone().sub(cam.position).normalize();
      const pp = this.proj(cam, S.fwd); if (pp) { const ang = Math.acos(Math.max(-1, Math.min(1, d.dot(S.fwd)))) * R2D; this.text('TLL ' + ang.toFixed(0), pp[0], pp[1] + 80 * s, 'center', 13); }
    }
    const W = this.W, H = this.H;
    const rx = W / 2 + 270 * s, ry = H / 2 - 120 * s, h = 220 * s;
    // DLZ scale
    if (S.dlz) {
      const full = S.dlz.scale; const y = (r) => ry + h - Math.min(1, r / full) * h;
      this.line(rx, ry, rx, ry + h);
      this.line(rx - 8 * s, y(S.dlz.rmax), rx, y(S.dlz.rmax)); this.text('RMAX', rx + 10 * s, y(S.dlz.rmax), 'left', 10);
      c.save(); c.lineWidth = 3 * s; this.line(rx, y(S.dlz.rne), rx, y(S.dlz.rmin)); c.restore();
      this.line(rx - 8 * s, y(S.dlz.rmin), rx, y(S.dlz.rmin));
      const ty = y(T.range); this.line(rx - 14 * s, ty, rx - 4 * s, ty); this.line(rx - 14 * s, ty - 5 * s, rx - 14 * s, ty + 5 * s);
      this.text(String(Math.round(T.closure * 1.944)), rx - 18 * s, ty, 'right', 11);
    }
    this.text((T.range / 1852).toFixed(1) + ' NM', rx, ry + h + 18 * s, 'center', 13);
    if (T.alt != null) this.text('ALT ' + Math.round(T.alt * 3.281 / 100), rx, ry + h + 34 * s, 'center', 11);
  }

  drawGun(S, cam) {
    const c = this.ctx, s = this.s, G = S.gun;
    if (G.lcos) {
      const p = this.proj(cam, G.lcos.dir); if (!p) return;
      const r = 26 * s; c.beginPath(); c.arc(p[0], p[1], r, 0, Math.PI * 2); c.stroke(); c.fillRect(p[0] - 2 * s, p[1] - 2 * s, 4 * s, 4 * s);
      // range bar (arc shrinking with range, 1.2 km full)
      const f = Math.max(0, Math.min(1, 1 - G.lcos.range / 1200)); c.save(); c.lineWidth = 3 * s; c.beginPath(); c.arc(p[0], p[1], r - 5 * s, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); c.stroke(); c.restore();
    }
    if (G.funnel && G.funnel.length > 1) {
      const L = [], R = [];
      for (const f of G.funnel) { const p = this.projPoint(cam, f.p); if (!p) continue; const w = Math.max(3, Math.atan2(6, f.r) * (this.H / (cam.fov * D2R))); L.push([p[0] - w, p[1]]); R.push([p[0] + w, p[1]]); }
      if (L.length > 1) { c.beginPath(); L.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); c.beginPath(); R.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); }
    }
    this.text(`GUN ${S.rounds}`, this.W / 2 - 230 * s, this.H / 2 + 132 * s, 'left', 13);
  }

  drawCCRP(S, cam, fpm) {
    const c = this.ctx, s = this.s, R = S.ccrp;
    const tp = this.projPoint(cam, R.target);
    if (tp) { c.strokeRect(tp[0] - 8 * s, tp[1] - 8 * s, 16 * s, 16 * s); }
    if (fpm) {
      // azimuth steering line through target bearing
      const off = Math.max(-1, Math.min(1, R.azErr / 0.35)) * 120 * s;
      this.line(fpm[0] + off, fpm[1] - 150 * s, fpm[0] + off, fpm[1] + 150 * s);
      const cue = Math.max(-150, Math.min(150, (R.timeToRelease - 0) * 18)) * s;
      this.line(fpm[0] + off - 14 * s, fpm[1] - cue, fpm[0] + off + 14 * s, fpm[1] - cue);
      this.text(R.timeToRelease > 0 ? `REL ${R.timeToRelease.toFixed(1)}s` : 'RELEASE', fpm[0] + off, fpm[1] + 170 * s, 'center', 13);
    }
  }

  drawOverlay(S, cam) {
    const c = this.ctx, s = this.s, W = this.W, H = this.H;
    // mini RWR (chase view / always as overlay bottom right)
    if (S.rwr && S.showRwrOverlay) this.drawRWR(c, W - 120 * s, H - 130 * s, 95 * s, S.rwr, s);
    // engine/fuel/G strip (only while there is a jet to describe)
    if (S.ias != null) {
      c.save(); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(14 * s, H - 64 * s, 470 * s, 50 * s); c.restore();
      c.fillStyle = '#cfe9ff';
      this.text(`${S.camLabel || ''}`, 24 * s, H - 50 * s, 'left', 12);
      if (S.detect) { c.save(); c.fillStyle = S.detect === 'LOCKED' ? '#ff5b4b' : S.detect === 'SCANNED' ? '#f3a83a' : '#4fe08a'; this.text(`RADAR: ${S.detect === 'HIDDEN' ? 'NOT SEEN' : S.detect === 'SCANNED' ? 'SCANNING YOU' : 'LOCKED ON YOU'}`, 200 * s, H - 50 * s, 'left', 12); c.restore(); c.fillStyle = '#cfe9ff'; }
      this.text(`SPD ${Math.round(S.ias)} KT  ALT ${Math.round(S.alt)} FT  HDG ${String(Math.round(S.heading) % 360).padStart(3, '0')}${S.throttle != null ? `  THR ${Math.round(S.throttle * 100)}%${S.throttle > 0.81 ? ' AB' : ''}` : ''}`, 24 * s, H - 30 * s, 'left', 12);
    }
    // weapon inventory, then the wingman under it
    let invY = 24 * s;
    if (S.inventory) { c.textAlign = 'right'; for (const it of S.inventory) { c.fillStyle = it.sel ? '#ffe680' : '#cfe9ff'; this.text(`${it.sel ? '▶ ' : ''}${it.key} ${it.name} ×${it.n}`, W - 18 * s, invY, 'right', 12); invY += 17 * s; } }
    this.topRightCss = (S.wing ? this.drawWing(S.wing, W - 18 * s, invY + 10 * s) : invY) / this.dpr;
    // score
    if (S.score != null) { c.fillStyle = '#cfe9ff'; this.text(`KILLS ${S.score}`, 18 * s, 24 * s, 'left', 13); if (S.objective) this.text(S.objective, 18 * s, 44 * s, 'left', 12); }
    // TGP picture-in-picture frame
    if (S.pip) { c.strokeStyle = '#9fd'; c.lineWidth = 1.5; c.strokeRect(S.pip[0] * this.dpr, S.pip[1] * this.dpr, S.pip[2] * this.dpr, S.pip[3] * this.dpr); c.fillStyle = '#9fd'; this.text(S.pipLabel || 'TGP', (S.pip[0] + 6) * this.dpr, (S.pip[1] + 12) * this.dpr, 'left', 11); }
    if (S.catPrompt) { c.fillStyle = '#ffe680'; this.text(S.catPrompt, W / 2, H * 0.78, 'center', 16); }
    if (S.flashMsg) { c.fillStyle = '#ffffff'; this.text(S.flashMsg, W / 2, H * 0.35, 'center', 26); }
  }

  // wingman: what he's doing (right-aligned at x), and the O order menu below it; returns the bottom y
  drawWing(G, x, y) {
    const c = this.ctx, s = this.s;
    c.save(); c.shadowColor = 'rgba(0,0,0,0.85)'; c.shadowBlur = 3 * s;
    c.fillStyle = G.alive ? '#9fffc8' : '#ff9080';
    this.text(`WINGMAN: ${G.status}`, x, y, 'right', 12);
    let bottom = y + 8 * s;
    if (G.alive && !G.menu) { c.fillStyle = '#8fb3c8'; this.text('O = GIVE HIM ORDERS', x, y + 16 * s, 'right', 11); bottom = y + 23 * s; }
    if (G.menu) {
      const w = 370 * s, x0 = x - w, h = ((G.menu.length + 3) * 19 + 14) * s;
      let yy = y + 14 * s; bottom = yy + h;
      c.shadowBlur = 0; c.fillStyle = 'rgba(7,11,16,0.84)'; c.fillRect(x0, yy, w, h);
      c.strokeStyle = '#9fffc8'; c.lineWidth = 1.2 * s; c.strokeRect(x0, yy, w, h);
      yy += 17 * s;
      c.fillStyle = '#ffe680'; this.text('ORDERS FOR SPEAR 1-2 — PRESS A NUMBER', x0 + 12 * s, yy, 'left', 12); yy += 21 * s;
      for (const o of G.menu) {
        c.fillStyle = '#ffffff'; this.text(String(o.n), x0 + 16 * s, yy, 'left', 14);
        c.fillStyle = '#cfe9ff'; this.text(o.text, x0 + 38 * s, yy, 'left', 12);
        if (o.id === 'attack') { c.fillStyle = G.target ? '#ffe14d' : '#8fb3c8'; this.text(G.target ? `→ ${G.target}` : '(LOCK OR MARK WITH T)', x - 12 * s, yy, 'right', 11); }
        yy += 19 * s;
      }
      c.fillStyle = '#8fb3c8'; this.text(`HE HAS: ${G.ammo}`, x0 + 12 * s, yy, 'left', 10); yy += 18 * s;
      this.text('O = CLOSE', x0 + 12 * s, yy, 'left', 11);
    }
    c.restore();
    return bottom;
  }

  drawMessages(S) {
    const c = this.ctx, s = this.s;
    if (!S.messages) return;
    let y = this.H * 0.2;
    const inset = (S.leftInset || 0) * this.dpr; // the coach card covers the left edge
    for (const m of S.messages) {
      c.save(); c.globalAlpha = Math.min(1, m.t * 2); c.fillStyle = m.color || '#e9f7ff';
      c.font = `bold ${Math.round(15 * s)}px "Consolas","Menlo",monospace`; c.textAlign = 'center';
      const w = c.measureText(m.text).width, cx = Math.min(Math.max(this.W / 2, inset + w / 2 + 12 * s), this.W - w / 2 - 12 * s);
      c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(cx - w / 2 - 8 * s, y - 12 * s, w + 16 * s, 24 * s);
      c.fillStyle = m.color || '#e9f7ff'; c.textBaseline = 'middle'; c.fillText(m.text, cx, y); c.restore();
      y += 28 * s;
    }
  }

  drawRWR(c, cx, cy, R, list, s) {
    c.save();
    c.fillStyle = 'rgba(0,12,4,0.55)'; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(120,255,140,0.6)'; c.lineWidth = 1;
    for (const k of [1, 0.66, 0.33]) { c.beginPath(); c.arc(cx, cy, R * k, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.stroke();
    const blink = (this.t * 3) % 1 < 0.55;
    for (const e of list) {
      const rr = R * (e.lethal >= 3 ? 0.3 : e.lethal >= 2 ? 0.55 : 0.82);
      const x = cx + Math.sin(e.brg) * rr, y = cy - Math.cos(e.brg) * rr;
      c.fillStyle = e.level === 'launch' ? '#ff4040' : e.level === 'lock' ? '#ffd040' : '#80ff90';
      if (e.level === 'launch' && !blink) continue;
      c.font = `bold ${Math.round(12 * s)}px monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(e.label, x, y);
      if (e.level !== 'search') { c.strokeStyle = c.fillStyle; c.beginPath(); c.moveTo(x, y - 10 * s); c.lineTo(x + 11 * s, y); c.lineTo(x, y + 10 * s); c.lineTo(x - 11 * s, y); c.closePath(); c.stroke(); }
    }
    c.restore();
  }

  drawSeeker(S, cam) {
    const c = this.ctx, s = this.s, W = this.W, H = this.H; const K = S.seeker;
    c.save(); c.strokeStyle = 'rgba(255,255,255,0.9)'; c.fillStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 1.6 * s;
    const cx = W / 2, cy = H / 2;
    // crosshair
    const g = 60 * s; this.line(cx - 220 * s, cy, cx - g, cy); this.line(cx + g, cy, cx + 220 * s, cy); this.line(cx, cy - 160 * s, cx, cy - g); this.line(cx, cy + g, cx, cy + 160 * s);
    c.strokeRect(cx - 18 * s, cy - 18 * s, 36 * s, 36 * s);
    // gimbal limit box
    c.setLineDash([8 * s, 8 * s]); c.strokeRect(cx - W * 0.32, cy - H * 0.32, W * 0.64, H * 0.64); c.setLineDash([]);
    // target marker
    if (K.targetPos) { const p = this.projPoint(cam, K.targetPos); if (p) { const k = 14 * s; c.strokeRect(p[0] - k, p[1] - k, 2 * k, 2 * k); this.line(p[0] - k * 1.8, p[1], p[0] - k, p[1]); this.line(p[0] + k, p[1], p[0] + k * 1.8, p[1]); } }
    this.text(K.name, 30 * s, 40 * s, 'left', 18);
    this.text(K.sensor, W - 30 * s, 40 * s, 'right', 18);
    this.text(K.manual ? 'MAN' : (K.locked ? 'TRK' : 'SRCH'), W - 30 * s, 66 * s, 'right', 16);
    this.text(`TTI ${K.tti < 99 ? K.tti.toFixed(1) : '--.-'} s`, 30 * s, H - 90 * s, 'left', 18);
    this.text(`Vc ${Math.round(K.vc)} m/s`, 30 * s, H - 64 * s, 'left', 16);
    this.text(`RNG ${(K.range / 1000).toFixed(2)} km`, 30 * s, H - 40 * s, 'left', 16);
    this.text(`ALT ${Math.round(K.alt)} m`, W - 30 * s, H - 90 * s, 'right', 16);
    this.text(`SPD M${K.mach.toFixed(2)}`, W - 30 * s, H - 64 * s, 'right', 16);
    this.text(`G ${K.g.toFixed(1)}`, W - 30 * s, H - 40 * s, 'right', 16);
    // gimbal angle bars
    const gx = K.gimbalX || 0, gy = K.gimbalY || 0;
    this.line(cx - 100 * s, H - 30 * s, cx + 100 * s, H - 30 * s); c.fillRect(cx + gx * 100 * s - 3 * s, H - 38 * s, 6 * s, 16 * s);
    this.line(W - 14 * s, cy - 100 * s, W - 14 * s, cy + 100 * s); c.fillRect(W - 22 * s, cy - gy * 100 * s - 3 * s, 16 * s, 6 * s);
    if (K.lost) { c.fillStyle = '#ffffff'; this.text('SIGNAL LOST', cx, cy - 40 * s, 'center', 34); }
    this.text('MOUSE / WASD: STEER   T: LOCK UNDER CROSS   V: TV/WHOT/BHOT   F4/M: EXIT', cx, H - 12 * s, 'center', 11);
    c.restore();
  }

  drawDefender(S, cam) {
    const c = this.ctx, s = this.s, W = this.W, H = this.H; const D = S.defender;
    c.save(); c.strokeStyle = 'rgba(255,230,140,0.95)'; c.fillStyle = 'rgba(255,230,140,0.95)'; c.lineWidth = 1.6 * s;
    const cx = W / 2, cy = H / 2;
    c.beginPath(); c.arc(cx, cy, 22 * s, 0, Math.PI * 2); c.stroke(); this.line(cx - 50 * s, cy, cx - 28 * s, cy); this.line(cx + 28 * s, cy, cx + 50 * s, cy); this.line(cx, cy - 50 * s, cx, cy - 28 * s);
    for (const t of D.threats) {
      const p = this.projPoint(cam, t.pos); if (!p) continue;
      c.strokeStyle = t.missile ? '#ff6050' : '#ffd060'; c.strokeRect(p[0] - 10 * s, p[1] - 10 * s, 20 * s, 20 * s);
      if (t.lead) { const q = this.projPoint(cam, t.lead); if (q) { c.beginPath(); c.arc(q[0], q[1], 6 * s, 0, Math.PI * 2); c.stroke(); this.line(p[0], p[1], q[0], q[1]); } }
      this.text(`${t.label} ${(t.range / 1000).toFixed(1)}`, p[0], p[1] - 18 * s, 'center', 11);
    }
    c.fillStyle = 'rgba(255,230,140,0.95)';
    this.text(D.name, 30 * s, 40 * s, 'left', 18);
    this.text(`ROUNDS ${D.rounds}`, 30 * s, 64 * s, 'left', 15);
    this.text(`AZ ${Math.round(D.az)}  EL ${Math.round(D.el)}`, 30 * s, 86 * s, 'left', 13);
    this.text('MOUSE: SLEW   HOLD LMB: FIRE   F5: NEXT MOUNT   F1/F2: BACK TO JET', cx, H - 14 * s, 'center', 11);
    c.restore();
  }
}

// ---------------- MFD pages ----------------
export function drawRadarMFD(ctx, size, R) {
  const c = ctx; const s = size / 512;
  c.fillStyle = '#020a05'; c.fillRect(0, 0, size, size);
  c.strokeStyle = '#2e8f45'; c.lineWidth = 1.5 * s; c.fillStyle = '#7dff95';
  c.font = `bold ${22 * s}px monospace`; c.textAlign = 'left'; c.textBaseline = 'top';
  c.fillText(`RDR ${R.mode}`, 12 * s, 10 * s); c.textAlign = 'right'; c.fillText(`${Math.round(R.range / 1852)} NM`, size - 12 * s, 10 * s);
  const x0 = 50 * s, y0 = 50 * s, w = size - 100 * s, h = size - 120 * s;
  c.strokeRect(x0, y0, w, h);
  for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(x0, y0 + h * i / 4); c.lineTo(x0 + w, y0 + h * i / 4); c.stroke(); }
  for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(x0 + w * i / 4, y0); c.lineTo(x0 + w * i / 4, y0 + h); c.stroke(); }
  // sweep line
  const sweep = (R.t * 0.8) % 2; const sx = x0 + w * (sweep < 1 ? sweep : 2 - sweep);
  c.strokeStyle = 'rgba(120,255,150,0.35)'; c.beginPath(); c.moveTo(sx, y0); c.lineTo(sx, y0 + h); c.stroke();
  for (const ct of R.contacts) {
    const az = ct.az; const r = ct.range;
    if (r > R.range) continue;
    const x = x0 + w * (0.5 + az / (2 * 60 * D2R)); const y = y0 + h * (1 - r / R.range);
    c.fillStyle = ct.locked ? '#ffe060' : '#a0ffb0';
    if (ct.locked) { c.strokeStyle = '#ffe060'; c.strokeRect(x - 9 * s, y - 9 * s, 18 * s, 18 * s); }
    c.fillRect(x - 5 * s, y - 5 * s, 10 * s, 10 * s);
    // aspect vector
    c.strokeStyle = c.fillStyle; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.sin(ct.aspect) * 18 * s, y - Math.cos(ct.aspect) * 18 * s); c.stroke();
    c.font = `${15 * s}px monospace`; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(String(Math.round(ct.alt / 1000)), x, y + 8 * s);
  }
  c.fillStyle = '#7dff95'; c.font = `bold ${18 * s}px monospace`; c.textAlign = 'left'; c.textBaseline = 'bottom';
  c.fillText(R.lockText || 'RWS', 12 * s, size - 12 * s);
}

export function drawRWRMFD(ctx, size, list, t) {
  const c = ctx; const s = size / 512;
  c.fillStyle = '#020a05'; c.fillRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2 + 10 * s, R = size * 0.42;
  c.strokeStyle = '#2e8f45'; c.lineWidth = 2 * s;
  for (const k of [1, 0.66, 0.33]) { c.beginPath(); c.arc(cx, cy, R * k, 0, Math.PI * 2); c.stroke(); }
  for (let a = 0; a < 12; a++) { const an = a * Math.PI / 6; c.beginPath(); c.moveTo(cx + Math.sin(an) * R * 0.93, cy - Math.cos(an) * R * 0.93); c.lineTo(cx + Math.sin(an) * R, cy - Math.cos(an) * R); c.stroke(); }
  c.fillStyle = '#7dff95'; c.font = `bold ${22 * s}px monospace`; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('RWR', 12 * s, 10 * s);
  const blink = (t * 3) % 1 < 0.55;
  for (const e of list) {
    const rr = R * (e.lethal >= 3 ? 0.3 : e.lethal >= 2 ? 0.55 : 0.82);
    const x = cx + Math.sin(e.brg) * rr, y = cy - Math.cos(e.brg) * rr;
    const col = e.level === 'launch' ? '#ff4545' : e.level === 'lock' ? '#ffd045' : '#90ffa0';
    if (e.level === 'launch' && !blink) continue;
    c.fillStyle = col; c.strokeStyle = col; c.font = `bold ${26 * s}px monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(e.label, x, y);
    if (e.level !== 'search') { c.beginPath(); c.moveTo(x, y - 22 * s); c.lineTo(x + 24 * s, y); c.lineTo(x, y + 22 * s); c.lineTo(x - 24 * s, y); c.closePath(); c.stroke(); }
  }
}
