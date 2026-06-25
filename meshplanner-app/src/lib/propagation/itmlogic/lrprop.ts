/**
 * lrprop — Core Longley-Rice propagation model (LOS, diffraction, troposcatter).
 *
 * This is the central subroutine of the ITM (Irregular Terrain Model) point-to-point
 * propagation engine.  It computes the **reference attenuation** (aref) for a given
 * distance, selecting among three propagation regimes:
 *
 *   1. **LOS** (line-of-sight)        — two-ray ground reflection + smooth earth diffraction
 *   2. **Diffraction** (knife-edge + rounded obstacle)
 *   3. **Troposcatter**                — beyond-horizon scatter
 *
 * Ported from the Python `itmlogic` package (v1.2) which implements "The ITS Irregular
 * Terrain Model, version 1.2.2: The Algorithm" (Hufford, 1999).
 *
 * All internal calculations use Float64Array where applicable.  The prop object follows
 * the same field conventions as the Python itmlogic prop dictionary.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Complex number helpers (used for ground impedance and reflection coefficient)
// ---------------------------------------------------------------------------

export interface Complex {
  re: number
  im: number
}

/** Create a complex number. */
function cx(re: number, im: number = 0): Complex {
  return { re, im }
}

/** Magnitude of a complex number. */
function cAbs(z: Complex): number {
  return Math.sqrt(z.re * z.re + z.im * z.im)
}

/** Magnitude squared of a complex number. */
function cAbs2(z: Complex): number {
  return z.re * z.re + z.im * z.im
}

/** Complex square root (principal branch). */
function cSqrt(z: Complex): Complex {
  const mag = cAbs(z)
  const re = Math.sqrt((mag + z.re) / 2)
  const im = Math.sign(z.im) * Math.sqrt((mag - z.re) / 2)
  return { re, im }
}

/** Complex addition: a + b */
function cAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im }
}

/** Complex subtraction: a - b */
function cSub(a: Complex, b: Complex): Complex {
  return { re: a.re - b.re, im: a.im - b.im }
}

/** Multiply a complex number by a real scalar. */
function cMulReal(z: Complex, s: number): Complex {
  return { re: z.re * s, im: z.im * s }
}

/** Complex division: a / b */
function cDiv(a: Complex, b: Complex): Complex {
  const denom = b.re * b.re + b.im * b.im
  return {
    re: (a.re * b.re + a.im * b.im) / denom,
    im: (a.im * b.re - a.re * b.im) / denom,
  }
}

// ---------------------------------------------------------------------------
// ItmProp — full dictionary of propagation parameters
// ---------------------------------------------------------------------------

/**
 * Full set of propagation parameters used by lrprop and its sub-functions.
 *
 * Fields are named to match the Python itmlogic prop dict conventions for
 * traceability.  Every field that lrprop reads or writes is included.
 */
export interface ItmProp {
  // ── Inputs (set by _build_prop / qlrpfl) ──────────────────────────────
  /** Terrain profile in pfl format: [np, xi, elev0, …, elevN] */
  pfl: Float64Array
  /** Antenna heights above ground [tx, rx] in metres. */
  hg: [number, number]
  /** Effective antenna heights [tx, rx] in metres (after terrain fit). */
  he: [number, number]
  /** Centre frequency in MHz. */
  fmhz: number
  /** Wavenumber = fmhz / 47.7 (radians per metre). */
  wn: number
  /** Surface refractivity (N-units). */
  ens: number
  /** Effective earth curvature (accounts for atmospheric refraction). */
  gme: number
  /** Complex ground impedance. */
  zgnd: Complex
  /** Polarization: 0 = horizontal, 1 = vertical. */
  ipol: number

  // ── Horizon / terrain geometry (set by hzns / dlthx / qlrpfl) ────────
  /** Horizon take-off angles [tx, rx] in radians. */
  the: [number, number]
  /** Horizon distances [tx, rx] in metres. */
  dl: [number, number]
  /** Delta-h terrain irregularity parameter (metres). */
  dh: number
  /** Total path distance in metres. */
  dist: number

  // ── Mode / variability flags ──────────────────────────────────────────
  /** Mode flag: -1 = point-to-point, 1 = area init, 0 = area continue. */
  mdp: number
  /** Variability level (0-5). */
  lvar: number
  /** Variability mode override from input (≥0 overrides mdvar). */
  mdvarx: number
  /** Variability mode. */
  mdvar: number
  /** Climate override from input (>0 overrides klim). */
  klimx: number
  /** Climate code (1-7). */
  klim: number
  /** Warning/error flag (0 = OK, 1 = warning, 3 = caution, 4 = error). */
  kwx: number

  // ── Internal state (set by lrprop) ───────────────────────────────────
  /** Smooth-earth horizon distances [tx, rx] in metres. */
  dls: [number, number]
  /** Sum of smooth-earth horizon distances (dls[0] + dls[1]). */
  dlsa: number
  /** Sum of actual horizon distances (dl[0] + dl[1]). */
  dla: number
  /** Max of (the[0] + the[1]) and -dla * gme. */
  tha: number
  /** LOS branch flag (0 = not computed, 1 = computed). */
  wlos: number
  /** Scatter branch flag (0 = not computed, 1 = computed). */
  wscat: number
  /** Minimum allowed distance (metres). */
  dmin: number
  /** Diffraction scale distance (metres). */
  xae: number
  /** Diffraction slope (dB/metre). */
  emd: number
  /** Diffraction intercept (dB). */
  aed: number
  /** LOS/scatter interpolation weight. */
  wis: number
  /** Troposcatter attenuation accumulator. */
  ascat1: number

  // ── LOS coefficients (set by lrprop LOS branch) ──────────────────────
  ak1: number
  ak2: number
  /** LOS intercept (dB). */
  ael: number

  // ── Scatter coefficients (set by lrprop scatter branch) ──────────────
  /** Difference of horizon distances: dl[0] - dl[1]. */
  ad: number
  /** Ratio of effective heights: he[1] / he[0] (possibly inverted). */
  rr: number
  /** Scatter constant from refractivity. */
  etq: number
  /** Saved scatter height gain. */
  h0s: number
  /** Scatter slope (dB/metre). */
  ems: number
  /** LOS/scatter transition distance (metres). */
  dx: number
  /** Scatter intercept (dB). */
  aes: number

  // ── Diffraction state (set by adiff) ─────────────────────────────────
  qk: number
  wd1: number
  xd1: number
  afo: number
  aht: number
  xht: number

  // ── Variability state (set by avar — from avar.py / §V) ─────────────
  /** Climate variability coefficient 1. */
  cv1?: number
  /** Climate variability coefficient 2. */
  cv2?: number
  /** Climate variability distance 1 (metres). */
  yv1?: number
  /** Climate variability distance 2 (metres). */
  yv2?: number
  /** Climate variability distance 3 (metres). */
  yv3?: number
  /** Sigma-minus coefficient 1. */
  csm1?: number
  /** Sigma-minus coefficient 2. */
  csm2?: number
  /** Sigma-minus distance 1 (metres). */
  ysm1?: number
  /** Sigma-minus distance 2 (metres). */
  ysm2?: number
  /** Sigma-minus distance 3 (metres). */
  ysm3?: number
  /** Sigma-plus coefficient 1. */
  csp1?: number
  /** Sigma-plus coefficient 2. */
  csp2?: number
  /** Sigma-plus distance 1 (metres). */
  ysp1?: number
  /** Sigma-plus distance 2 (metres). */
  ysp2?: number
  /** Sigma-plus distance 3 (metres). */
  ysp3?: number
  /** Sigma-delta coefficient. */
  csd1?: number
  /** Z-d coefficient. */
  zd?: number
  /** Frequency-gain minus coefficient 1. */
  cfm1?: number
  /** Frequency-gain minus coefficient 2. */
  cfm2?: number
  /** Frequency-gain minus coefficient 3. */
  cfm3?: number
  /** Frequency-gain plus coefficient 1. */
  cfp1?: number
  /** Frequency-gain plus coefficient 2. */
  cfp2?: number
  /** Frequency-gain plus coefficient 3. */
  cfp3?: number
  /** Decoded variability mode (0-3). */
  kdv?: number
  /** Weather/siting variability flag. */
  ws?: boolean
  /** Location variability flag. */
  wl?: boolean
  /** Frequency gain factor (minus). */
  gm?: number
  /** Frequency gain factor (plus). */
  gp?: number
  /** Distance-scaling parameter (metres). */
  dexa?: number
  /** Median time variability (dB). */
  vmd?: number
  /** Sigma time minus (dB). */
  sgtm?: number
  /** Sigma time plus (dB). */
  sgtp?: number
  /** Sigma time delta (dB). */
  sgtd?: number
  /** Time guard / transition. */
  tgtd?: number
  /** Sigma location (dB). */
  sgl?: number
  /** Variability sigma-zero. */
  vs0?: number

  // ── Output ────────────────────────────────────────────────────────────
  /** Reference attenuation (dB) — the primary output of lrprop. */
  aref: number
}

// ---------------------------------------------------------------------------
// aknfe — Fresnel integral (knife-edge diffraction)
// ---------------------------------------------------------------------------

/**
 * Single knife-edge diffraction attenuation — the Fresnel integral evaluated
 * in decibels (Eqn 4.21 / 6.1 of the Hufford reference).
 *
 * @param v2  Input v² = (π/2) * ν² where ν is the Fresnel–Kirchhoff parameter.
 * @returns   Attenuation in dB.
 */
export function aknfe(v2: number): number {
  if (v2 < 5.76) {
    // Avoid log(0) or log(negative) per Python itmlogic guard
    const v2s = v2 <= 0 ? 0.00001 : v2
    return 6.02 + 9.11 * Math.sqrt(v2s) - 1.27 * v2s
  }
  return 12.953 + 4.343 * Math.log(v2)
}

// ---------------------------------------------------------------------------
// ahd — F₀(D) function for troposcatter
// ---------------------------------------------------------------------------

/**
 * The F₀(D) function (Eqn 6.9) used in troposcatter attenuation computation.
 *
 * @param td  Distance in metres.
 * @returns   The F₀(D) value in dB.
 */
export function ahd(td: number): number {
  const a = [133.4, 104.6, 71.8]
  const b = [0.332e-3, 0.212e-3, 0.157e-3]
  const c = [-4.343, -1.086, 2.171]

  let i: number
  if (td <= 10e3) {
    i = 0
  } else if (td <= 70e3) {
    i = 1
  } else {
    i = 2
  }

  return a[i]! + b[i]! * td + c[i]! * Math.log(td)
}

// ---------------------------------------------------------------------------
// h0f — H01 frequency gain function for troposcatter
// ---------------------------------------------------------------------------

/**
 * The H01 frequency-gain function (Eqn 6.13) used in troposcatter
 * attenuation.
 *
 * @param r   Input r parameter.
 * @param et  Scattering efficiency coefficient.
 * @returns   Frequency gain value in dB.
 */
export function h0f(r: number, et: number): number {
  const a = [25, 80, 177, 395, 705]
  const b = [24, 45, 68, 80, 105]

  const it = Math.floor(et)
  let q: number

  let it0: number
  if (it <= 0) {
    it0 = 1
    q = 0
  } else if (it >= 5) {
    it0 = 5
    q = 0
  } else {
    it0 = it
    q = et - it0
  }

  const x = 1 / (r * r)
  const idx0 = it0 - 1
  let h0f1 = 4.343 * Math.log((a[idx0]! * x + b[idx0]!) * x + 1)

  if (q !== 0) {
    h0f1 = (1 - q) * h0f1 + q * 4.343 * Math.log((a[it0]! * x + b[it0]!) * x + 1)
  }

  return h0f1
}

// ---------------------------------------------------------------------------
// fht — Height gain for the three-radii diffraction method
// ---------------------------------------------------------------------------

/**
 * Height gain function for the "three radii" method used in diffraction
 * attenuation (Eqns 4.20, 6.2–6.7).
 *
 * @param x   The "x" parameter.
 * @param pk  The "K" parameter (ground impedance factor).
 * @returns   Estimated diffractive attenuation contribution (dB).
 */
export function fht(x: number, pk: number): number {
  if (x < 200) {
    const w = -Math.log(pk)

    if (pk < 1e-5 || x * w * w * w > 5495) {
      let fht1 = -117
      if (x > 1) {
        fht1 = 17.372 * Math.log(x) + fht1
      }
      return fht1
    }

    return 2.5e-5 * (x * x) / pk - 8.686 * w - 15
  }

  let fht1 = 0.05751 * x - 4.343 * Math.log(x)

  if (x < 2000) {
    const w = 0.0134 * x * Math.exp(-0.005 * x)
    fht1 = (1 - w) * fht1 + w * (17.372 * Math.log(x) - 117)
  }

  return fht1
}

// ---------------------------------------------------------------------------
// alos — LOS (line-of-sight) attenuation
// ---------------------------------------------------------------------------

/**
 * Line-of-sight attenuation at distance `d` using a combination of plane-
 * earth fields and directed fields (Eqn 4.44).  A call with d=0 is not
 * meaningful — alos does not perform initialisation (that is done by adiff
 * with d=0).
 *
 * @param d     Distance in metres.
 * @param prop  Propagation parameter object (mutated only by adiff/ascat,
 *              NOT by alos).
 * @returns     The estimated LOS attenuation in dB.
 */
export function alos(d: number, prop: ItmProp): number {
  const dh = prop.dh
  const wn = prop.wn
  const he0 = prop.he[0]
  const he1 = prop.he[1]

  // Terrain roughness factor
  let q = (1 - 0.8 * Math.exp(-d / 50e3)) * dh
  const s = 0.78 * q * Math.exp(-Math.pow(q / 16, 0.25))

  // Sine of the path angle
  q = he0 + he1
  const sps = q / Math.sqrt(d * d + q * q)

  // Reflection coefficient (complex)
  const zgnd = prop.zgnd
  const num = cx(sps - zgnd.re, -zgnd.im)
  const den = cx(sps + zgnd.re, zgnd.im)
  let r = cMulReal(cDiv(num, den), Math.exp(-Math.min(10, wn * s * sps)))

  // Magnitude correction for small reflection
  q = cAbs2(r)
  if (q < 0.25 || q < sps) {
    r = cMulReal(r, Math.sqrt(sps / q))
  }

  // Interpolate between free-space and plane-earth
  let alos1 = prop.emd * d + prop.aed

  q = wn * he0 * he1 * 2 / d
  if (q > 1.57) {
    q = 3.14 - 2.4649 / q
  }

  // Direct ray (e^{-jq}) + reflected ray (r)
  const direct = cx(Math.cos(q), -Math.sin(q))
  const sum = cAdd(direct, r)
  const mag2 = cAbs2(sum)

  alos1 = (-4.343 * Math.log(mag2) - alos1) * prop.wis + alos1

  return alos1
}

// ---------------------------------------------------------------------------
// adiff — Diffraction attenuation (knife-edge + rounded obstacle)
// ---------------------------------------------------------------------------

/**
 * Diffraction attenuation at distance `d` using a convex combination of
 * smooth-earth diffraction and double knife-edge diffraction (Eqn 4.11).
 *
 * A call with **d = 0** initialises internal constants (qk, wd1, xd1, afo,
 * aht, xht) stored in *prop* and returns 0.  Subsequent calls with d > 0
 * use those pre-computed coefficients.
 *
 * @param d     Distance in metres (0 = initialisation).
 * @param prop  Propagation parameter object (read/write).
 * @returns     Estimated diffraction attenuation in dB.
 */
export function adiff(d: number, prop: ItmProp): number {
  const third = 1 / 3

  if (d === 0) {
    // ── Initialisation ──────────────────────────────────────────────
    let q = prop.hg[0] * prop.hg[1]

    prop.qk = prop.he[0] * prop.he[1] - q

    if (prop.mdp < 0) {
      q = q + 10
    }

    prop.wd1 = Math.sqrt(1 + prop.qk / q)
    prop.xd1 = prop.dla + prop.tha / prop.gme

    q = (1 - 0.8 * Math.exp(-prop.dlsa / 50e3)) * prop.dh
    q = 0.78 * q * Math.exp(-Math.pow(q / 16, 0.25))

    prop.afo = Math.min(
      15,
      2.171 * Math.log(1 + 4.77e-4 * prop.hg[0] * prop.hg[1] * prop.wn * q),
    )

    prop.qk = 1 / cAbs(prop.zgnd)
    prop.aht = 20
    prop.xht = 0

    for (let j = 0; j < 2; j++) {
      const a = 0.5 * (prop.dl[j]! * prop.dl[j]!) / prop.he[j]!
      const wa = Math.pow(a * prop.wn, third)
      const pk = prop.qk / wa
      q = (1.607 - pk) * 151.0 * wa * prop.dl[j]! / a

      prop.xht = prop.xht + q
      prop.aht = prop.aht + fht(q, pk)
    }

    return 0
  }

  // ── Diffraction attenuation at distance d > 0 ────────────────────
  const th = prop.tha + d * prop.gme
  const ds = d - prop.dla

  let q = 0.0795775 * prop.wn * ds * th * th

  let adiff1 =
    aknfe((q * prop.dl[0]) / (ds + prop.dl[0])) +
    aknfe((q * prop.dl[1]) / (ds + prop.dl[1]))

  const a = ds / th
  const wa = Math.pow(a * prop.wn, third)
  const pk = prop.qk / wa

  q = (1.607 - pk) * 151.0 * wa * th + prop.xht

  const ar = 0.05751 * q - 4.343 * Math.log(q) - prop.aht

  q =
    (prop.wd1 + prop.xd1 / d) *
    Math.min((1 - 0.8 * Math.exp(-d / 50e3)) * prop.dh * prop.wn, 6283.2)

  const wd = 25.1 / (25.1 + Math.sqrt(q))

  adiff1 = ar * wd + (1 - wd) * adiff1 + prop.afo

  return adiff1
}

// ---------------------------------------------------------------------------
// ascat — Troposcatter attenuation
// ---------------------------------------------------------------------------

/**
 * Troposcatter attenuation at distance `d` using the NBS TN101 approximation
 * (Eqn 4.63).  Sets `prop.ascat1` to the computed scatter attenuation.
 *
 * @param d     Distance in metres.
 * @param prop  Propagation parameter object (read/write).
 */
export function ascat(d: number, prop: ItmProp): void {
  let h0: number

  if (prop.h0s > 15) {
    h0 = prop.h0s
  } else {
    const th = prop.the[0] + prop.the[1] + d * prop.gme
    let r2 = 2 * prop.wn * th

    const r1 = r2 * prop.he[0]
    r2 = r2 * prop.he[1]

    if (r1 < 0.2 && r2 < 0.2) {
      prop.ascat1 = 1001
    }

    let ss = (d - prop.ad) / (d + prop.ad)

    let q = prop.rr / ss
    ss = Math.max(0.1, ss)
    q = Math.min(Math.max(0.1, q), 10)

    const z0 = ((d - prop.ad) * (d + prop.ad) * th * 0.25) / d

    const et =
      ((prop.etq * Math.exp(-Math.pow(Math.min(1.7, z0 / 8.0e3), 6)) + 1) * z0) /
      1.7556e3

    const ett = Math.max(et, 1)

    h0 = (h0f(r1, ett) + h0f(r2, ett)) * 0.5

    h0 =
      h0 +
      Math.min(h0, (1.38 - Math.log(ett)) * Math.log(ss) * Math.log(q) * 0.49)

    h0 = Math.max(h0, 0)

    if (et < 1) {
      const term1 = 1 + 1.4142 / r1
      const term2 = 1 + 1.4142 / r2
      const term3 = (r1 + r2) / (r1 + r2 + 2.8284)
      h0 =
        et * h0 +
        (1 - et) *
          4.343 *
          Math.log(term1 * term1 * term2 * term2 * term3)
    }

    if (h0 > 15 && prop.h0s >= 0) {
      h0 = prop.h0s
    }

    if (prop.ascat1 !== 1001) {
      prop.h0s = h0
    }
  }

  const th = prop.tha + d * prop.gme

  prop.ascat1 =
    ahd(th * d) +
    4.343 * Math.log(47.7 * prop.wn * Math.pow(th, 4)) -
    0.1 * (prop.ens - 301) * Math.exp((-th * d) / 40e3) +
    h0
}

// ---------------------------------------------------------------------------
// lrprop — main propagation engine
// ---------------------------------------------------------------------------

/**
 * The core Longley-Rice propagation subroutine.
 *
 * Computes the **reference attenuation** (`aref`) for the path described in
 * `prop` at distance `d`.  The propagation regime (LOS, diffraction, or
 * troposcatter) is selected automatically based on the horizon geometry and
 * distance.
 *
 * **Initialisation:** The first call should set the field `mdp` to -1
 * (point-to-point) or 1 (area init).  Subsequent calls with `mdp = 0`
 * re-use the pre-computed coefficients.
 *
 * @param d     Distance in metres.  Pass 0 on the initial call to trigger
 *              coefficient initialisation without computing aref.
 * @param prop  Propagation parameter object (read/write).  Must already
 *              contain the fields set by qlrpfl / preparatory subroutines
 *              (hg, he, dl, the, dh, wn, gme, ens, zgnd, mdp, etc.).
 * @returns     The same `prop` object with `aref` and internal state set.
 */
export function lrprop(d: number, prop: ItmProp): ItmProp {
  const third = 1 / 3

  // ── Initialisation (runs once when mdp ≠ 0) ──────────────────────────
  if (prop.mdp !== 0) {
    // Smooth-earth horizon distances for each end
    prop.dls = [
      Math.sqrt((2 * prop.he[0]) / prop.gme),
      Math.sqrt((2 * prop.he[1]) / prop.gme),
    ] as [number, number]

    prop.dlsa = prop.dls[0] + prop.dls[1]
    prop.dla = prop.dl[0] + prop.dl[1]

    prop.tha = Math.max(
      prop.the[0] + prop.the[1],
      -prop.dla * prop.gme,
    )

    prop.wlos = 0
    prop.wscat = 0

    // ── Input validity checks (set kwx) ────────────────────────────
    if (prop.wn < 0.838 || prop.wn > 210) {
      prop.kwx = Math.max(prop.kwx, 1)
    }

    if (prop.hg[0] < 1 || prop.hg[0] > 1000) {
      prop.kwx = Math.max(prop.kwx, 1)
    }

    if (prop.hg[1] < 1 || prop.hg[1] > 1000) {
      prop.kwx = Math.max(prop.kwx, 1)
    }

    if (
      Math.abs(prop.the[0]) > 0.2 ||
      prop.dl[0] < 0.1 * prop.dls[0] ||
      prop.dl[0] > 3 * prop.dls[0]
    ) {
      prop.kwx = Math.max(prop.kwx, 3)
    }

    if (
      Math.abs(prop.the[1]) > 0.2 ||
      prop.dl[1] < 0.1 * prop.dls[1] ||
      prop.dl[1] > 3 * prop.dls[1]
    ) {
      prop.kwx = Math.max(prop.kwx, 3)
    }

    if (
      prop.ens < 250 ||
      prop.ens > 400 ||
      prop.gme < 75e-9 ||
      prop.gme > 250e-9 ||
      prop.zgnd.re < Math.abs(prop.zgnd.im) ||
      prop.wn < 0.419 ||
      prop.wn > 420
    ) {
      prop.kwx = 4
    }

    if (prop.hg[0] < 0.5 || prop.hg[0] > 3000) {
      prop.kwx = 4
    }

    if (prop.hg[1] < 0.5 || prop.hg[1] > 3000) {
      prop.kwx = 4
    }

    prop.dmin = Math.abs(prop.he[0] - prop.he[1]) / 0.2

    // ── Diffraction coefficient initialisation ─────────────────────
    adiff(0, prop)

    prop.xae = Math.pow(prop.wn * prop.gme * prop.gme, -third)

    const d3 = Math.max(prop.dlsa, 1.3787 * prop.xae + prop.dla)
    const d4 = d3 + 2.7574 * prop.xae

    const a3 = adiff(d3, prop)
    const a4 = adiff(d4, prop)

    prop.emd = (a4 - a3) / (d4 - d3)
    prop.aed = a3 - prop.emd * d3

    prop.wis =
      0.021 / (0.021 + (prop.wn * prop.dh) / Math.max(10e3, prop.dlsa))

    prop.ascat1 = 0
  }

  // ── Distance validation (runs every call) ──────────────────────────
  if (prop.mdp >= 0) {
    prop.mdp = 0
    prop.dist = d
  }

  if (prop.dist > 0) {
    if (prop.dist > 1000e3) {
      prop.kwx = Math.max(prop.kwx, 1)
    }
    if (prop.dist < prop.dmin) {
      prop.kwx = Math.max(prop.kwx, 3)
    }
    if (prop.dist < 1e3 || prop.dist > 2000e3) {
      prop.kwx = 4
    }
  }

  // ── LOS branch ──────────────────────────────────────────────────────
  if (prop.dist < prop.dlsa) {
    if (prop.wlos === 0) {
      const d2 = prop.dlsa
      const a2 = prop.aed + d2 * prop.emd
      let d0 = 1.908 * prop.wn * prop.he[0] * prop.he[1]

      if (prop.aed >= 0) {
        d0 = Math.min(d0, 0.5 * prop.dla)
        const d1 = d0 + 0.25 * (prop.dla - d0)
        const a0 = alos(d0, prop)
        const a1 = alos(d1, prop)
        _computeLosCoeffs(d0, d1, d2, a0, a1, a2, prop)
      } else {
        const d1 = Math.max(-prop.aed / prop.emd, 0.25 * prop.dla)
        const a1 = alos(d1, prop)

        let wq = 0
        if (d0 < d1) {
          const a0 = alos(d0, prop)
          const qLog = Math.log(d2 / d0)
          prop.ak2 = Math.max(
            0,
            ((d2 - d0) * (a1 - a0) - (d1 - d0) * (a2 - a0)) /
              ((d2 - d0) * Math.log(d1 / d0) - (d1 - d0) * qLog),
          )

          wq = prop.aed >= 0 || prop.ak2 > 0 ? 1 : 0

          if (wq) {
            prop.ak1 = (a2 - a0 - prop.ak2 * qLog) / (d2 - d0)
            if (prop.ak1 < 0) {
              prop.ak1 = 0
              prop.ak2 = Math.max(a2 - a0, 0) / qLog
              if (prop.ak2 === 0) {
                prop.ak1 = prop.emd
              }
            }
          }
        }

        if (!wq) {
          prop.ak1 = Math.max(a2 - a1, 0) / (d2 - d1)
          prop.ak2 = 0
          if (prop.ak1 === 0) {
            prop.ak1 = prop.emd
          }
        }
      }

      prop.ael = a2 - prop.ak1 * d2 - prop.ak2 * Math.log(d2)
      prop.wlos = 1
    }

    if (prop.dist > 0) {
      prop.aref =
        prop.ael + prop.ak1 * prop.dist + prop.ak2 * Math.log(prop.dist)
    }
  }

  // ── Diffraction / Troposcatter branch ────────────────────────────────
  if (prop.dist <= 0 || prop.dist >= prop.dlsa) {
    if (prop.wscat === 0) {
      prop.ad = prop.dl[0] - prop.dl[1]
      prop.rr = prop.he[1] / prop.he[0]

      if (prop.ad < 0) {
        prop.ad = -prop.ad
        prop.rr = 1 / prop.rr
      }

      prop.etq =
        (5.67e-6 * prop.ens - 2.32e-3) * prop.ens + 0.031

      prop.h0s = -15

      const d5 = prop.dla + 200e3
      const d6 = d5 + 200e3

      ascat(d6, prop)
      const a6 = prop.ascat1
      ascat(d5, prop)
      const a5 = prop.ascat1

      if (a5 < 1000) {
        prop.ems = (a6 - a5) / 200e3
        prop.dx = Math.max(
          prop.dlsa,
          prop.dla + 0.3 * prop.xae * Math.log(47.7 * prop.wn),
          (a5 - prop.aed - prop.ems * d5) / (prop.emd - prop.ems),
        )
        prop.aes = (prop.emd - prop.ems) * prop.dx + prop.aed
      } else {
        prop.ems = prop.emd
        prop.aes = prop.aed
        prop.dx = 10e6
      }

      prop.wscat = 1
    }

    if (prop.dist > prop.dx) {
      prop.aref = prop.aes + prop.ems * prop.dist
    } else {
      prop.aref = prop.aed + prop.emd * prop.dist
    }
  }

  // ── Clamp ────────────────────────────────────────────────────────────
  prop.aref = Math.max(prop.aref, 0)

  return prop
}

// ---------------------------------------------------------------------------
// Internal: compute LOS coefficients ak1, ak2
// ---------------------------------------------------------------------------

/**
 * Compute LOS interpolation coefficients (ak1, ak2) using three points
 * at distances d0 < d1 < d2.
 *
 * This path is taken when aed >= 0 (the Euclidean geometry case in the
 * Python itmlogic source).
 */
function _computeLosCoeffs(
  d0: number,
  d1: number,
  d2: number,
  a0: number,
  a1: number,
  a2: number,
  prop: ItmProp,
): void {
  const qLog = Math.log(d2 / d0)

  prop.ak2 = Math.max(
    0,
    ((d2 - d0) * (a1 - a0) - (d1 - d0) * (a2 - a0)) /
      ((d2 - d0) * Math.log(d1 / d0) - (d1 - d0) * qLog),
  )

  const wq = prop.aed >= 0 || prop.ak2 > 0

  if (wq) {
    prop.ak1 = (a2 - a0 - prop.ak2 * qLog) / (d2 - d0)
    if (prop.ak1 < 0) {
      prop.ak1 = 0
      prop.ak2 = Math.max(a2 - a0, 0) / qLog
      if (prop.ak2 === 0) {
        prop.ak1 = prop.emd
      }
    }
  } else {
    prop.ak1 = Math.max(a2 - a1, 0) / (d2 - d1)
    prop.ak2 = 0
    if (prop.ak1 === 0) {
      prop.ak1 = prop.emd
    }
  }
}
