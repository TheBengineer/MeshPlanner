/**
 * Port of the itmlogic preparatory subroutines from Python to TypeScript.
 *
 * These routines handle:
 *   - hzns():   Find horizon distances and angles from both ends of a path
 *   - dlthx():  Compute the delta-h terrain-irregularity parameter
 *   - zlsq1():  Linear least-squares fit for effective antenna heights
 *
 * All internal calculations use Float64Array for consistency with the
 * existing codebase (see TerrainProfile in src/lib/types.ts).
 *
 * Reference: "The ITS Irregular Terrain Model, version 1.2.2: The Algorithm"
 * (Hufford, 1999) — Section 48 and equations 3.1–3.4.
 */

import type { HorizonResult, Zlsq1Result } from "./types"

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Avoid division by zero: returns n/d when d ≠ 0, otherwise 0.
 *
 * Matches the Python itmlogic misc/avoid_zero_division convention.
 */
function avoidZeroDivision(n: number, d: number): number {
  return d !== 0 ? n / d : 0
}

/**
 * Internal qtile – returns the `ir`-th order statistic from the *top* of the
 * distribution (i.e. sorted descending).  This matches the Python itmlogic
 * misc/qtile.py behaviour:
 *
 *     sorted(a, reverse=True)[ir]
 *
 * @param a   Input data (Float64Array).
 * @param ir  Desired rank (0 = largest).
 * @returns   The ir-th largest value.
 */
function qtile(a: Float64Array, ir: number): number {
  // TypedArray.sort() sorts in ascending numeric order.  To get the
  // (ir)-th largest we read from the end.
  const sorted = new Float64Array(a)
  sorted.sort()
  return sorted[sorted.length - 1 - ir]!
}

// ---------------------------------------------------------------------------
// zlsq1 — linear least-squares fit
// ---------------------------------------------------------------------------

/**
 * Linear least-squares fit over a terrain profile between x1 and x2.
 *
 * Evaluates a least-squares line through the terrain elevations stored in the
 * itmlogic-format profile `z` (index 0 = number of intervals, index 1 =
 * spacing, index 2… = elevation values) between horizontal positions x1 and
 * x2.  Returns the interpolated height at position 0 and at the far end of
 * the profile.
 *
 * Ported from itmlogic.preparatory_subroutines.zlsq1.
 *
 * @param z   Terrain profile in pfl format (Float64Array).
 *            Layout: [np, xi, elev0, elev1, …, elevN]
 * @param x1  Start position along the profile (metres).
 * @param x2  End position along the profile (metres).
 * @returns   [z0, zn] — interpolated heights at positions 0 and N.
 */
export function zlsq1(z: Float64Array, x1: number, x2: number): Zlsq1Result {
  const xn = z[0]!
  const spacing = z[1]!

  let xa = Math.trunc(Math.max(x1 / spacing, 0))
  let xb = xn - Math.trunc(Math.max(xn - x2 / spacing, 0))

  // Ensure at least one interval.
  if (xb <= xa) {
    xa = Math.max(xa - 1, 0)
    xb = xn - Math.max(xn - xb + 1, 0)
  }

  let ja = xa
  const jb = xb
  const n = jb - ja
  xa = xb - xa // n (re-purposed as interval count)
  let x = -0.5 * xa
  xb = xb + x // shifted midpoint

  // Initialise the sums using the first and last points.
  let a = 0.5 * (z[ja + 2]! + z[jb + 2]!)
  let b = 0.5 * (z[ja + 2]! - z[jb + 2]!) * x

  // Accumulate the remaining interior points.
  for (let i = 2; i <= n; i++) {
    ja = ja + 1
    x = x + 1
    a = a + z[ja + 2]!
    b = b + z[ja + 2]! * x
  }

  a = avoidZeroDivision(a, xa)
  b = (b * 12) / ((xa * xa + 2) * xa)

  const z0 = a - b * xb
  const zn = a + b * (xn - xb)

  return [z0, zn]
}

// ---------------------------------------------------------------------------
// hzns — find horizon parameters
// ---------------------------------------------------------------------------

/**
 * Find horizon distances and take-off angles from both ends of the path.
 *
 * Scans the terrain profile from the transmitter end toward the receiver,
 * identifying the first obstruction (horizon) for each end.  The algorithm
 * follows Section 48 of the Hufford reference.
 *
 * Ported from itmlogic.preparatory_subroutines.hzns.
 *
 * @param pfl  Terrain profile in pfl format (Float64Array).
 * @param dist Total path distance in metres.
 * @param hg   Antenna heights [tx, rx] in metres above ground.
 * @param gme  Effective earth curvature.
 * @returns    HorizonResult with take-off angles `the` and distances `dl`.
 */
export function hzns(
  pfl: Float64Array,
  dist: number,
  hg: [number, number],
  gme: number,
): HorizonResult {
  // Edge case: zero or negative distance → no horizon.
  if (dist <= 0) {
    return { the: [0, 0], dl: [0, 0] }
  }

  const np = pfl[0]!
  const xi = pfl[1]!
  const za = pfl[2]! + hg[0]
  const zb = pfl[np + 2]! + hg[1]
  const qc = 0.5 * gme

  let q = qc * dist

  // Initialise take-off angles from the straight line between the two ends,
  // adjusted for earth curvature.
  const the: [number, number] = [0, 0]
  const dl: [number, number] = [dist, dist]

  // In the Python code: the[1] = (zb - za) / dist
  //                     the[0] = the[1] - q
  //                     the[1] = -the[1] - q
  // which simplifies to:
  the[0] = (zb - za) / dist - q
  the[1] = (za - zb) / dist - q

  if (np < 2) {
    // Too few intervals to search for horizon obstructions.
    return { the, dl }
  }

  let sa = 0
  let sb = dist
  let wq = 1 // 1 = tx horizon not yet found

  for (let i = 2; i <= np; i++) {
    sa = sa + xi
    sb = sb - xi

    // Check horizon from the transmitter end.
    q = pfl[i + 1]! - (qc * sa + the[0]) * sa - za
    if (q > 0) {
      the[0] = the[0] + q / sa
      dl[0] = sa
      wq = 0
    }

    // Once the tx horizon is found, also check from the receiver end.
    if (wq === 0) {
      q = pfl[i + 1]! - (qc * sb + the[1]) * sb - zb
      if (q > 0) {
        the[1] = the[1] + q / sb
        dl[1] = sb
      }
    }
  }

  return { the, dl }
}

// ---------------------------------------------------------------------------
// dlthx — delta-h terrain irregularity
// ---------------------------------------------------------------------------

/**
 * Compute the delta-h terrain irregularity parameter (inter-decile range of
 * elevations) for a segment of the terrain profile between x1 and x2.
 *
 * The algorithm resamples the profile, removes the linear trend (via zlsq1),
 * then takes the difference between the ka-th and kb-th order statistics of
 * the detrended elevations.  A small distance correction is applied.
 *
 * Ported from itmlogic.preparatory_subroutines.dlthx.
 *
 * @param pfl1  Terrain profile in pfl format (Float64Array).
 * @param x1    Start distance along the profile (metres).
 * @param x2    End distance along the profile (metres).
 * @returns     The delta-h value (inter-decile range, metres).
 */
export function dlthx(pfl1: Float64Array, x1: number, x2: number): number {
  const np = pfl1[0]!
  const spacing = pfl1[1]!
  const xa = x1 / spacing
  const xb = x2 / spacing

  let dlthx1 = 0

  // Require at least two intervals of separation.
  if (xb - xa >= 2) {
    let ka = Math.trunc(0.1 * (xb - xa + 8))
    ka = Math.min(Math.max(ka, 4), 25)
    const n = 10 * ka - 5
    const kb = n - ka + 1
    const sn = n - 1

    // Build the resampled s-array in pfl format: [sn, 1, elev0, …, elevN].
    const s = new Float64Array(n + 2)
    s[0] = sn
    s[1] = 1

    const sx = (xb - xa) / sn
    let k = Math.trunc(xa + 1)
    let ss = xa - k

    for (let j = 1; j <= n; j++) {
      // Step through the original profile as needed.
      while (ss > 0 && k < np) {
        ss = ss - 1
        k = k + 1
      }

      // Interpolate — guard against indexing past the end of the profile
      // (matching the Python itmlogic boundary check).
      let elev: number
      const idx = k + 2
      if (idx < pfl1.length) {
        elev = pfl1[idx]! + (pfl1[idx]! - pfl1[idx - 1]!) * ss
      } else {
        const last = pfl1.length - 1
        elev = pfl1[last]! + (pfl1[last]! - pfl1[last - 1]!) * ss
      }
      s[j + 1] = elev

      ss = ss + sx
    }

    // Remove the linear trend via least-squares fit.
    let [fit0, fitN] = zlsq1(s, 0, sn)

    const slope = (fitN - fit0) / sn
    for (let j = 0; j < n; j++) {
      s[j + 2] = s[j + 2]! - fit0
      fit0 = fit0 + slope
    }

    // Inter-decile range of the detrended elevations.
    const upper = qtile(s.subarray(2), ka - 1)
    const lower = qtile(s.subarray(2), kb - 1)
    dlthx1 = upper - lower

    // Distance correction factor.
    dlthx1 = dlthx1 / (1 - 0.8 * Math.exp(-(x2 - x1) / 50e3))
  }

  return dlthx1
}
