import { hzns, dlthx, zlsq1 } from "./preparatory"
import { lrprop } from "./lrprop"
import type { ItmProp } from "./lrprop"

/**
 * Prepares the prop dictionary for the point-to-point ITM mode and
 * initialises the propagation coefficients via lrprop(0, prop).
 *
 * Matches the Python itmlogic qlrpfl (preparatory_subroutines/qlrpfl.py,
 * §43 of the Hufford reference).
 *
 * Steps:
 *  1. Compute total path distance from the terrain profile (pfl).
 *  2. Call hzns() for horizon distances and take-off angles.
 *  3. Compute the delta-h (dh) terrain irregularity via dlthx().
 *  4. Determine effective antenna heights (he) from zlsq1() fits,
 *     adjusting dl/the when the horizons are far apart (LOS case).
 *  5. Set mode flags (mdp, lvar) and handle mdvarx/klimx overrides.
 *  6. Initialise lrprop with d=0 (coefficient pre-computation).
 *
 * @param prop  Propagation parameter object (must contain pfl, hg, gme,
 *              mdvarx, klimx, lvar, mdvar, klim, kwx, wn, ipol, ens, he).
 * @returns     The same prop with terrain geometry, he, and lrprop state set.
 */
export function qlrpfl(prop: ItmProp): ItmProp {
  // Total path distance in metres
  prop.dist = prop.pfl[0]! * prop.pfl[1]!

  const np = prop.pfl[0]!

  // Horizon distances and take-off angles from both ends
  const hznsResult = hzns(prop.pfl, prop.dist, prop.hg, prop.gme)
  prop.the = hznsResult.the
  prop.dl = hznsResult.dl

  // Compute xl bounds for the terrain irregularity calculation
  const xl: [number, number] = [0, 0]
  for (let j = 0; j < 2; j++) {
    xl[j] = Math.min(15 * prop.hg[j]!, 0.1 * prop.dl[j]!)
  }
  xl[1] = prop.dist - xl[1]

  // Delta-h terrain irregularity
  prop.dh = dlthx(prop.pfl, xl[0], xl[1])

  // ── Effective antenna heights ─────────────────────────────────────────
  if (prop.dl[0]! + prop.dl[1]! >= 1.5 * prop.dist) {
    // LOS case: horizons far apart — compute he from full-profile fit
    const [za, zb] = zlsq1(prop.pfl, xl[0], xl[1])
    prop.he = [0, 0]
    prop.he[0] = prop.hg[0]! + Math.max(prop.pfl[2]! - za, 0)
    prop.he[1] = prop.hg[1]! + Math.max(prop.pfl[np + 1]! - zb, 0)

    // Adjust horizon distances using effective heights
    for (let j = 0; j < 2; j++) {
      prop.dl[j] =
        Math.sqrt((2 * prop.he[j]!) / prop.gme) *
        Math.exp(-0.07 * Math.sqrt(prop.dh / Math.max(prop.he[j]!, 5)))
    }

    let q = prop.dl[0]! + prop.dl[1]!

    if (q <= prop.dist) {
      q = (prop.dist / q) ** 2
      for (let j = 0; j < 2; j++) {
        prop.he[j] = prop.he[j]! * q
        prop.dl[j] =
          Math.sqrt((2 * prop.he[j]!) / prop.gme) *
          Math.exp(-0.07 * Math.sqrt(prop.dh / Math.max(prop.he[j]!, 5)))
      }
    }

    // Recompute take-off angles from adjusted horizon distances
    for (let j = 0; j < 2; j++) {
      q = Math.sqrt((2 * prop.he[j]!) / prop.gme)
      prop.the[j] =
        ((0.65 * prop.dh * (q / prop.dl[j]! - 1) - 2 * prop.he[j]!) / q)
    }
  } else {
    // Non-LOS case: fit each end separately
    const [za] = zlsq1(prop.pfl, xl[0], 0.9 * prop.dl[0]!)
    const [, zb] = zlsq1(
      prop.pfl,
      prop.dist - 0.9 * prop.dl[1]!,
      xl[1],
    )
    prop.he = [0, 0]
    prop.he[0] = prop.hg[0]! + Math.max(prop.pfl[2]! - za, 0)
    prop.he[1] = prop.hg[1]! + Math.max(prop.pfl[np + 2]! - zb, 0)
  }

  // ── Mode flags ────────────────────────────────────────────────────────
  prop.mdp = -1
  prop.lvar = Math.max(prop.lvar, 3)

  if (prop.mdvarx >= 0) {
    prop.mdvar = prop.mdvarx
    prop.lvar = Math.max(prop.lvar, 4)
  }

  if (prop.klimx > 0) {
    prop.klim = prop.klimx
    prop.lvar = 5
  }

  // Initialise lrprop coefficients (d = 0 triggers init only)
  lrprop(0, prop)

  return prop
}
