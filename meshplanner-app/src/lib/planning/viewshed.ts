/**
 * Fast geometric viewshed / line-of-sight rank for a peak against a grid of
 * sample points within a bounding box.
 *
 * Pure-math LOS with 4/3 earth-radius curvature correction.  No WASM, no
 * large temporary arrays.
 *
 * @module
 */

import { bilinearInterpolate } from "@/lib/math/interpolation"

// ── Constants ─────────────────────────────────────────────────────────────────

/** Earth mean radius in metres (WGS‑84). */
const EARTH_RADIUS_M = 6_371_000

/** Effective earth radius for 4/3 atmospheric refraction model. */
const R_EFFECTIVE_M = (4 / 3) * EARTH_RADIUS_M

// ── Private geo helpers ──────────────────────────────────────────────────────

/**
 * Great-circle distance in metres (Haversine formula).
 */
function haversineDistanceM(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dlat = (lat2 - lat1) * (Math.PI / 180)
  const dlon = (lon2 - lon1) * (Math.PI / 180)
  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dlon / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Great-circle spherical linear interpolation (slerp).
 * Returns (lat, lon) at *fraction* (0‑1) along the arc from point 1 to 2.
 */
function intermediatePoint(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  fraction: number,
): [number, number] {
  const φ1 = lat1 * (Math.PI / 180)
  const λ1 = lon1 * (Math.PI / 180)
  const φ2 = lat2 * (Math.PI / 180)
  const λ2 = lon2 * (Math.PI / 180)
  const δ = haversineDistanceM(lat1, lon1, lat2, lon2) / EARTH_RADIUS_M

  if (δ < 1e-12) return [lat1, lon1]

  const a = Math.sin((1 - fraction) * δ) / Math.sin(δ)
  const b = Math.sin(fraction * δ) / Math.sin(δ)

  const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2)
  const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2)
  const z = a * Math.sin(φ1) + b * Math.sin(φ2)

  return [
    Math.atan2(z, Math.sqrt(x * x + y * y)) * (180 / Math.PI),
    Math.atan2(y, x) * (180 / Math.PI),
  ]
}

// ── Line-of-sight check ──────────────────────────────────────────────────────

/**
 * Check whether the line-of-sight from point 1 to point 2 is blocked by
 * terrain.  Uses 10 intermediate samples and 4/3 earth curvature correction.
 *
 * @returns ``true`` when the entire path is clear.
 */
function checkLos(
  lat1: number, lon1: number, elev1: number,
  lat2: number, lon2: number,
  dem: Float32Array,
  demWidth: number,
  demHeight: number,
  affine: { a: number; c: number; e: number; f: number },
): boolean {
  const col2 = (lon2 - affine.c) / affine.a
  const row2 = (lat2 - affine.f) / affine.e
  const elev2 = bilinearInterpolate(dem, demWidth, demHeight, col2, row2)
  if (elev2 === null) return false

  const totalDistM = haversineDistanceM(lat1, lon1, lat2, lon2)

  // Coincident or extremely close points are always visible.
  if (totalDistM < 1) return true

  const NUM_STEPS = 10

  for (let k = 1; k < NUM_STEPS; k++) {
    const frac = k / NUM_STEPS
    const [lat, lon] = intermediatePoint(lat1, lon1, lat2, lon2, frac)

    const col = (lon - affine.c) / affine.a
    const row = (lat - affine.f) / affine.e
    const terrainElev = bilinearInterpolate(dem, demWidth, demHeight, col, row)
    if (terrainElev === null) return false

    // Earth curvature correction: at distance d from the observer the
    // earth's surface has "dropped" by d²/(2·R_eff) relative to the
    // horizontal plane.
    const dFromPeakM = frac * totalDistM
    const curvatureDrop = (dFromPeakM * dFromPeakM) / (2 * R_EFFECTIVE_M)

    // Straight-line height between peak and sample at this fraction.
    const losHeight = elev1 + frac * (elev2 - elev1)

    if (terrainElev + curvatureDrop > losHeight) return false
  }

  return true
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the viewshed rank of a peak (hilltop candidate) against a regular
 * sample grid within a bounding box.
 *
 * @param peakLat  Latitude of the peak (EPSG:4326).
 * @param peakLon  Longitude of the peak (EPSG:4326).
 * @param dem      1‑D elevation array in row‑major order (Float32Array).
 * @param demWidth Number of columns (pixels per row).
 * @param demHeight Number of rows.
 * @param affine   Affine transform parameters.  ``.a`` = pixel width in
 *                 degrees, ``.c`` = west edge longitude, ``.e`` = pixel
 *                 height in degrees (negative), ``.f`` = north edge latitude.
 * @param bbox     Geographic bounding box for the sample grid.
 * @param sampleDensity  Number of samples along each axis (default 50 →
 *                       2500 sample points total).
 *
 * @returns A rank in [0, 1] — the fraction of sample points from which the
 *          peak is visible.  Returns ``0`` when the peak itself lies outside
 *          the DEM or on a nodata cell.
 */
export function computeViewshedRank(
  peakLat: number,
  peakLon: number,
  dem: Float32Array,
  demWidth: number,
  demHeight: number,
  affine: { a: number; c: number; e: number; f: number },
  bbox: { west: number; south: number; east: number; north: number },
  sampleDensity = 50,
): number {
  // Resolve peak elevation once (shared by all LOS checks).
  const peakCol = (peakLon - affine.c) / affine.a
  const peakRow = (peakLat - affine.f) / affine.e
  const peakElev = bilinearInterpolate(dem, demWidth, demHeight, peakCol, peakRow)
  if (peakElev === null) return 0

  let visible = 0
  let total = 0

  const dLat = bbox.north - bbox.south
  const dLon = bbox.east - bbox.west

  for (let i = 0; i < sampleDensity; i++) {
    const lat = bbox.south + ((i + 0.5) / sampleDensity) * dLat
    for (let j = 0; j < sampleDensity; j++) {
      const lon = bbox.west + ((j + 0.5) / sampleDensity) * dLon
      total++

      if (
        checkLos(
          peakLat, peakLon, peakElev,
          lat, lon,
          dem, demWidth, demHeight,
          affine,
        )
      ) {
        visible++
      }
    }
  }

  return total > 0 ? visible / total : 0
}
