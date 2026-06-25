/**
 * itmlogic — Longley-Rice Irregular Terrain Model.
 *
 * This module ports the core terrain-analysis functions (hzns, dlthx, zlsq1)
 * **and** the main propagation engine (lrprop with its supporting subroutines
 * aknfe, ahd, h0f, fht, alos, adiff, ascat) from the Python itmlogic package
 * to TypeScript.
 *
 * Together these functions implement the full ITM point-to-point path-loss
 * computation described in "The ITS Irregular Terrain Model, version 1.2.2:
 * The Algorithm" (Hufford, 1999).
 *
 * All internal calculations use Float64Array where applicable.
 *
 * @module
 */

export { zlsq1, hzns, dlthx } from "./preparatory"
export type { HorizonResult, Zlsq1Result, TerrainPfl, ItmPropInput, ItmModeFlags } from "./types"

export {
  lrprop,
  alos,
  adiff,
  ascat,
  aknfe,
  ahd,
  h0f,
  fht,
} from "./lrprop"
export type { ItmProp, Complex } from "./lrprop"

export { qlrpfl } from "./qlrpfl"
export { avar } from "./avar"
