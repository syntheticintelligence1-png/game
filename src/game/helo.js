// Navy helicopters around the carrier group (scenery, not targets). Each flies a steady circle around a point that
// moves with its ship (at = [metres to starboard, metres ahead of the ship]), banking into the turn, rotors turning.
import * as THREE from 'three';
import { buildHelo } from '../models/units.js';
import { attachLights, LIGHT } from '../fx/navlights.js';

const LIGHTS = [
  { p: [-1.3, 2.6, -1], c: 'red' }, { p: [1.3, 2.6, -1], c: 'green' }, { p: [0, 3.1, 10.6], c: 'white' },
  { p: [0, 4.0, 1.6], c: 'beacon', pattern: LIGHT.BEACON, size: 0.45 }, { p: [0, 0.95, -1.5], c: 'beacon', pattern: LIGHT.BEACON, size: 0.45 },
];

export class Helo {
  // o: { ship, at, r (orbit radius m), alt (m), speed (m/s), dir (+1 clockwise seen from above), phase }
  constructor(game, o) {
    this.o = o; this.model = buildHelo(); this.root = this.model.root; game.scene.add(this.root);
    attachLights(this.root, LIGHTS);
    this.root.rotation.order = 'YXZ'; this.phase = o.phase || 0; this.pos = this.root.position; this.vel = new THREE.Vector3();
  }
  update(dt, time) {
    const o = this.o, s = o.ship, f = s.fwd, w = o.dir * o.speed / o.r;
    this.phase += w * dt;
    const c = Math.cos(this.phase), sn = Math.sin(this.phase);
    this.pos.set(s.pos.x - f.z * o.at[0] + f.x * o.at[1] + o.r * c, o.alt + Math.sin(time * 0.4 + o.r) * 1.5, s.pos.z + f.x * o.at[0] + f.z * o.at[1] + o.r * sn);
    this.vel.set(-sn, 0, c).multiplyScalar(o.r * w).add(s.vel);
    this.root.rotation.set(-0.07, Math.atan2(-this.vel.x, -this.vel.z), -Math.atan(o.speed * w / 9.81));
    this.model.nodes.rotor.rotation.y += dt * 27; this.model.nodes.tail.rotation.x += dt * 120;
  }
}
