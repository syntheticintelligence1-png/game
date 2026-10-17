// International Standard Atmosphere (troposphere + lower stratosphere)
export const G0 = 9.80665;
export function isa(h) {
  h = Math.max(-500, Math.min(25000, h));
  let T, p;
  if (h < 11000) { T = 288.15 - 0.0065 * h; p = 101325 * Math.pow(T / 288.15, 5.25588); }
  else { T = 216.65; p = 22632.1 * Math.exp(-0.000157688 * (h - 11000)); }
  return { T, p, rho: p / (287.05 * T), a: Math.sqrt(1.4 * 287.05 * T) };
}
export function rhoAt(h) {
  h = Math.max(-500, Math.min(25000, h));
  if (h < 11000) { const T = 288.15 - 0.0065 * h; return 1.225 * Math.pow(T / 288.15, 4.25588); }
  return 0.36392 * Math.exp(-0.000157688 * (h - 11000));
}
export function soundAt(h) { h = Math.max(-500, Math.min(25000, h)); const T = h < 11000 ? 288.15 - 0.0065 * h : 216.65; return Math.sqrt(401.87 * T); }
export const KTS = 1.943844; // m/s -> knots
export const FT = 3.28084;   // m -> ft
