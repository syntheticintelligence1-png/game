// Procedural modeling toolkit: primitives, superellipse lofts, airfoil wing panels, merge-by-material
// with per-vertex color + 'heat' (thermal imaging) attributes.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();

export function prep(geo, color = [1, 1, 1], heat = 0) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = color[0]; c[i * 3 + 1] = color[1]; c[i * 3 + 2] = color[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const h = new Float32Array(n); h.fill(heat); g.setAttribute('heat', new THREE.BufferAttribute(h, 1));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'heat'].includes(k)) g.deleteAttribute(k);
  return g;
}

export function xform(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s); geo.applyMatrix4(_m); return geo;
}

export function merge(parts) {
  const names = ['position', 'normal', 'uv', 'color', 'heat'];
  let count = 0; for (const g of parts) count += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = parts[0].attributes[n].itemSize; const arr = new Float32Array(count * size); let o = 0;
    for (const g of parts) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

// color helper from hex (sRGB) to linear array
export function col(hex) { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }

export function box(w, h, d, x, y, z, color, heat = 0, rx = 0, ry = 0, rz = 0) {
  return xform(prep(new THREE.BoxGeometry(w, h, d), color, heat), x, y, z, rx, ry, rz);
}
export function cyl(rt, rb, h, seg, x, y, z, color, heat = 0, rx = 0, ry = 0, rz = 0, open = false) {
  return xform(prep(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), color, heat), x, y, z, rx, ry, rz);
}
// cylinder along Z axis (length l centered at z)
export function cylZ(rt, rb, l, seg, x, y, z, color, heat = 0) { return cyl(rt, rb, l, seg, x, y, z, color, heat, Math.PI / 2, 0, 0); }
export function sphere(r, ws, hs, x, y, z, color, heat = 0, sx = 1, sy = 1, sz = 1) {
  return xform(prep(new THREE.SphereGeometry(r, ws, hs), color, heat), x, y, z, 0, 0, 0, sx, sy, sz);
}
export function cone(r, h, seg, x, y, z, color, heat = 0, rx = 0, ry = 0, rz = 0) {
  return xform(prep(new THREE.ConeGeometry(r, h, seg), color, heat), x, y, z, rx, ry, rz);
}

// Superellipse loft along Z. sections: [{z, w, h, y=0, n=2, wb (bottom width factor)}]
export function loft(sections, segs = 24, color = [1, 1, 1], heat = 0, opts = {}) {
  const pos = [], uv = [], idx = [];
  const z0 = sections[0].z, z1 = sections[sections.length - 1].z;
  for (let s = 0; s < sections.length; s++) {
    const S = sections[s]; const n = S.n || 2; const e = 2 / n;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs * Math.PI * 2;
      const c = Math.cos(t), sn = Math.sin(t);
      let x = Math.sign(c) * Math.pow(Math.abs(c), e) * S.w / 2;
      let y = Math.sign(sn) * Math.pow(Math.abs(sn), e) * S.h / 2;
      if (y < 0 && S.wb != null) x *= S.wb + (1 - S.wb) * (1 + y / (S.h / 2));
      if (y > 0 && S.wt != null) x *= S.wt + (1 - S.wt) * (1 - y / (S.h / 2));
      pos.push(x + (S.x || 0), y + (S.y || 0), S.z);
      uv.push(i / segs, (S.z - z0) / (z1 - z0));
    }
  }
  const row = segs + 1;
  for (let s = 0; s < sections.length - 1; s++) for (let i = 0; i < segs; i++) {
    const a = s * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  let out = prep(g, color, heat);
  if (opts.capEnd || opts.capStart) {
    const caps = [out];
    const mk = (S, flip) => {
      const p = []; const n = S.n || 2; const e = 2 / n;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs * Math.PI * 2, t1 = (i + 1) / segs * Math.PI * 2;
        const pt = (t) => { const c = Math.cos(t), sn = Math.sin(t); let x = Math.sign(c) * Math.pow(Math.abs(c), e) * S.w / 2; const y = Math.sign(sn) * Math.pow(Math.abs(sn), e) * S.h / 2; if (y < 0 && S.wb != null) x *= S.wb + (1 - S.wb) * (1 + y / (S.h / 2)); if (y > 0 && S.wt != null) x *= S.wt + (1 - S.wt) * (1 - y / (S.h / 2)); return [x + (S.x || 0), y + (S.y || 0), S.z]; };
        const A = [S.x || 0, S.y || 0, S.z], B = pt(t0), C = pt(t1);
        if (flip) p.push(...A, ...C, ...B); else p.push(...A, ...B, ...C);
      }
      const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); cg.computeVertexNormals();
      return prep(cg, opts.capColor || color, opts.capHeat != null ? opts.capHeat : heat);
    };
    if (opts.capStart) caps.push(mk(sections[0], true));
    if (opts.capEnd) caps.push(mk(sections[sections.length - 1], false));
    out = merge(caps);
  }
  return out;
}

// NACA-like symmetric airfoil (thickness t/c) sampled chordwise
function airfoil(n, tc) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = 0.5 - 0.5 * Math.cos(Math.PI * i / n);
    const y = 5 * tc * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    pts.push([x, y]);
  }
  return pts;
}

// Tapered wing/fin panel. root/tip: {le:[x,y,z], chord, tc}; chord runs along +Z from the LE.
// 'up' is the thickness direction (default +Y); for vertical fins pass up:[1,0,0].
export function wing(root, tip, color = [1, 1, 1], heat = 0, opts = {}) {
  const n = opts.n || 10; const up = opts.up || [0, 1, 0];
  const rp = airfoil(n, root.tc || 0.05), tp = airfoil(n, tip.tc || 0.05);
  const pos = [], idx = [];
  const ring = (P, sp) => {
    const out = [];
    for (let i = 0; i <= n; i++) { const [x, y] = P[i]; out.push([sp.le[0] + up[0] * y * sp.chord, sp.le[1] + up[1] * y * sp.chord, sp.le[2] + up[2] * y * sp.chord + x * sp.chord]); }
    for (let i = n - 1; i >= 1; i--) { const [x, y] = P[i]; out.push([sp.le[0] - up[0] * y * sp.chord, sp.le[1] - up[1] * y * sp.chord, sp.le[2] - up[2] * y * sp.chord + x * sp.chord]); }
    return out;
  };
  const R = ring(rp, root), T = ring(tp, tip); const m = R.length;
  for (const p of R) pos.push(...p); for (const p of T) pos.push(...p);
  for (let i = 0; i < m; i++) { const a = i, b = (i + 1) % m, c = m + i, d = m + (i + 1) % m; idx.push(a, c, b, b, c, d); }
  // tip cap and root cap
  for (let i = 1; i < m - 1; i++) { idx.push(m, m + i + 1, m + i); idx.push(0, i, i + 1); }
  // orient so the upper surface faces +up regardless of which side the panel extends to
  const sx = tip.le[0] - root.le[0], sy = tip.le[1] - root.le[1];
  const flip = (sy * up[0] - sx * up[1]) < 0;
  if (flip) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const uv = []; for (let i = 0; i < 2 * m; i++) uv.push((i % m) / m, i < m ? 0 : 1);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const out = prep(g, color, heat);
  // flat shading for crisp edges on thin panels
  out.computeVertexNormals();
  return out;
}

// Extruded polygon (2D shape in XZ plane, extruded along Y)
export function slab(points2d, y0, h, color, heat = 0) {
  const shape = new THREE.Shape(points2d.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return prep(g, color, heat);
}

// Build meshes from a dict of part arrays keyed by material name
export function meshes(partsByMat, mats, group, opts = {}) {
  const out = {};
  for (const k of Object.keys(partsByMat)) {
    const parts = partsByMat[k]; if (!parts.length) continue;
    const m = new THREE.Mesh(merge(parts), mats[k]);
    m.castShadow = opts.cast !== false; m.receiveShadow = opts.receive !== false;
    group.add(m); out[k] = m;
  }
  return out;
}

export class Parts {
  constructor() { this.p = {}; }
  add(mat, g) { (this.p[mat] || (this.p[mat] = [])).push(g); return g; }
}

// Canvas texture helper
export function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
