/**
 * Parallel coverage matrix builder.
 *
 * Computes full ITM coverage for the top N hilltop candidates (by viewshed
 * rank) using the existing worker pool, then builds a sparse coverage matrix
 * for use by the site-selection optimizer (greedy / ILP).
 *
 * @module
 */

import { computeCoverageWithWorkers } from "../../workers/coverage-manager"
import { buildCoverageMatrix } from "../optimize/matrix"
import type { CoverageMatrix, CoverageRaster, HilltopScored, LoraParams } from "../types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MatrixBuilderResult {
  /** Coverage rasters keyed by site name. */
  rasters: Map<string, CoverageRaster>
  /** Sparse coverage matrix for the optimizer. */
  matrix: CoverageMatrix
  /** Site names in the same order as the matrix rows. */
  siteNames: string[]
  /** Wall-clock time in milliseconds. */
  elapsedMs: number
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default number of candidates to process when `topN` is omitted. */
const DEFAULT_TOP_N = 50

/** Default number of radials for the propagation sweep. */
const DEFAULT_NUM_RADIALS = 360

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute full ITM coverage for the top N hilltop candidates in parallel,
 * then build a sparse coverage matrix suitable for greedy / ILP optimization.
 *
 * Failed sites (worker error, aborted, out-of-range) are silently skipped
 * and logged to the console — a single bad site never fails the whole batch.
 *
 * @param candidates      Hilltop candidates sorted (or unsorted) by viewshed.
 *                        The top `topN` by `viewshedRank` are selected.
 * @param dem             1‑D elevation array in row‑major order.
 * @param demWidth        Number of DEM columns.
 * @param demHeight       Number of DEM rows.
 * @param demAffine       Affine transform parameters: `.a` = pixel width
 *                        (deg), `.c` = west edge (deg), `.e` = pixel height
 *                        (deg, negative), `.f` = north edge (deg).
 * @param params          LoRa link parameters shared by every site.
 * @param coverageParams  Coverage computation parameters.
 * @param coverageParams.maxRangeKm  Maximum ITM propagation range in km.
 * @param coverageParams.threshold   RSSI threshold (dBm) for the matrix.
 * @param coverageParams.numRadials  Number of radials (default 360).
 * @param topN            Maximum candidates to process (default 50).  Pass a
 *                        value ≥ candidates.length to process every candidate.
 * @param onProgress      Callback invoked as each site finishes.  Receives
 *                        `(done, total)`.  Useful for driving a progress bar.
 * @param requiredIndices Indices into `candidates` that must be included in
 *                        the matrix regardless of their viewshed rank.  Pass
 *                        an empty array or omit for default behaviour (top N
 *                        by viewshed rank only).
 */
export async function buildMeshCoverageMatrix(
  candidates: HilltopScored[],
  dem: Float32Array,
  demWidth: number,
  demHeight: number,
  demAffine: { a: number; c: number; f: number; e: number },
  params: LoraParams,
  coverageParams: { maxRangeKm: number; threshold: number; numRadials?: number },
  topN?: number,
  onProgress?: (done: number, total: number) => void,
  requiredIndices?: number[],
): Promise<MatrixBuilderResult> {
  const started = performance.now()
  const maxRangeKm = coverageParams.maxRangeKm
  const threshold = coverageParams.threshold
  const numRadials = coverageParams.numRadials ?? DEFAULT_NUM_RADIALS
  const nWanted = topN ?? DEFAULT_TOP_N

  // ── Boost required sites so they survive the top-N cut ────────────────
  if (requiredIndices !== undefined) {
    for (const idx of requiredIndices) {
      if (idx >= 0 && idx < candidates.length) {
        candidates[idx]!.viewshedRank = Infinity
      }
    }
  }

  // ── Sort by viewshed rank descending, take top N ──────────────────────
  const sorted = [...candidates].sort((a, b) => b.viewshedRank - a.viewshedRank)
  const selected = nWanted >= candidates.length ? sorted : sorted.slice(0, nWanted)
  const total = selected.length

  // ── Handle empty input gracefully ──────────────────────────────────────
  if (total === 0) {
    const elapsedMs = performance.now() - started
    return {
      rasters: new Map(),
      matrix: {
        rowPtr: new Uint32Array(0),
        colIndices: new Uint32Array(0),
        nSites: 0,
        nCells: 0,
      },
      siteNames: [],
      elapsedMs,
    }
  }

  // ── Generate stable site names ─────────────────────────────────────────
  const siteNames: string[] = selected.map((_, i) => `Site-${i}`)

  // ── Launch all coverage computations in parallel ───────────────────────
  // Each call to computeCoverageWithWorkers manages its own worker slice;
  // the worker pool handles parallelism within each computation.  We use
  // Promise.allSettled so a single failure does not abort the entire batch.
  const results = await Promise.allSettled(
    selected.map((site) =>
      computeCoverageWithWorkers(
        dem, demWidth, demHeight, demAffine,
        site.lat, site.lon,
        params, maxRangeKm, numRadials,
      ),
    ),
  )

  // ── Collect successful rasters, skip & warn on failures ────────────────
  const rasters = new Map<string, CoverageRaster>()
  const successfulNames: string[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    const name = siteNames[i]!
    if (result.status === "fulfilled") {
      rasters.set(name, result.value)
      successfulNames.push(name)
    } else {
      console.warn(
        `[matrix-builder] ${name} (lat=${selected[i]!.lat.toFixed(4)}, ` +
          `lon=${selected[i]!.lon.toFixed(4)}) skipped:`,
        result.reason,
      )
    }
    onProgress?.(i + 1, total)
  }

  // ── Build coverage matrix ──────────────────────────────────────────────
  if (rasters.size === 0) {
    throw new Error(
      "All coverage computations failed — no sites available for matrix",
    )
  }

  const matrix = buildCoverageMatrix(rasters, threshold)
  const elapsedMs = performance.now() - started

  return { rasters, matrix, siteNames: successfulNames, elapsedMs }
}
