/**
 * Scout orchestrator — runs hilltop detection on the DEM, scores each peak with
 * the viewshed rank, and returns results sorted by coverage potential.
 *
 * @module
 */

import { detectHilltops } from "@/lib/sites/hilltop"
import { computeViewshedRank } from "@/lib/planning/viewshed"
import { Affine } from "@/lib/math/affine"
import type { HilltopScored } from "@/lib/types"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScoutOptions {
  /** Minimum topographic prominence (metres).  Default 50. */
  minProminenceM?: number
  /** Maximum number of candidates to return.  Default 200. */
  maxPeaks?: number
}

// ── Scout ─────────────────────────────────────────────────────────────────────

/**
 * Run hilltop detection on the DEM, score each peak with a viewshed rank, and
 * return the results sorted by viewshed rank descending.
 *
 * The viewshed rank (0‑1) is a fast proxy for coverage potential — the fraction
 * of sample points within *bbox* from which the peak is visible.  No actual
 * coverage computation is performed at this stage.
 *
 * @param dem      1‑D elevation array in row‑major order.
 * @param demWidth Number of columns (pixels per row).
 * @param demHeight Number of rows.
 * @param affine   Affine transform.  `.a` = pixel width (deg), `.c` = west
 *                 edge longitude, `.e` = pixel height (deg, negative),
 *                 `.f` = north edge latitude.
 * @param bbox     Geographic bounding box for the viewshed sample grid.
 * @param options  Optional tuning parameters (prominence threshold, cap).
 * @returns Promise resolving to an array of scored hilltops sorted by
 *          viewshed rank descending, capped at `maxPeaks` (default 200).
 */
export async function scoutTerrain(
  dem: Float32Array,
  demWidth: number,
  demHeight: number,
  affine: { a: number; c: number; e: number; f: number },
  bbox: { west: number; south: number; east: number; north: number },
  options?: ScoutOptions,
): Promise<HilltopScored[]> {
  const { minProminenceM = 50, maxPeaks = 200 } = options ?? {}

  // ── Step 1.  Hilltop detection ──────────────────────────────────────
  // detectHilltops needs the full Affine class; construct one assuming
  // standard north-up raster (b = d = 0).
  const affineFull = new Affine(affine.a, 0, affine.c, 0, affine.e, affine.f)
  const results = detectHilltops(dem, demWidth, demHeight, affineFull, minProminenceM)

  // ── Step 2.  Viewshed scoring for each peak ─────────────────────────
  const scored: HilltopScored[] = results.map((r) => {
    const viewshedRank = computeViewshedRank(
      r.lat,
      r.lon,
      dem,
      demWidth,
      demHeight,
      affine,
      bbox,
    )

    return {
      lat: r.lat,
      lon: r.lon,
      elevationM: r.elevation_m,
      prominenceM: r.prominence_m,
      viewshedRank,
    }
  })

  // ── Step 3.  Sort by viewshed rank descending ───────────────────────
  scored.sort((a, b) => b.viewshedRank - a.viewshedRank)

  // ── Step 4.  Cap at maxPeaks ────────────────────────────────────────
  return scored.slice(0, maxPeaks)
}
