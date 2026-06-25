// Hastings Jr. (1955) approximation for the standard normal
// complementary probability Q(z) = 1 - Φ(z), max error 7.5×10⁻⁸.
// Matches itmlogic Python v1.2+ implementation exactly.

const B1 = 0.319381530
const B2 = -0.356563782
const B3 = 1.781477937
const B4 = -1.821255987
const B5 = 1.330274429
const RP = 4.317008
const RRT2PI = 0.398942280  // 1 / sqrt(2 * π)

export function qerf(z: number): number {
  const t = Math.abs(z)
  if (t >= 10) return 0
  // t = 1 / (1 + P * |z|) where P = 0.2316419, equivalent to RP / (|z| + RP)
  const tt = RP / (t + RP)
  const phi = Math.exp(-0.5 * z * z) * RRT2PI
  // Horner form: ((((B5*t + B4)*t + B3)*t + B2)*t + B1)*t
  const q = phi * ((((B5 * tt + B4) * tt + B3) * tt + B2) * tt + B1) * tt
  return z >= 0 ? q : 1 - q
}

// --- qerfi: Inverse of qerf ------------------------------------------------
// Hastings Jr. approximation, max error 4.5×10⁻⁴.
// Returns z such that qerf(z) = p.
// Matches itmlogic Python v1.2+ implementation exactly.

const C0 = 2.515516698
const C1 = 0.802853
const C2 = 0.010328
const D1 = 1.432788
const D2 = 0.189269
const D3 = 0.001308

export function qerfi(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return -Infinity
  if (p >= 1) return Infinity

  // Center probability around zero and clamp to avoid log(0)
  const x = 0.5 - p
  const tVal = Math.max(0.5 - Math.abs(x), 0.000001)
  const interim = Math.sqrt(-2 * Math.log(tVal))

  // Horner form for the rational approximation
  const z = interim - ((C2 * interim + C1) * interim + C0)
    / (((D3 * interim + D2) * interim + D1) * interim + 1)

  return x < 0 ? -z : z
}

// --- qtile: Order statistic (descending sort) ------------------------------
// Returns the ir-th largest element of array a (0-indexed).
// Used by dlthx to compute the interdecile range of terrain elevations.

export function qtile(a: number[], ir: number): number {
  const sorted = [...a].sort((a, b) => b - a)
  const v = sorted[ir]
  return v === undefined ? NaN : v
}

// --- curv: Empirical curve fit for time variability ------------------------
// Evaluates the empirical curve used in computing Vmd, σ_T⁻, and σ_T⁺
// as a function of climate region (equations 5.5-5.7 of ITS ITM v1.2.2).

export function curv(
  c1: number, c2: number,
  x1: number, x2: number, x3: number,
  de: number,
): number {
  const r1 = de / x1
  const r2 = (de - x2) / x3
  return (c1 + c2 / (1 + r2 * r2)) * (r1 * r1) / (1 + r1 * r1)
}
