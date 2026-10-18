// Drones and UAVs (procedural): a MALE recon UAV, a delta-wing one-way attack drone, an MQ-9 Reaper.
// Faces -Z, Y up, origin near the centre of gravity. Each returns { root, mats, prop, info } where prop is the
// propeller group to spin (blades plus a faint blur disc that reads as a spinning prop at a distance).
import * as THREE from 'three';
import { Parts, meshes, loft, wing, box, cyl, cylZ, sphere, slab, xform, merge, col } from './kit.js';

const C = {
  grey: col('#a3a8ad'), light: col('#c4c8cb'), mid: col('#7e8388'), dark: col('#36393c'), black: col('#141516'),
  glass: col('#1b2730'), sand: col('#a49a86'), prop: col('#1d1e1f'), red: col('#8e2a22'),
};

function mats(rough = 0.55) {
  return {
    paint: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: rough, metalness: 0.2 }),
    dark: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide }),
  };
}

// pusher propeller at the tail: n blades of radius r around the Z axis
function pusher(root, m, z, r, n = 2, y = 0) {
  const g = new THREE.Group(); g.position.set(0, y, z); root.add(g);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(xform(box(r * 0.16, r, 0.05, 0, r / 2, 0, C.prop), 0, 0, 0, 0, 0, i * Math.PI * 2 / n));
  parts.push(sphere(r * 0.12, 8, 6, 0, 0, 0.04, C.dark, 0.4, 1, 1, 1.6));
  const blades = new THREE.Mesh(merge(parts), m.dark); blades.castShadow = true; g.add(blades);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 28), new THREE.MeshBasicMaterial({ color: 0x2a2b2c, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }));
  g.add(disc);
  return { group: g, blades, disc };
}

// mirror helper: the same panel on both sides
function both(fn) { return [fn(1), fn(-1)]; }

// Medium-altitude long-endurance recon UAV: slim body, 16 m straight wing, V-tail, pusher prop, sensor ball
export function buildReconUAV() {
  const M = mats(); const root = new THREE.Group(); root.name = 'recon-uav';
  const P = new Parts(); const c = C.grey;
  P.add('paint', loft([
    { z: -4.0, w: 0.06, h: 0.06, y: 0.06 }, { z: -3.7, w: 0.5, h: 0.55, y: 0.05 }, { z: -3.0, w: 0.8, h: 0.85, y: 0.08 },
    { z: -1.5, w: 0.9, h: 0.95, y: 0.1, n: 2.3 }, { z: 1.0, w: 0.85, h: 0.85, y: 0.08, n: 2.3 }, { z: 2.8, w: 0.55, h: 0.6, y: 0.1 },
    { z: 3.8, w: 0.34, h: 0.34, y: 0.12 }, { z: 4.0, w: 0.28, h: 0.28, y: 0.12 },
  ], 18, c, 0.1));
  // EO/IR turret under the nose
  P.add('dark', cyl(0.12, 0.12, 0.25, 8, 0, -0.42, -2.6, C.dark));
  P.add('dark', sphere(0.28, 12, 8, 0, -0.62, -2.6, C.glass, 0.2));
  // wing with a little dihedral, red tip markings
  both(s => P.add('paint', wing({ le: [s * 0.4, 0.35, -0.9], chord: 1.1, tc: 0.12 }, { le: [s * 8.0, 0.6, -0.6], chord: 0.55, tc: 0.1 }, c, 0, { n: 8 })));
  both(s => P.add('paint', box(0.5, 0.09, 0.55, s * 7.8, 0.6, -0.33, C.red)));
  // V-tail
  both(s => P.add('paint', wing({ le: [s * 0.15, 0.2, 2.5], chord: 1.1, tc: 0.08 }, { le: [s * 1.5, 1.35, 3.2], chord: 0.55, tc: 0.07 }, c, 0, { up: [-s * 0.65, 0.76, 0], n: 6 })));
  // engine exhaust stub (the only warm part)
  P.add('dark', cylZ(0.12, 0.14, 0.4, 8, 0, 0.36, 3.55, C.dark, 0.7));
  meshes(P.p, M, root);
  const prop = pusher(root, M, 4.12, 1.0, 3, 0.12);
  return {
    root, mats: M, prop,
    info: {
      length: 8, span: 16, radius: 8,
      wingtipL: new THREE.Vector3(-8, 0.6, -0.3), wingtipR: new THREE.Vector3(8, 0.6, -0.3),
      hitSpheres: [{ c: new THREE.Vector3(0, 0, -2.2), r: 1.2 }, { c: new THREE.Vector3(0, 0, 1.2), r: 1.2 }, { c: new THREE.Vector3(-4.5, 0.45, -0.5), r: 1.5 }, { c: new THREE.Vector3(4.5, 0.45, -0.5), r: 1.5 }],
    },
  };
}

// One-way attack drone: 3.5 m cropped-delta flying wing with tip fins and a pusher prop (Shahed-style)
export function buildAttackDrone() {
  const M = mats(0.65); const root = new THREE.Group(); root.name = 'attack-drone';
  const P = new Parts(); const c = C.mid;
  P.add('paint', loft([
    { z: -1.75, w: 0.06, h: 0.06 }, { z: -1.6, w: 0.3, h: 0.3 }, { z: -1.2, w: 0.46, h: 0.46 },
    { z: 1.2, w: 0.42, h: 0.42 }, { z: 1.6, w: 0.3, h: 0.3 }, { z: 1.75, w: 0.2, h: 0.2 },
  ], 14, c, 0.05));
  // warhead nose band
  P.add('dark', cylZ(0.235, 0.235, 0.12, 12, 0, 0, -1.15, C.dark));
  P.add('paint', slab([[0.18, -0.9], [1.25, 1.15], [1.25, 1.6], [-1.25, 1.6], [-1.25, 1.15], [-0.18, -0.9]], -0.03, 0.06, c));
  // tip fins, up and down
  both(s => P.add('paint', wing({ le: [s * 1.25, 0, 1.0], chord: 0.6, tc: 0.06 }, { le: [s * 1.25, 0.42, 1.25], chord: 0.35, tc: 0.06 }, c, 0, { up: [1, 0, 0], n: 5 })));
  both(s => P.add('paint', wing({ le: [s * 1.25, 0, 1.0], chord: 0.6, tc: 0.06 }, { le: [s * 1.25, -0.3, 1.2], chord: 0.4, tc: 0.06 }, c, 0, { up: [1, 0, 0], n: 5 })));
  P.add('dark', cylZ(0.14, 0.16, 0.3, 10, 0, 0, 1.62, C.dark, 0.6));
  meshes(P.p, M, root);
  const prop = pusher(root, M, 1.84, 0.38, 2);
  return {
    root, mats: M, prop,
    info: {
      length: 3.5, span: 2.5, radius: 2.2,
      wingtipL: new THREE.Vector3(-1.25, 0, 1.3), wingtipR: new THREE.Vector3(1.25, 0, 1.3),
      hitSpheres: [{ c: new THREE.Vector3(0, 0, -0.7), r: 0.7 }, { c: new THREE.Vector3(0, 0, 0.9), r: 0.9 }, { c: new THREE.Vector3(-0.85, 0, 1.25), r: 0.6 }, { c: new THREE.Vector3(0.85, 0, 1.25), r: 0.6 }],
    },
  };
}

// MQ-9 Reaper: bulbous satcom nose, 20 m wing, Y-tail (V-tail up plus a ventral fin), sensor ball, Hellfires
export function buildReaper() {
  const M = mats(0.5); const root = new THREE.Group(); root.name = 'reaper';
  const P = new Parts(); const c = C.light;
  P.add('paint', loft([
    { z: -5.5, w: 0.1, h: 0.1, y: 0.1 }, { z: -5.2, w: 0.7, h: 0.8, y: 0.15 }, { z: -4.4, w: 1.0, h: 1.25, y: 0.32, n: 2.2 },
    { z: -3.2, w: 1.05, h: 1.3, y: 0.3, n: 2.3 }, { z: -1.5, w: 1.0, h: 1.05, y: 0.15, n: 2.4 }, { z: 1.0, w: 0.95, h: 0.95, y: 0.1, n: 2.4 },
    { z: 3.4, w: 0.6, h: 0.65, y: 0.15 }, { z: 5.0, w: 0.38, h: 0.42, y: 0.2 }, { z: 5.4, w: 0.3, h: 0.3, y: 0.2 },
  ], 20, c, 0.1));
  P.add('dark', box(0.36, 0.16, 0.9, 0, 0.62, 0.6, C.dark));
  P.add('dark', cyl(0.13, 0.13, 0.22, 8, 0, -0.45, -4.1, C.dark));
  P.add('dark', sphere(0.34, 14, 10, 0, -0.68, -4.1, C.glass, 0.2));
  both(s => P.add('paint', wing({ le: [s * 0.45, 0.25, -1.0], chord: 1.35, tc: 0.12 }, { le: [s * 10.0, 0.5, -0.35], chord: 0.55, tc: 0.1 }, c, 0, { n: 8 })));
  both(s => P.add('paint', wing({ le: [s * 0.15, 0.25, 3.5], chord: 1.3, tc: 0.08 }, { le: [s * 1.7, 1.7, 4.4], chord: 0.6, tc: 0.07 }, c, 0, { up: [-s * 0.68, 0.73, 0], n: 6 })));
  P.add('paint', wing({ le: [0, -0.3, 3.9], chord: 1.1, tc: 0.07 }, { le: [0, -1.35, 4.6], chord: 0.5, tc: 0.07 }, c, 0, { up: [1, 0, 0], n: 6 }));
  // two Hellfires on rails under the wings
  for (const s of [-1, 1]) {
    P.add('dark', box(0.12, 0.22, 0.9, s * 3.2, 0.12, -0.45, C.dark));
    P.add('dark', cylZ(0.09, 0.09, 1.6, 8, s * 3.2, -0.08, -0.55, C.mid));
  }
  P.add('dark', cylZ(0.16, 0.2, 0.45, 10, 0, 0.3, 5.15, C.dark, 0.6));
  meshes(P.p, M, root);
  const prop = pusher(root, M, 5.62, 1.4, 3, 0.2);
  return {
    root, mats: M, prop,
    info: {
      length: 11, span: 20, radius: 10,
      wingtipL: new THREE.Vector3(-10, 0.5, -0.1), wingtipR: new THREE.Vector3(10, 0.5, -0.1),
      hitSpheres: [{ c: new THREE.Vector3(0, 0.1, -3.2), r: 1.4 }, { c: new THREE.Vector3(0, 0, 1.0), r: 1.4 }, { c: new THREE.Vector3(-5.5, 0.35, -0.6), r: 1.6 }, { c: new THREE.Vector3(5.5, 0.35, -0.6), r: 1.6 }],
    },
  };
}
