// Keyboard / mouse input with smoothed analog axes. Browser shortcuts on F-keys / Ctrl combos are suppressed.
export class Input {
  constructor(el) {
    this.el = el; this.keys = new Set(); this.pressed = new Set(); this.mouse = { dx: 0, dy: 0, x: 0, y: 0, buttons: 0, wheel: 0 };
    this.locked = false; this.axes = { pitch: 0, roll: 0, yaw: 0 }; this.enabled = true;
    const block = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (block.has(e.code) || e.ctrlKey && /^Key[A-Z]$/.test(e.code) && e.code !== 'KeyR') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    }, { capture: true });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); if (block.has(e.code)) e.preventDefault(); }, { capture: true });
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousedown', (e) => { this.mouse.buttons |= 1 << e.button; if (e.button === 0 && !this.locked && this.wantLock) { try { const p = el.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* pointer lock refused by the frame */ } } });
    addEventListener('mouseup', (e) => { this.mouse.buttons &= ~(1 << e.button); });
    addEventListener('mousemove', (e) => { if (this.locked || this.mouse.buttons & 4 || this.mouse.buttons & 2) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    el.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
  }
  down(c) { return this.keys.has(c); }
  hit(c) { return this.pressed.has(c); }
  endFrame() { this.pressed.clear(); this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; }
  // keyboard axes ramp toward targets for smooth control
  updateAxes(dt) {
    const k = (a, b) => (this.down(a) || (b && this.down(b)) ? 1 : 0);
    const tp = k('KeyS', 'ArrowDown') - k('KeyW', 'ArrowUp');
    const tr = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
    const ty = k('KeyE') - k('KeyQ');
    const ramp = (cur, tgt, up, dn) => { const r = tgt === 0 ? dn : (Math.sign(tgt) !== Math.sign(cur) && cur !== 0 ? dn : up); const d = tgt - cur; return cur + Math.sign(d) * Math.min(Math.abs(d), r * dt); };
    this.axes.pitch = ramp(this.axes.pitch, tp, 2.8, 5.0);
    this.axes.roll = ramp(this.axes.roll, tr, 4.5, 7.0);
    this.axes.yaw = ramp(this.axes.yaw, ty, 2.5, 5.0);
  }
}
