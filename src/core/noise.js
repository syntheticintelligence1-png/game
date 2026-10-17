// Seeded simplex noise (2D/3D) + fractal helpers for CPU-side world generation.
// Based on Stefan Gustavson's public-domain simplex noise formulation.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3, G3 = 1 / 6;
const GRAD3 = new Float32Array([1,1,0, -1,1,0, 1,-1,0, -1,-1,0, 1,0,1, -1,0,1, 1,0,-1, -1,0,-1, 0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1]);

export class Simplex {
  constructor(seed = 1337) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512); this.perm12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { this.perm[i] = p[i & 255]; this.perm12[i] = this.perm[i] % 12; }
  }
  noise2(xin, yin) {
    const perm = this.perm, p12 = this.perm12;
    const s = (xin + yin) * F2; const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2; const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1; if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0, t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = p12[ii + perm[jj]] * 3; t0 *= t0; n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = p12[ii + i1 + perm[jj + j1]] * 3; t1 *= t1; n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = p12[ii + 1 + perm[jj + 1]] * 3; t2 *= t2; n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2); }
    return 70 * n; // ~[-1,1]
  }
  noise3(xin, yin, zin) {
    const perm = this.perm, p12 = this.perm12;
    const s = (xin + yin + zin) * F3; const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3; const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) { const g = p12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) { const g = p12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1; n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) { const g = p12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2; n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) { const g = p12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3; n += t3 * t3 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3); }
    return 32 * n;
  }
  fbm2(x, y, oct = 5, lac = 2.0, gain = 0.5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) { s += a * this.noise2(x * f, y * f); n += a; a *= gain; f *= lac; }
    return s / n;
  }
  ridged2(x, y, oct = 5, lac = 2.0, gain = 0.5) {
    // sharp ridges with octave weighting (Musgrave)
    let a = 1, f = 1, s = 0, n = 0, w = 1;
    for (let o = 0; o < oct; o++) {
      let v = 1 - Math.abs(this.noise2(x * f, y * f)); v *= v; v *= w; w = Math.min(1, Math.max(0, v * 2));
      s += v * a; n += a; a *= gain; f *= lac;
    }
    return s / n;
  }
}

// Tileable 3D noise volume (Perlin-Worley style) for raymarched clouds. Returns Uint8Array RGBA size^3.
export function makeCloudNoise3D(size = 64, seed = 7) {
  const rnd = mulberry32(seed);
  const out = new Uint8Array(size * size * size * 4);
  // Worley feature points per cell for several frequencies (tileable)
  function makeWorley(cells) {
    const pts = new Float32Array(cells * cells * cells * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = rnd();
    return { cells, pts };
  }
  function worley(W, x, y, z) { // x,y,z in [0,1)
    const c = W.cells; const fx = x * c, fy = y * c, fz = z * c;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    let md = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      const wx = ((cx % c) + c) % c, wy = ((cy % c) + c) % c, wz = ((cz % c) + c) % c;
      const k = ((wz * c + wy) * c + wx) * 3;
      const px = cx + W.pts[k], py = cy + W.pts[k + 1], pz = cz + W.pts[k + 2];
      const d = (px - fx) * (px - fx) + (py - fy) * (py - fy) + (pz - fz) * (pz - fz);
      if (d < md) md = d;
    }
    return Math.sqrt(md);
  }
  // tileable value-ish noise via periodic gradient lattice
  function makePeriodic(period) {
    const g = new Float32Array(period * period * period * 3);
    for (let i = 0; i < g.length / 3; i++) {
      let x = rnd() * 2 - 1, y = rnd() * 2 - 1, z = rnd() * 2 - 1; const l = Math.hypot(x, y, z) || 1;
      g[i * 3] = x / l; g[i * 3 + 1] = y / l; g[i * 3 + 2] = z / l;
    }
    return { period, g };
  }
  function grad(P, ix, iy, iz, dx, dy, dz) {
    const p = P.period; const k = ((((iz % p) + p) % p * p + (((iy % p) + p) % p)) * p + (((ix % p) + p) % p)) * 3;
    return P.g[k] * dx + P.g[k + 1] * dy + P.g[k + 2] * dz;
  }
  function perlin(P, x, y, z) {
    const fx = x * P.period, fy = y * P.period, fz = z * P.period;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const u = tx * tx * tx * (tx * (tx * 6 - 15) + 10), v = ty * ty * ty * (ty * (ty * 6 - 15) + 10), w = tz * tz * tz * (tz * (tz * 6 - 15) + 10);
    const l = (a, b, t) => a + (b - a) * t;
    const x00 = l(grad(P, ix, iy, iz, tx, ty, tz), grad(P, ix + 1, iy, iz, tx - 1, ty, tz), u);
    const x10 = l(grad(P, ix, iy + 1, iz, tx, ty - 1, tz), grad(P, ix + 1, iy + 1, iz, tx - 1, ty - 1, tz), u);
    const x01 = l(grad(P, ix, iy, iz + 1, tx, ty, tz - 1), grad(P, ix + 1, iy, iz + 1, tx - 1, ty, tz - 1), u);
    const x11 = l(grad(P, ix, iy + 1, iz + 1, tx, ty - 1, tz - 1), grad(P, ix + 1, iy + 1, iz + 1, tx - 1, ty - 1, tz - 1), u);
    return l(l(x00, x10, v), l(x01, x11, v), w);
  }
  const P1 = makePeriodic(4), P2 = makePeriodic(8), P3 = makePeriodic(16);
  const W1 = makeWorley(4), W2 = makeWorley(8), W3 = makeWorley(16), W4 = makeWorley(32);
  let o = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, w = z / size;
    const per = 0.5 + 0.5 * (perlin(P1, u, v, w) * 0.6 + perlin(P2, u, v, w) * 0.3 + perlin(P3, u, v, w) * 0.15);
    const w1 = 1 - Math.min(1, worley(W1, u, v, w) * 1.2);
    const w2 = 1 - Math.min(1, worley(W2, u, v, w) * 1.2);
    const w3 = 1 - Math.min(1, worley(W3, u, v, w) * 1.2);
    const w4 = 1 - Math.min(1, worley(W4, u, v, w) * 1.2);
    const wfbm = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
    // Perlin-Worley: remap perlin by worley fbm
    const pw = Math.min(1, Math.max(0, (per - (1 - wfbm)) / (1 - (1 - wfbm) + 1e-4)));
    out[o++] = Math.round(Math.min(1, Math.max(0, pw)) * 255);
    out[o++] = Math.round(w2 * 255);
    out[o++] = Math.round(w3 * 255);
    out[o++] = Math.round(w4 * 255);
  }
  return out;
}
