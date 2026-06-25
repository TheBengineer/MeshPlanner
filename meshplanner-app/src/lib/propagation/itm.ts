import { fspl } from "../math/freespace"
import { qerfi } from "../math/normal"
import { qlrpfl, avar } from "./itmlogic"
import type { ItmProp } from "./itmlogic/lrprop"
import type { TerrainProfile } from "../types"

export interface PathLossResult {
  pathLossDb: number
  freeSpaceLossDb: number
  excessLossDb: number
  distanceKm: number
  frequencyMhz: number
}

/**
 * Extended propagation parameters for the full ITM Longley-Rice model.
 *
 * All fields except `frequencyMhz`, `txHeightM`, `rxHeightM` are optional
 * and default to the values used by the 10 canonical cross-validation profiles
 * (continental temperate climate, vertical polarisation, etc.).
 */
export interface PathLossParams {
  frequencyMhz: number
  txHeightM: number
  rxHeightM: number
  polarization?: number
  climate?: number
  groundPermittivity?: number
  groundConductivity?: number
  surfaceRefractivity?: number
}

/**
 * Complex number helpers for ground impedance.
 */
type Cx = { re: number; im: number }

function cSqrt(z: Cx): Cx {
  const mag = Math.sqrt(z.re * z.re + z.im * z.im)
  return {
    re: Math.sqrt((mag + z.re) / 2),
    im: Math.sign(z.im) * Math.sqrt((mag - z.re) / 2),
  }
}

function cDiv(a: Cx, b: Cx): Cx {
  const denom = b.re * b.re + b.im * b.im
  return {
    re: (a.re * b.re + a.im * b.im) / denom,
    im: (a.im * b.re - a.re * b.im) / denom,
  }
}

// ---------------------------------------------------------------------------
// Defaults matching the Python itmlogic runner.py _build_prop
// ---------------------------------------------------------------------------

const DEFAULT_EPS = 15.0
const DEFAULT_SGM = 0.005
const DEFAULT_ENS0 = 314.0
const DEFAULT_CLIMATE = 5
const DEFAULT_POLARIZATION = 1
const GMA = 157e-9

// ---------------------------------------------------------------------------
// buildProp — create an ItmProp from terrain profile + user parameters
// ---------------------------------------------------------------------------

/**
 * Build an ItmProp object from a TerrainProfile and user parameters.
 *
 * This mirrors the Python `_build_prop` in runner.py.
 * The returned prop is ready to pass to `qlrpfl()`.
 */
function buildProp(
  profile: TerrainProfile,
  params: PathLossParams,
): ItmProp {
  const distKm = profile.totalDistanceKm
  const freqMhz = params.frequencyMhz
  const txH = params.txHeightM
  const rxH = params.rxHeightM
  const ipol = params.polarization ?? DEFAULT_POLARIZATION
  const klim = params.climate ?? DEFAULT_CLIMATE
  const eps = params.groundPermittivity ?? DEFAULT_EPS
  const sgm = params.groundConductivity ?? DEFAULT_SGM
  const ens0 = params.surfaceRefractivity ?? DEFAULT_ENS0

  const numPoints = profile.elevations.length
  const numSegments = numPoints - 1

  if (numSegments <= 0) {
    throw new Error(
      `Elevation profile must have at least 2 points, got ${numPoints}`,
    )
  }

  const deltaDistanceM = (distKm * 1000) / numSegments

  // Build the pfl array: [numSegments, step_m, elev0, ..., elevN]
  const pfl = new Float64Array(numSegments + 2 + 1) // 2 header + N+1 elevations
  pfl[0] = numSegments
  pfl[1] = deltaDistanceM
  for (let i = 0; i < numPoints; i++) {
    pfl[2 + i] = profile.elevations[i]!
  }

  // Wavenumber (radians per metre)
  const wn = freqMhz / 47.7

  // Effective earth curvature
  const gme = GMA * (1 - 0.04665 * Math.exp(ens0 / 179.3))

  // Complex ground impedance
  const zq: Cx = { re: eps, im: (376.62 * sgm) / wn }
  let zgnd = cSqrt({ re: zq.re - 1, im: zq.im })
  if (ipol !== 0) {
    zgnd = cDiv(zgnd, zq)
  }

  return {
    pfl,
    hg: [txH, rxH],
    he: [0, 0],
    fmhz: freqMhz,
    wn,
    ens: ens0,
    gme,
    zgnd: { re: zgnd.re, im: zgnd.im },
    ipol,

    // Horizon / terrain (will be set by hzns / dlthx / qlrpfl)
    the: [0, 0],
    dl: [0, 0],
    dh: 0,
    dist: 0,

    // Mode flags
    mdp: 0,
    lvar: 5,
    mdvarx: 11,
    mdvar: 0,
    klimx: 0,
    klim,
    kwx: 0,

    // Internal state (initialised by lrprop)
    dls: [0, 0],
    dlsa: 0,
    dla: 0,
    tha: 0,
    wlos: 0,
    wscat: 0,
    dmin: 0,
    xae: 0,
    emd: 0,
    aed: 0,
    wis: 0,
    ascat1: 0,

    ak1: 0,
    ak2: 0,
    ael: 0,

    ad: 0,
    rr: 0,
    etq: 0,
    h0s: 0,
    ems: 0,
    dx: 0,
    aes: 0,

    qk: 0,
    wd1: 0,
    xd1: 0,
    afo: 0,
    aht: 0,
    xht: 0,

    aref: 0,
  }
}

// ---------------------------------------------------------------------------
// computePathLoss — full ITM Longley-Rice point-to-point path loss
// ---------------------------------------------------------------------------

/**
 * Full ITM (Irregular Terrain Model) point-to-point path loss.
 *
 * Implements the complete Longley-Rice model:
 *  1. Build terrain profile (pfl) with antenna heights and ground params.
 *  2. Run qlrpfl — calls hzns, dlthx, zlsq1 for horizon/terrain geometry
 *     and initialises lrprop coefficients.
 *  3. Compute free-space path loss (ITU-R P.525).
 *  4. Compute time / location / confidence variability via avar.
 *
 * @param profile  Terrain elevation profile.
 * @param params   Frequency, antenna heights, and optional ground/climate params.
 * @returns        Path loss result with total, free-space, and excess loss.
 */
export function computePathLoss(
  profile: TerrainProfile,
  params: PathLossParams,
): PathLossResult {
  const distKm = profile.totalDistanceKm
  const freq = params.frequencyMhz

  // Free-space path loss
  const fs = fspl(freq, distKm)

  // Build the ITM prop and run the engine
  const prop = buildProp(profile, params)

  // qlrpfl: terrain geometry (hzns, dlthx, zlsq1) + lrprop init
  qlrpfl(prop)

  // Convert availability quantiles to standard normal deviates
  const ta = 0.5
  const la = 0.5
  const ca = 0.5

  const zt = qerfi(ta)
  const zl = qerfi(la)
  const zc = qerfi(ca)

  // Excess loss from time / location / confidence variability
  const [excessDb] = avar(zt, zl, zc, prop)

  // Round to 1 decimal place (matching runner.py)
  const total = Math.round((fs + excessDb) * 10) / 10

  return {
    pathLossDb: Math.round(total * 10) / 10,
    freeSpaceLossDb: Math.round(fs * 10) / 10,
    excessLossDb: Math.round(excessDb * 10) / 10,
    distanceKm: Math.round(distKm * 100) / 100,
    frequencyMhz: freq,
  }
}
