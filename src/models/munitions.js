// Missiles & bombs: lathe bodies + airfoil fins, faces -Z, origin at the CG. Control fins are pivots.
import * as THREE from 'three';
import { Parts, meshes, loft, wing, box, cyl, cylZ, sphere, cone, prep, merge, col, xform } from './kit.js';

const M = {
  white: col('#e7e7e2'), grey: col('#a9adb0'), dgrey: col('#6d7175'), olive: col('#4f5640'), oliveD: col('#3f4533'),
  dark: col('#1c1d1f'), yellow: col('#d1a72a'), brown: col('#6b5236'), glass: col('#1a2a33'), blue: col('#3a5d9c'), red: col('#9a2b25'),
};

// spec: L length, D diameter, nose length, nose shape, body color, band colors, wings, tail fins, canards
export const MUNITIONS = {
  aim9x: { L: 3.02, D: 0.127, nose: 0.22, noseCol: M.glass, body: M.white, bands: [[0.35, M.yellow], [0.42, M.brown]], tail: { root: 0.36, tip: 0.18, span: 0.2, at: 1.25 }, canard: { root: 0.12, tip: 0.07, span: 0.07, at: -1.2 } },
  aim120: { L: 3.66, D: 0.178, nose: 0.55, noseCol: M.grey, body: M.white, bands: [[-0.6, M.yellow], [-0.52, M.brown]], wings: { root: 0.42, tip: 0.18, span: 0.2, at: -0.2 }, tail: { root: 0.36, tip: 0.2, span: 0.24, at: 1.5 } },
  agm65: { L: 2.49, D: 0.305, nose: 0.2, noseCol: M.glass, dome: true, body: M.olive, bands: [[-0.7, M.yellow]], wings: { root: 1.2, tip: 0.5, span: 0.36, at: 0.25 }, tail: { root: 0.2, tip: 0.14, span: 0.16, at: 1.12 } },
  agm84: { L: 3.85, D: 0.343, nose: 0.5, noseCol: M.dgrey, body: M.grey, bands: [[-0.9, M.yellow]], wings: { root: 0.7, tip: 0.3, span: 0.38, at: 0.1 }, tail: { root: 0.36, tip: 0.2, span: 0.3, at: 1.68 } },
  agm88: { L: 4.17, D: 0.254, nose: 0.6, noseCol: M.dgrey, body: M.white, bands: [[-1.0, M.yellow]], wings: { root: 0.95, tip: 0.18, span: 0.3, at: -0.6 }, tail: { root: 0.3, tip: 0.2, span: 0.25, at: 1.85 } },
  gbu12: { L: 3.27, D: 0.273, nose: 0.55, noseCol: M.oliveD, bomb: true, body: M.olive, bands: [[-0.75, M.yellow]], canard: { root: 0.25, tip: 0.14, span: 0.16, at: -1.0 }, tail: { root: 0.55, tip: 0.35, span: 0.42, at: 1.3 } },
  gbu39: { L: 1.8, D: 0.19, nose: 0.36, noseCol: M.dgrey, bomb: true, body: M.grey, bands: [[-0.5, M.yellow]], wings: { root: 0.26, tip: 0.16, span: 0.72, at: -0.05 }, tail: { root: 0.17, tip: 0.11, span: 0.13, at: 0.78 } },
  gbu31: { L: 3.88, D: 0.37, nose: 0.75, noseCol: M.dgrey, bomb: true, body: M.oliveD, bands: [[-1.0, M.yellow], [0.15, M.yellow]], wings: { root: 1.1, tip: 1.0, span: 0.07, at: -0.25 }, tail: { root: 0.5, tip: 0.36, span: 0.34, at: 1.55 } },
  mk84: { L: 3.28, D: 0.457, nose: 0.9, noseCol: M.olive, bomb: true, body: M.olive, bands: [[-0.6, M.yellow], [0.3, M.yellow]], tail: { root: 0.6, tip: 0.45, span: 0.3, at: 1.25, conical: true } },
  cbu: { L: 2.34, D: 0.4, nose: 0.4, noseCol: M.olive, bomb: true, body: M.olive, bands: [[-0.3, M.yellow]], tail: { root: 0.4, tip: 0.35, span: 0.25, at: 0.95 } },
  r77: { L: 3.6, D: 0.2, nose: 0.55, noseCol: M.grey, body: M.grey, bands: [[-0.5, M.red]], wings: { root: 0.28, tip: 0.2, span: 0.14, at: -0.3 }, grid: true, tail: { root: 0.12, tip: 0.12, span: 0.28, at: 1.7 } },
  r73: { L: 2.9, D: 0.17, nose: 0.25, noseCol: M.glass, body: M.grey, bands: [[-0.3, M.red]], canard: { root: 0.2, tip: 0.1, span: 0.12, at: -1.0 }, tail: { root: 0.35, tip: 0.2, span: 0.22, at: 1.2 } },
  sam_big: { L: 7.5, D: 0.52, nose: 1.3, noseCol: M.white, body: M.white, bands: [[-2.0, M.dgrey]], tail: { root: 0.7, tip: 0.35, span: 0.5, at: 3.2 } },
  sam_small: { L: 2.9, D: 0.235, nose: 0.4, noseCol: M.white, body: M.white, bands: [[-0.8, M.dgrey]], canard: { root: 0.25, tip: 0.12, span: 0.18, at: -0.9 }, tail: { root: 0.3, tip: 0.2, span: 0.25, at: 1.2 } },
  igla: { L: 1.57, D: 0.072, nose: 0.12, noseCol: M.glass, body: M.oliveD, bands: [], canard: { root: 0.08, tip: 0.05, span: 0.05, at: -0.6 }, tail: { root: 0.1, tip: 0.07, span: 0.08, at: 0.68 } },
  cruise: { L: 6.2, D: 0.53, nose: 0.9, noseCol: M.dgrey, body: M.dgrey, bands: [[-1.8, M.red]], wings: { root: 0.5, tip: 0.35, span: 1.3, at: -0.2, flat: true }, tail: { root: 0.45, tip: 0.3, span: 0.5, at: 2.7 } },
  sm2: { L: 4.72, D: 0.34, nose: 0.75, noseCol: M.white, body: M.white, bands: [[-1.2, M.blue]], wings: { root: 1.2, tip: 0.2, span: 0.2, at: -0.2 }, tail: { root: 0.4, tip: 0.25, span: 0.32, at: 2.05 } },
};

const _cache = new Map();
const _matCache = new Map();
function mats() {
  if (!_matCache.has('m')) _matCache.set('m', {
    body: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.45, metalness: 0.2 }),
    dark: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 0.5, side: THREE.DoubleSide }),
  });
  return _matCache.get('m');
}

function bodyGeo(kind) {
  const S = MUNITIONS[kind]; const P = new Parts(); const L = S.L, R = S.D / 2;
  const z0 = -L / 2, z1 = L / 2;
  const sec = [];
  const nn = 7;
  for (let i = 0; i <= nn; i++) {
    const t = i / nn; const z = z0 + S.nose * t;
    let r = S.dome ? R * Math.sqrt(Math.min(1, t * 1.3 + 0.05)) : R * Math.pow(Math.sin(t * Math.PI / 2), S.bomb ? 0.75 : 0.85);
    if (i === 0) r = S.dome ? R * 0.35 : 0.004;
    sec.push({ z, w: 2 * r, h: 2 * r });
  }
  P.add('body', loft(sec, 14, S.noseCol));
  const tailStart = S.bomb ? z1 - S.L * 0.3 : z1 - 0.12;
  P.add('body', loft([{ z: z0 + S.nose, w: 2 * R, h: 2 * R }, { z: tailStart, w: 2 * R, h: 2 * R }, { z: z1, w: 2 * R * (S.bomb ? 0.55 : 0.82), h: 2 * R * (S.bomb ? 0.55 : 0.82) }], 14, S.body, 0, { capEnd: true, capColor: M.dark, capHeat: 1 }));
  for (const [bz, bc] of S.bands) P.add('body', cylZ(R * 1.01, R * 1.01, 0.05, 14, 0, 0, bz, bc));
  const finSet = (F, fixed, tag) => {
    const parts = [];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      const rootR = R * 0.95;
      const g = wing({ le: [rootR, 0, F.at - F.root / 2], chord: F.root, tc: 0.04 }, { le: [rootR + F.span, 0, F.at - F.root / 2 + (F.root - F.tip)], chord: F.tip, tc: 0.03 }, S.body, 0, { n: 4 });
      xform(g, 0, 0, 0, 0, 0, a);
      parts.push(g);
    }
    return parts;
  };
  if (S.wings) for (const g of finSet(S.wings)) P.add('body', g);
  if (S.canard) for (const g of finSet(S.canard)) P.add('body', g);
  if (S.grid) {
    // grid fins (lattice boxes) for R-77
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2; const g = box(0.26, 0.02, 0.12, R + 0.15, 0, S.tail.at, M.dgrey);
      xform(g, 0, 0, 0, 0, 0, a); P.add('dark', g);
    }
  }
  return { body: P, finSet };
}

export function buildMunition(kind) {
  const S = MUNITIONS[kind]; const m = mats();
  if (!_cache.has(kind)) {
    const { body, finSet } = bodyGeo(kind);
    const geoBody = merge(body.p.body);
    const geoDark = body.p.dark ? merge(body.p.dark) : null;
    // single control-fin geometry (one panel, rotated per instance)
    const F = S.tail; const R = S.D / 2;
    const fg = merge([wing({ le: [0, 0, -F.root * 0.3], chord: F.root, tc: 0.04 }, { le: [F.span, 0, -F.root * 0.3 + (F.root - F.tip)], chord: F.tip, tc: 0.03 }, S.body, 0, { n: 4 })]);
    _cache.set(kind, { geoBody, geoDark, fg, R });
    void finSet;
  }
  const c = _cache.get(kind);
  const root = new THREE.Group(); root.name = kind;
  const b = new THREE.Mesh(c.geoBody, m.body); b.castShadow = true; root.add(b);
  if (c.geoDark) root.add(new THREE.Mesh(c.geoDark, m.dark));
  const fins = [];
  if (!S.grid) {
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      const roll = new THREE.Group(); roll.rotation.z = a; root.add(roll);
      const pivot = new THREE.Group(); pivot.position.set(c.R * 0.95, 0, S.tail.at - S.tail.root * 0.2); roll.add(pivot);
      const fm = new THREE.Mesh(c.fg, m.body); fm.castShadow = true; pivot.add(fm);
      fins.push(pivot);
    }
  }
  return { root, fins, nozzle: new THREE.Vector3(0, 0, S.L / 2), length: S.L, radius: S.D / 2 };
}

// Animate the 4 control fins from a commanded lateral acceleration (missile body frame, x right / y up)
export function setFins(fins, ax, ay, roll = 0) {
  if (!fins || fins.length < 4) return;
  const k = 0.012;
  const c = Math.SQRT1_2;
  // fin k is at angle 45 + 90k deg; deflection mixes pitch (ay) and yaw (ax) commands
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const d = (-ay * Math.cos(a) + ax * Math.sin(a)) * k * c + roll * 0.2;
    fins[i].rotation.x = THREE.MathUtils.clamp(d, -0.35, 0.35);
  }
}
