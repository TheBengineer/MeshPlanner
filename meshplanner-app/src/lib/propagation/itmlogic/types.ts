/**
 * Internal types for the itmlogic Longley-Rice propagation model.
 *
 * These types describe how the preparatory subroutines (hzns, dlthx, zlsq1)
 * represent terrain profiles, horizon geometry, and intermediate results.
 * They follow the conventions established in the Python itmlogic package.
 */

/**
 * Terrain profile encoded in the itmlogic "pfl" format.
 *
 * Layout:
 *   index 0 — number of intervals (np)
 *   index 1 — spacing between samples in metres (xi)
 *   index 2 … np+2 — elevation values in metres (np+1 values)
 */
export interface TerrainPfl {
  /** The raw Float64Array storing [np, xi, elev0, …, elevN]. */
  data: Float64Array
}

/**
 * Horizon parameters returned by hzns().
 *
 * Index 0 corresponds to the transmitter end,
 * index 1 corresponds to the receiver end.
 */
export interface HorizonResult {
  /** Horizon take-off angles from each end (radians). */
  the: [number, number]
  /** Horizon distances from each end (metres). */
  dl: [number, number]
}

/**
 * Interpolated heights returned by zlsq1().
 */
export type Zlsq1Result = [number, number]

/**
 * Subset of the itmlogic prop dictionary needed by the preparatory
 * subroutines.  Used when dispatching to hzns / dlthx / zlsq1 in sequence
 * (as qlrpfl does).  Many more fields exist in the full prop dict (see
 * lrprop in the Python itmlogic package).
 */
export interface ItmPropInput {
  /** Terrain profile in pfl format. */
  pfl: Float64Array
  /** Antenna heights above ground [tx, rx] in metres. */
  hg: [number, number]
  /** Effective earth curvature. */
  gme: number
  /** Total path distance in metres. */
  dist: number
}

/**
 * Mode / variability flags used by qlrpfl and qlra.
 */
export interface ItmModeFlags {
  /** mdvarx from input (≥0 to override mdvar). */
  mdvarx: number
  /** Variability mode (0 = single message, 1 = individual, 2 = mobile, 3 = broadcast, etc.). */
  mdvar: number
  /** Climate mode from input (>0 to override klim). */
  klimx: number
  /** Climate code (1–7). */
  klim: number
  /** Internal mode flag (-1 = point-to-point, 1 = area init, 0 = area continue). */
  mdp: number
  /** Internal variability level. */
  lvar: number
}
