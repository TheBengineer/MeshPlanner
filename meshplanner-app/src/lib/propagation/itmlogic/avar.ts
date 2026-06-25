import { curv } from "../../math/normal"
import type { ItmProp } from "./lrprop"

/**
 * Climate-coefficient tables for the seven ITM climate regions (1-7).
 *
 * Each array is indexed by (klim - 1).  Values match the Python itmlogic
 * v1.2+ avar module exactly.
 */
// prettier-ignore
const BV1  = [  -9.67,   -0.62,    1.26,   -9.21,   -0.62,   -0.39,    3.15]
const BV2  = [   12.7,    9.19,    15.5,    9.05,    9.19,    2.86,   857.9]
const XV1  = [144.9e3, 228.9e3, 262.6e3,  84.1e3, 228.9e3, 141.7e3, 2222e3]
const XV2  = [190.3e3, 205.2e3, 185.2e3, 101.1e3, 205.2e3, 315.9e3, 164.8e3]
const XV3  = [133.8e3, 143.6e3,  99.8e3,  98.6e3, 143.6e3, 167.4e3, 116.3e3]
const BSM1 = [   2.13,    2.66,    6.11,    1.98,    2.68,    6.86,    8.51]
const BSM2 = [  159.5,    7.67,    6.65,   13.11,    7.16,   10.38,   169.8]
const XSM1 = [762.2e3, 100.4e3, 138.2e3, 139.1e3,  93.7e3, 187.8e3, 609.8e3]
const XSM2 = [123.6e3, 172.5e3, 242.2e3, 132.7e3, 186.8e3, 169.6e3, 119.9e3]
const XSM3 = [ 94.5e3, 136.4e3, 178.6e3, 193.5e3, 133.5e3, 108.9e3, 106.6e3]
const BSP1 = [   2.11,    6.87,   10.08,    3.68,    4.75,    8.58,    8.43]
const BSP2 = [  102.3,   15.53,    9.60,   159.3,    8.12,   13.97,    8.19]
const XSP1 = [636.9e3, 138.7e3, 165.3e3, 464.4e3,  93.2e3, 216.0e3, 136.2e3]
const XSP2 = [134.8e3, 143.7e3, 225.7e3,  93.1e3, 135.9e3, 152.0e3, 188.5e3]
const XSP3 = [ 95.6e3,  98.6e3, 129.7e3,  94.2e3, 113.4e3, 122.7e3, 122.9e3]
const BSD1 = [  1.224,   0.801,   1.380,   1.000,   1.224,   1.518,   1.518]
const BZD1 = [  1.282,   2.161,   1.282,     20.,   1.282,   1.282,   1.282]
const BFM1 = [     1.,      1.,      1.,      1.,    0.92,      1.,      1.]
const BFM2 = [     0.,      0.,      0.,      0.,    0.25,      0.,      0.]
const BFM3 = [     0.,      0.,      0.,      0.,    1.77,      0.,      0.]
const BFP1 = [     1.,    0.93,      1.,    0.93,    0.93,      1.,      1.]
const BFP2 = [     0.,    0.31,      0.,    0.19,    0.31,      0.,      0.]
const BFP3 = [     0.,    2.00,      0.,    1.79,    2.00,      0.,      0.]

/**
 * Finds the quantiles of attenuation using the output from lrprop.
 *
 * This implements Section V of "The ITS Irregular Terrain Model, version
 * 1.2.2: The Algorithm" (Hufford, 1999). When in area prediction mode we
 * need a threefold quantile of attenuation corresponding to time, locations
 * and situations. For efficiency, avar is written as a function of the
 * standard normal deviates corresponding to the requested fractions.
 *
 * @param zzt  Standard normal deviate for time quantile.
 * @param zzl  Standard normal deviate for location quantile.
 * @param zzc  Standard normal deviate for confidence quantile.
 * @param prop Propagation parameter object (mutated: variability state and
 *             lvar flag updated).
 * @returns  [excess_loss_db, prop] — additional attenuation from the median
 *           and the updated prop.
 */
export function avar(
  zzt: number,
  zzl: number,
  zzc: number,
  prop: ItmProp,
): [number, ItmProp] {
  const third = 1 / 3
  const rt = 7.8
  const rl = 24

  // ── Initialisation (runs only once, gated by lvar) ────────────────────
  if (prop.lvar > 0) {
    if (prop.lvar > 4) {
      // Climate-dependent coefficients (Table 5.1)
      let ki: number
      if (prop.klim <= 0 || prop.klim > 7) {
        prop.klim = 5
        prop.kwx = Math.max(prop.kwx, 2)
      }
      ki = prop.klim - 1

      prop.cv1 = BV1[ki]
      prop.cv2 = BV2[ki]
      prop.yv1 = XV1[ki]
      prop.yv2 = XV2[ki]
      prop.yv3 = XV3[ki]
      prop.csm1 = BSM1[ki]
      prop.csm2 = BSM2[ki]
      prop.ysm1 = XSM1[ki]
      prop.ysm2 = XSM2[ki]
      prop.ysm3 = XSM3[ki]
      prop.csp1 = BSP1[ki]
      prop.csp2 = BSP2[ki]
      prop.ysp1 = XSP1[ki]
      prop.ysp2 = XSP2[ki]
      prop.ysp3 = XSP3[ki]
      prop.csd1 = BSD1[ki]
      prop.zd = BZD1[ki]
      prop.cfm1 = BFM1[ki]
      prop.cfm2 = BFM2[ki]
      prop.cfm3 = BFM3[ki]
      prop.cfp1 = BFP1[ki]
      prop.cfp2 = BFP2[ki]
      prop.cfp3 = BFP3[ki]
    }

    if (prop.lvar > 3) {
      // Decode mdvar into kdv + flags
      let kdv = prop.mdvar
      const ws = kdv >= 20
      if (ws) kdv -= 20
      const wl = kdv >= 10
      if (wl) kdv -= 10

      if (kdv < 0 || kdv > 3) {
        kdv = 0
        prop.kwx = Math.max(prop.kwx, 2)
      }

      prop.kdv = kdv
      prop.ws = ws
      prop.wl = wl
    }

    if (prop.lvar > 2) {
      // Frequency-gain factors
      const q = Math.log(0.133 * prop.wn)

      prop.gm =
        prop.cfm1! + prop.cfm2! / ((prop.cfm3! * q) ** 2 + 1)
      prop.gp =
        prop.cfp1! + prop.cfp2! / ((prop.cfp3! * q) ** 2 + 1)
    }

    if (prop.lvar > 1) {
      // Distance-scaling parameter
      prop.dexa =
        Math.sqrt(18e6 * prop.he[0]) +
        Math.sqrt(18e6 * prop.he[1]) +
        (575.7e12 / prop.wn) ** third
    }

    // Effective distance for variability curves
    const de =
      prop.dist < prop.dexa!
        ? (130e3 * prop.dist) / prop.dexa!
        : 130e3 + prop.dist - prop.dexa!

    // Median variability (Vmd)
    prop.vmd = curv(
      prop.cv1!, prop.cv2!, prop.yv1!,
      prop.yv2!, prop.yv3!, de,
    )

    // Sigma time minus / plus
    prop.sgtm = curv(
      prop.csm1!, prop.csm2!, prop.ysm1!,
      prop.ysm2!, prop.ysm3!, de,
    ) * prop.gm!

    prop.sgtp = curv(
      prop.csp1!, prop.csp2!, prop.ysp1!,
      prop.ysp2!, prop.ysp3!, de,
    ) * prop.gp!

    prop.sgtd = prop.sgtp * prop.csd1!
    prop.tgtd = (prop.sgtp - prop.sgtd) * prop.zd!

    // Location variability (sgl)
    if (prop.wl!) {
      prop.sgl = 0
    } else {
      const q =
        (1 - 0.8 * Math.exp(-prop.dist / 50e3)) *
        prop.dh * prop.wn
      prop.sgl = (10 * q) / (q + 13)
    }

    // Weather / siting variability (vs0)
    if (prop.ws!) {
      prop.vs0 = 0
    } else {
      prop.vs0 = (5 + 3 * Math.exp(-de / 100e3)) ** 2
    }

    prop.lvar = 0
  }

  // ── Quantile computation (runs every call) ─────────────────────────────
  let zt = zzt
  let zl = zzl
  let zc = zzc

  if (prop.kdv === 0) {
    zt = zc
    zl = zc
  } else if (prop.kdv === 1) {
    zl = zc
  } else if (prop.kdv === 2) {
    zl = zt
  }

  if (Math.abs(zt) > 3.1 || Math.abs(zl) > 3.1 || Math.abs(zc) > 3.1) {
    prop.kwx = Math.max(prop.kwx, 1)
  }

  // Select the time sigma (sgt) based on zt sign and magnitude
  let sgt: number
  if (zt < 0) {
    sgt = prop.sgtm!
  } else if (zt <= prop.zd!) {
    sgt = prop.sgtp!
  } else {
    sgt = prop.sgtd! + prop.tgtd! / zt
  }

  // Combined variance
  const vs =
    prop.vs0! +
    (sgt * zt) ** 2 / (rt + zc * zc) +
    (prop.sgl! * zl) ** 2 / (rl + zc * zc)

  // kdv-dependent combination of the three components
  let yr: number
  let sgc: number

  if (prop.kdv === 0) {
    yr = 0
    sgc = Math.sqrt(sgt * sgt + prop.sgl! * prop.sgl! + vs)
  } else if (prop.kdv === 1) {
    yr = sgt * zt
    sgc = Math.sqrt(prop.sgl! * prop.sgl! + vs)
  } else if (prop.kdv === 2) {
    yr = Math.sqrt(sgt * sgt + prop.sgl! * prop.sgl!) * zt
    sgc = Math.sqrt(vs)
  } else {
    yr = sgt * zt + prop.sgl! * zl
    sgc = Math.sqrt(vs)
  }

  let avar1 = prop.aref - prop.vmd! - yr - sgc * zc

  // Empirical correction for small excess (Python itmlogic behaviour)
  if (avar1 < 0) {
    avar1 = (avar1 * (29 - avar1)) / (29 - 10 * avar1)
  }

  return [avar1, prop]
}
