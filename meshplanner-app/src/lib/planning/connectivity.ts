/**
 * Connectivity graph builder for hilltop candidates.
 *
 * Computes line-of-sight and optional ITM link budget between every pair of
 * candidates within a given range.  Geometric LOS (4/3 earth curvature) is
 * always checked; full ITM propagation (Longley–Rice) is only run when
 * `useFullItm` is set.
 *
 * @module
 */

import { haversineDistance } from "../math/geodetic"
import { extractProfile } from "../propagation/profile"
import { computePathLoss } from "../propagation/itm"
import { calculateLinkBudget } from "../math/link-budget"
import type { HilltopScored, LoraParams } from "../types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectivityEdge {
  /** Index into the candidates array for the first endpoint. */
  sourceIdx: number
  /** Index into the candidates array for the second endpoint. */
  targetIdx: number
  /** Great-circle distance between the two sites in kilometres. */
  distanceKm: number
  /** Whether the geometric line-of-sight is clear (4/3 earth curvature). */
  losClear: boolean
  /** ITM path loss in dB (only present when `useFullItm` was true). */
  pathLossDb?: number
  /** Link margin in dB (only present when `loraParams` was provided). */
  marginDb?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Earth mean radius in metres (WGS‑84). */
const EARTH_RADIUS_M = 6_371_000

/** Effective earth radius for 4/3 atmospheric refraction model. */
const R_EFFECTIVE_M = (4 / 3) * EARTH_RADIUS_M

/** Default number of sample points for terrain profile extraction. */
const PROFILE_SAMPLES = 100

// ---------------------------------------------------------------------------
// Geometric LOS (4/3 earth curvature)
// ---------------------------------------------------------------------------

/**
 * Check whether the straight-line path between two points is above the terrain
 * when accounting for 4/3 earth curvature.
 *
 * Uses the extracted terrain profile and applies the same curvature correction
 * as the viewshed module (d² / 2·R_eff).
 *
 * @param elev1           Terrain elevation (metres) at the source.
 * @param elev2           Terrain elevation (metres) at the target.
 * @param profile         Terrain profile along the path (includes endpoints).
 * @param totalDistanceKm Total path length in kilometres.
 * @returns `true` when every intermediate sample lies below the line of sight.
 */
function checkGeometricLos(
  elev1: number,
  elev2: number,
  profile: import("../types").TerrainProfile,
  totalDistanceKm: number,
): boolean {
  const totalDistM = totalDistanceKm * 1000

  // Coincident or extremely close points are always visible.
  if (totalDistM < 1) return true

  const numPoints = profile.elevations.length

  // Skip first and last — those are the endpoints themselves.
  for (let i = 1; i < numPoints - 1; i++) {
    const frac = profile.distancesKm[i]! / totalDistanceKm
    const dFromSourceM = frac * totalDistM

    // Earth curvature drop at this distance: d² / (2·R_eff)
    const curvatureDrop = (dFromSourceM * dFromSourceM) / (2 * R_EFFECTIVE_M)

    // Line-of-sight height at this fraction along the straight line.
    const losHeight = elev1 + frac * (elev2 - elev1)

    // Blocked if terrain + curvature rises above the LOS line.
    if (profile.elevations[i]! + curvatureDrop > losHeight + 1e-9) {
      return false
    }
  }

  return true
}

// ---------------------------------------------------------------------------
// Connectivity graph
// ---------------------------------------------------------------------------

/**
 * Build a connectivity graph between hilltop candidates.
 *
 * For every pair within `maxLinkKm`:
 *  1. Extract the terrain profile along the great-circle path.
 *  2. Check geometric line-of-sight with 4/3 earth curvature.
 *  3. If `useFullItm` is true, run the full ITM Longley–Rice path loss and
 *     optionally the LoRa link budget.
 *
 * The result is an array of `ConnectivityEdge` objects sorted by distance
 * (shortest first).
 *
 * @param candidates  Hilltop candidates (must have `lat`, `lon`, `elevationM`).
 * @param dem         1‑D elevation array in row‑major order.
 * @param demWidth    Number of DEM columns.
 * @param demHeight   Number of DEM rows.
 * @param affine      Affine transform mapping (col, row) ↔ (lon, lat).
 *                    `a` = pixel width (deg), `c` = west edge (deg),
 *                    `e` = pixel height (deg, negative), `f` = north edge (deg).
 * @param maxLinkKm   Maximum link distance in kilometres.  Pairs beyond this
 *                    are excluded.
 * @param opts        Optional parameters.
 * @param opts.useFullItm   When `true`, runs the full ITM model for each
 *                          visible pair (default `false`).
 * @param opts.frequencyMhz Centre frequency in MHz (required for ITM).
 * @param opts.txHeightM    Transmitter antenna height AGL in metres
 *                          (default 1.5).
 * @param opts.rxHeightM    Receiver antenna height AGL in metres
 *                          (default 1.5).
 * @param opts.loraParams   LoRa parameters for link-budget computation.
 *                          When provided, `marginDb` is populated on the edge.
 * @returns An array of edges sorted by distance ascending.
 */
export function computeConnectivityGraph(
  candidates: HilltopScored[],
  dem: Float32Array,
  demWidth: number,
  demHeight: number,
  affine: { a: number; c: number; f: number; e: number },
  maxLinkKm: number,
  opts?: {
    useFullItm?: boolean
    frequencyMhz?: number
    txHeightM?: number
    rxHeightM?: number
    loraParams?: LoraParams
  },
): ConnectivityEdge[] {
  const edges: ConnectivityEdge[] = []
  const n = candidates.length
  const useFullItm = opts?.useFullItm ?? false
  const freqMhz = opts?.frequencyMhz
  const txH = opts?.txHeightM ?? 1.5
  const rxH = opts?.rxHeightM ?? 1.5

  for (let i = 0; i < n; i++) {
    const a = candidates[i]!
    for (let j = i + 1; j < n; j++) {
      const b = candidates[j]!

      // ── Quick distance sieve ──────────────────────────────────────────
      const distKm = haversineDistance(a.lat, a.lon, b.lat, b.lon)
      if (distKm > maxLinkKm || distKm < 0.001) continue

      // ── Terrain profile ───────────────────────────────────────────────
      const profile = extractProfile(
        dem, demWidth, demHeight, affine,
        a.lat, a.lon, b.lat, b.lon,
        PROFILE_SAMPLES,
      )

      // ── Geometric LOS ─────────────────────────────────────────────────
      const losClear = checkGeometricLos(
        a.elevationM, b.elevationM,
        profile, distKm,
      )

      // ── Full ITM (optional) ───────────────────────────────────────────
      let pathLossDb: number | undefined
      let marginDb: number | undefined

      if (useFullItm && losClear && freqMhz !== undefined) {
        const plResult = computePathLoss(profile, {
          frequencyMhz: freqMhz,
          txHeightM: txH,
          rxHeightM: rxH,
        })
        pathLossDb = plResult.pathLossDb

        if (opts?.loraParams) {
          const budget = calculateLinkBudget(opts.loraParams, pathLossDb)
          marginDb = budget.marginDb
        }
      }

      edges.push({
        sourceIdx: i,
        targetIdx: j,
        distanceKm: round1(distKm),
        losClear,
        pathLossDb,
        marginDb,
      })
    }
  }

  // Sort by distance ascending.
  edges.sort((a, b) => a.distanceKm - b.distanceKm)

  return edges
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round to 1 decimal place. */
function round1(v: number): number {
  return Math.round(v * 10) / 10
}
