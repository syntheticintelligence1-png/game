// Camera rig: F1 cockpit (head look + G inertia), F2 spring-damped chase (speed FOV, look-back),
// F3 missile fly-along, F4/M missile seeker POV, F5 defender (CIWS) POV, plus death cam.
import * as THREE from 'three';
import { JET_GEOM } from '../models/fighter.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();

export class CameraRig {
  constructor(camera) {
    this.cam = camera; this.mode = 'chase'; this.prevMode = 'chase';
    this.headYaw = 0; this.headPitch = 0; this.headOff = new THREE.Vector3(); this.headVel = new THREE.Vector3();
    this.chasePos = new THREE.Vector3(); this.chaseVel = new THREE.Vector3(); this.chaseInit = false; this.orbitYaw = 0; this.orbitPitch = 0; this.dist = 28;
    this.fovBase = { cockpit: 72, chase: 58, missile: 55, seeker: 24, defender: 50, dead: 60 };
    this.zoom = 1; this.shake = 0; this.missile = null; this.lookBack = false;
  }
  setMode(m) { if (m !== this.mode) { this.prevMode = this.mode; this.mode = m; this.chaseInit = false; this.zoom = 1; } }

  update(dt, g, input) {
    const cam = this.cam; const ac = g.player.ac; const s = ac.s;
    const mouse = input.mouse;
    let fov = this.fovBase[this.mode] || 60;
    if (mouse.wheel) this.zoom = THREE.MathUtils.clamp(this.zoom * (mouse.wheel > 0 ? 1.1 : 0.9), 0.35, 1.6);
    const shakeAmt = this.shake + g.fx.shake * 0.6 + (g.catStroke ? 0.5 : 0) + (g.player.firingGun ? 0.12 : 0) + ac.buffet * 0.25;
    if (this.mode === 'cockpit') {
      // head look (mouse when pointer locked or RMB drag), slow recentre otherwise
      if (input.locked || mouse.buttons & 2) { this.headYaw -= mouse.dx * 0.0025; this.headPitch -= mouse.dy * 0.0025; }
      else if (!input.down('KeyL')) { this.headYaw *= 1 - Math.min(1, dt * 1.5); this.headPitch *= 1 - Math.min(1, dt * 1.5); }
      if (input.down('KeyL')) { this.headYaw += (2.6 - this.headYaw) * Math.min(1, dt * 6); }
      this.headYaw = THREE.MathUtils.clamp(this.headYaw, -2.7, 2.7); this.headPitch = THREE.MathUtils.clamp(this.headPitch, -1.1, 1.4);
      // G-force head inertia: head pushed down under +G, sideways under lateral accel
      const tgt = _v.set(-ac.ny * 0.018, -(ac.nz - 1) * 0.012, 0);
      tgt.y = THREE.MathUtils.clamp(tgt.y, -0.09, 0.05); tgt.x = THREE.MathUtils.clamp(tgt.x, -0.05, 0.05);
      this.headVel.addScaledVector(_v2.copy(tgt).sub(this.headOff), dt * 60).multiplyScalar(Math.exp(-dt * 10));
      this.headOff.addScaledVector(this.headVel, dt);
      const eye = _v.copy(JET_GEOM.eye).add(this.headOff).applyQuaternion(s.q).add(s.p);
      cam.position.copy(eye);
      _e.set(this.headPitch, this.headYaw, 0, 'YXZ'); _q.setFromEuler(_e);
      cam.quaternion.copy(s.q).multiply(_q);
      fov *= this.zoom;
    } else if (this.mode === 'chase' || this.mode === 'dead') {
      if (mouse.buttons & 2 || input.locked) { this.orbitYaw -= mouse.dx * 0.004; this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch - mouse.dy * 0.003, -1.2, 1.2); }
      else { this.orbitYaw *= 1 - Math.min(1, dt * 0.8); this.orbitPitch *= 1 - Math.min(1, dt * 0.8); }
      const look = input.down('KeyL');
      const target = this.mode === 'dead' && g.player.wreckPos ? g.player.wreckPos : s.p;
      // desired offset in a frame that follows heading and pitch but only partially roll. In flight the frame follows
      // the flight path rather than the nose: on approach or in a hard turn the nose points well above where the jet
      // is going, and the camera sits high enough to see that point over the jet (the deck, a target).
      const fwd = _v.set(0, 0, -1).applyQuaternion(s.q);
      const spd = s.v.length(), kv = this.mode === 'dead' || ac.onGround ? 0 : THREE.MathUtils.clamp((spd - 30) / 40, 0, 1) * 0.9;
      if (kv > 0) fwd.lerp(_v3.copy(s.v).multiplyScalar(1 / Math.max(spd, 1)), kv).normalize();
      this.chaseDir = (this.chaseDir || fwd.clone()).lerp(fwd, Math.min(1, dt * 6)).normalize();
      const dir = this.chaseDir;
      const yaw = Math.atan2(dir.x, -dir.z), pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      _e.set(pitch * 0.85 + this.orbitPitch - 0.12, -yaw + this.orbitYaw + (look ? Math.PI : 0), 0, 'YXZ'); _q.setFromEuler(_e);
      const d = this.dist * this.zoom * (this.mode === 'dead' ? 2.5 : 1);
      const off = _v2.set(0, this.mode === 'dead' ? 3.2 : 4.2, d).applyQuaternion(_q);
      const desired = off.add(target);
      if (!this.chaseInit) { this.chasePos.copy(desired); this.chaseVel.set(0, 0, 0); this.chaseInit = true; }
      // spring-damper relative to the moving target (critically damped)
      const k = 38, c = 2 * Math.sqrt(k);
      const vT = this.mode === 'dead' ? _v.set(0, 0, 0) : s.v;
      const rel = this.chasePos.clone().sub(desired); const relV = this.chaseVel.clone().sub(vT);
      const acc = rel.multiplyScalar(-k).addScaledVector(relV, -c);
      this.chaseVel.addScaledVector(acc, dt); this.chasePos.addScaledVector(this.chaseVel, dt);
      cam.position.copy(this.chasePos);
      const ahead = look ? _v.copy(target).addScaledVector(_v2.set(0, 0, -1).applyQuaternion(s.q), -40) : _v.copy(target).addScaledVector(this.chaseDir, this.mode === 'dead' ? 30 : 90).add(_v2.set(0, this.mode === 'dead' ? 0 : 1.5, 0));
      cam.up.set(0, 1, 0);
      cam.lookAt(ahead);
      // partial roll follow
      const rollF = this.mode === 'dead' ? 0 : 0.25;
      cam.rotateZ(-ac.rollDeg() * Math.PI / 180 * rollF);
      fov = fov + Math.min(14, spd / 25);
    } else if (this.mode === 'missile' && this.missile && !this.missile.dead) {
      const m = this.missile;
      const off = _v.set(0.9, 0.7, 7 + m.def.d * 10).applyQuaternion(m.quat).add(m.pos);
      cam.position.lerp(off, Math.min(1, dt * 25));
      if (cam.position.distanceTo(off) > 60) cam.position.copy(off);
      const ahead = _v2.copy(m.vel).normalize().multiplyScalar(60).add(m.pos);
      cam.up.set(0, 1, 0); cam.lookAt(ahead);
      fov *= this.zoom;
    } else if (this.mode === 'seeker' && this.missile) {
      const m = this.missile;
      const nose = _v.set(0, 0, -(m.model.length / 2 + 0.25)).applyQuaternion(m.quat).add(m.pos);
      cam.position.copy(nose);
      const dir = m.manual || !m.seekerDir ? _v2.copy(m.vel).normalize() : _v2.copy(m.seekerDir);
      if (!m.manual && m.track && m.track.pos) dir.copy(m.track.pos).sub(m.pos).normalize();
      _q.copy(cam.quaternion);
      cam.up.set(0, 1, 0); cam.lookAt(_v.copy(cam.position).add(dir));
      cam.quaternion.slerpQuaternions(_q, cam.quaternion.clone(), Math.min(1, dt * 12));
      fov = (m.def.seeker === 'tv' ? 18 : 24) * this.zoom;
    } else if (this.mode === 'attract') {
      // cinematic shots behind the menu: carrier orbit, jet on the catapult, wide island shot
      this.attractT = (this.attractT || 0) + dt;
      const shot = Math.floor(this.attractT / 14) % 3; const t = this.attractT % 14;
      const c = g.carrier;
      if (shot === 0) {
        const a = this.attractT * 0.045 + 2.2, r = 560;
        cam.position.set(c.pos.x + Math.cos(a) * r, 46 + 18 * Math.sin(this.attractT * 0.08), c.pos.z + Math.sin(a) * r);
        cam.up.set(0, 1, 0); cam.lookAt(c.pos.x, 24, c.pos.z); fov = 42;
      } else if (shot === 1) {
        const p = _v.set(-9 + t * 0.35, 2.5 + t * 0.12, 26 - t * 0.2).applyQuaternion(s.q).add(s.p);
        cam.position.copy(p); cam.up.set(0, 1, 0); cam.lookAt(_v2.set(0, 0.5, -4).applyQuaternion(s.q).add(s.p)); fov = 40;
      } else {
        const a = 0.6 + t * 0.012;
        cam.position.set(c.pos.x - 2600 + Math.cos(a) * 900, 900 + t * 6, c.pos.z - 4200 + Math.sin(a) * 900);
        cam.up.set(0, 1, 0); cam.lookAt(0, 600, 0); fov = 50;
      }
    } else if (this.mode === 'defender' && g.defender) {
      const D = g.defender; cam.position.copy(D.eyePos); cam.quaternion.copy(D.camQuat); fov = 50 * this.zoom;
    }
    // shake
    if (shakeAmt > 0.001) {
      const a = shakeAmt * 0.012; cam.rotateX((Math.random() - 0.5) * a); cam.rotateY((Math.random() - 0.5) * a); cam.rotateZ((Math.random() - 0.5) * a * 0.5);
    }
    this.shake *= Math.exp(-dt * 4);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 6); cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }
}
