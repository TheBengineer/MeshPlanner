/**
 * Detect hilltop candidate sites from DEM data.
 *
 * Port of Python's `meshplanner.sites.hilltop` — no scipy/numpy dependency.
 * Uses manual sliding-window morphological filters instead of
 * ``scipy.ndimage.maximum_filter``, making it suitable for browser
 * environments.
 *
 * Algorithm:
 * 1. Mask invalid cells (nodata / NaN).
 * 2. Build a circular footprint from *minDistanceKm* and the DEM resolution.
 * 3. Apply maximum / minimum morphological filters to identify local maxima
 *    that are strictly higher than the neighbourhood minimum (excludes flat
 *    plateaus).
 * 4. Convert pixel coordinates to (lat, lon) via the affine transform.
 * 5. **Prominence**: For each candidate (descending elevation), find the
 *    lowest saddle connecting it to any higher peak by sampling elevations
 *    along the great-circle arc. The key saddle is the *highest* of those
 *    minimum-path values. Prominence = peak elevation − key saddle
 *    elevation.
 * 6. Filter by *minProminenceM*.
 * 7. Non-maximum suppression: keep only the highest peak within each
 *    *minDistanceKm* exclusion zone.
 * 8. Sort by elevation descending.
 */

import { Affine } from "@/lib/math/affine"

// ── Constants ─────────────────────────────────────────────────────────────────

/** Elevations below this threshold are treated as invalid (nodata). */
const NODATA_THRESHOLD = -30000

/** Earth mean radius in kilometres (WGS‑84). */
const EARTH_RADIUS_KM = 6371.0

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HilltopResult {
  /** Geographic latitude (EPSG:4326). */
  lat: number
  /** Geographic longitude (EPSG:4326). */
  lon: number
  /** Elevation above sea level in metres. */
  elevation_m: number
  /** Topographic prominence in metres. */
  prominence_m: number
}

// ── Internal peak representation ──────────────────────────────────────────────

interface Peak {
  row: number
  col: number
  lat: number
  lon: number
  elevation: number
  /** Computed topographic prominence (set during step 5). */
  prominence_m: number
}

// ── Geo helpers ───────────────────────────────────────────────────────────────

/**
 * Great-circle distance between two points in kilometres (Haversine formula).
 */
function haversineDistance(
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
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
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

  // Angular distance in radians
  const δ = haversineDistance(lat1, lon1, lat2, lon2) / EARTH_RADIUS_KM

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

// ── Bilinear interpolation (nodata‑safe) ──────────────────────────────────────

/**
 * Sample elevation at sub‑pixel (col, row) using bilinear interpolation.
 *
 * Returns ``null`` if outside the DEM or any surrounding pixel is
 * nodata/NaN.
 */
function bilinearInterpolate(
  dem: Float32Array,
  width: number,
  height: number,
  col: number,
  row: number,
): number | null {
  const ci = Math.floor(col)
  const ri = Math.floor(row)
  const fx = col - ci
  const fy = row - ri

  if (ci < 0 || ri < 0 || ci >= width || ri >= height) return null

  const isValid = (v: number) => v > NODATA_THRESHOLD && Number.isFinite(v)

  const v00 = dem[ri * width + ci]!
  if (!isValid(v00)) return null

  // Right neighbour
  let v10: number
  if (fx > 0) {
    if (ci + 1 >= width) return null
    v10 = dem[ri * width + ci + 1]!
    if (!isValid(v10)) return null
  } else {
    v10 = v00
  }

  // Bottom neighbour
  let v01: number
  if (fy > 0) {
    if (ri + 1 >= height) return null
    v01 = dem[(ri + 1) * width + ci]!
    if (!isValid(v01)) return null
  } else {
    v01 = v00
  }

  // Diagonal neighbour
  let v11: number
  if (fx > 0 && fy > 0) {
    if (ci + 1 >= width || ri + 1 >= height) return null
    v11 = dem[(ri + 1) * width + ci + 1]!
    if (!isValid(v11)) return null
  } else if (fx > 0) {
    v11 = v01
  } else if (fy > 0) {
    v11 = v10
  } else {
    v11 = v00
  }

  const top = v00 + fx * (v10 - v00)
  const bottom = v01 + fx * (v11 - v01)
  return top + fy * (bottom - top)
}

// ── Path‑minimum helper (used for prominence saddle search) ──────────────────

/**
 * Minimum valid elevation along the great‑circle path between two points.
 *
 * Returns ``null`` when every sample is invalid.
 */
function minElevationOnPath(
  dem: Float32Array,
  width: number,
  height: number,
  affine: Affine,
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  numSamples = 50,
): number | null {
  let minVal = Infinity
  let found = false

  for (let i = 0; i < numSamples; i++) {
    const frac = numSamples > 1 ? i / (numSamples - 1) : 0
    const [lat, lon] = intermediatePoint(lat1, lon1, lat2, lon2, frac)

    // Convert geographic → pixel using the affine inverse
    const col = (lon - affine.c) / affine.a
    const row = (lat - affine.f) / affine.e

    const elev = bilinearInterpolate(dem, width, height, col, row)
    if (elev !== null && elev < minVal) {
      minVal = elev
      found = true
    }
  }

  return found ? minVal : null
}

// ── Circular footprint ────────────────────────────────────────────────────────

/**
 * Pre‑compute the (dr, dc) offsets that fall within a circle of *radiusPx*.
 * This avoids repeatedly iterating over empty cells during the sliding window.
 */
function makeCircularFootprintOffsets(radiusPx: number): [number, number][] {
  const radiusSq = radiusPx * radiusPx
  const offsets: [number, number][] = []
  for (let dr = -radiusPx; dr <= radiusPx; dr++) {
    for (let dc = -radiusPx; dc <= radiusPx; dc++) {
      if (dr * dr + dc * dc <= radiusSq) {
        offsets.push([dr, dc])
      }
    }
  }
  return offsets
}

/**
 * Compute the average pixel size in kilometres at a given latitude.
 * Accounts for the varying length of a degree of longitude.
 */
function computePixelSizeKm(affine: Affine, centerLat: number): number {
  const latRad = centerLat * (Math.PI / 180)
  const kmPerDegLat = 111.32
  const kmPerDegLon = 111.32 * Math.cos(latRad)

  const pxWidthKm = Math.abs(affine.a) * kmPerDegLon
  const pxHeightKm = Math.abs(affine.e) * kmPerDegLat
  return (pxWidthKm + pxHeightKm) / 2
}

// ── Morphological filters (manual sliding window — no scipy) ──────────────────

/**
 * Manual maximum filter over a circular neighbourhood.
 *
 * For each cell, finds the maximum value among neighbours within the
 * pre‑computed *offsets* (from ``makeCircularFootprintOffsets``).
 */
function maximumFilter(
  data: Float32Array,
  width: number,
  height: number,
  offsets: [number, number][],
): Float32Array {
  const result = new Float32Array(width * height)
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let maxVal = -Infinity
      for (const [dr, dc] of offsets) {
        const nr = r + dr
        const nc = c + dc
        if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
          const v = data[nr * width + nc]!
          if (v > maxVal) maxVal = v
        }
      }
      result[r * width + c] = maxVal
    }
  }
  return result
}

/**
 * Manual minimum filter over a circular neighbourhood.
 */
function minimumFilter(
  data: Float32Array,
  width: number,
  height: number,
  offsets: [number, number][],
): Float32Array {
  const result = new Float32Array(width * height)
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let minVal = Infinity
      for (const [dr, dc] of offsets) {
        const nr = r + dr
        const nc = c + dc
        if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
          const v = data[nr * width + nc]!
          if (v < minVal) minVal = v
        }
      }
      result[r * width + c] = minVal
    }
  }
  return result
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Find local elevation maxima in a DEM.
 *
 * @param demData   1‑D elevation array in row‑major order (Float32Array).
 * @param demWidth  Number of columns (pixels per row).
 * @param demHeight Number of rows.
 * @param affine    Affine transform (EPSG:4326) mapping pixel → geographic.
 * @param minProminenceM  Minimum topographic prominence in metres (default 50).
 * @param minDistanceKm   Minimum separation between distinct peaks in km
 *                        (default 0.5).  Also drives the footprint radius.
 *
 * @returns Array of {@link HilltopResult} sorted by descending elevation.
 *          Empty when there are no valid data or no peaks satisfy the filters.
 */
export function detectHilltops(
  demData: Float32Array,
  demWidth: number,
  demHeight: number,
  affine: Affine,
  minProminenceM = 50.0,
  minDistanceKm = 0.5,
): HilltopResult[] {
  const rows = demHeight
  const cols = demWidth

  // ── 1.  Valid‑data mask ──────────────────────────────────────────
  const valid = new Uint8Array(demData.length)
  let anyValid = false
  for (let i = 0; i < demData.length; i++) {
    const v = demData[i]!
    if (Number.isFinite(v) && v > NODATA_THRESHOLD) {
      valid[i] = 1
      anyValid = true
    }
  }
  if (!anyValid) return []

  // ── 2.  Footprint ────────────────────────────────────────────────
  const centerLat = affine.f + (rows / 2) * affine.e
  const pixelSizeKm = computePixelSizeKm(affine, centerLat)
  const radiusPx = Math.max(1, Math.round(minDistanceKm / pixelSizeKm))
  const offsets = makeCircularFootprintOffsets(radiusPx)
  const pad = radiusPx

  // ── 3.  Fill invalid cells with sentinel values for filtering ────
  // Invalid cells → −Inf for max filter (never picked as maximum),
  //                +Inf for min filter (never picked as minimum).
  const demFilled = new Float32Array(demData)
  const demMinInput = new Float32Array(demData)
  for (let i = 0; i < demData.length; i++) {
    if (!valid[i]) {
      demFilled[i] = -Infinity
      demMinInput[i] = Infinity
    }
  }

  // ── 4.  Maximum / minimum morphological filters ──────────────────
  const demMax = maximumFilter(demFilled, cols, rows, offsets)
  const demMin = minimumFilter(demMinInput, cols, rows, offsets)

  // ── 5.  Detect local maxima ──────────────────────────────────────
  // A true peak:
  //   · equals its neighbourhood maximum,
  //   · is strictly greater than the neighbourhood minimum (→ excludes flat
  //     plateaus), and
  //   · is a valid cell.
  // Cells within `pad` pixels of the DEM edge are excluded because the
  // truncated neighbourhood creates false positives.  Skip the exclusion
  // when the footprint is larger than half the grid (nothing would pass).
  const edgePad = pad < Math.min(rows, cols) / 2 ? pad : 0
  const isPeak = new Uint8Array(demData.length)
  for (let r = edgePad; r < rows - edgePad; r++) {
    for (let c = edgePad; c < cols - edgePad; c++) {
      const idx = r * cols + c
      if (
        valid[idx] &&
        demFilled[idx]! === demMax[idx]! &&
        demFilled[idx]! > demMin[idx]!
      ) {
        isPeak[idx] = 1
      }
    }
  }

  // Collect peak cells
  const peaks: Peak[] = []
  for (let r = edgePad; r < rows - edgePad; r++) {
    for (let c = edgePad; c < cols - edgePad; c++) {
      const idx = r * cols + c
      if (isPeak[idx]) {
        const [lon, lat] = affine.pixelToGeo(c, r)
        peaks.push({
          row: r,
          col: c,
          lat,
          lon,
          elevation: demData[idx]!,
          prominence_m: 0, // placeholder, computed below
        })
      }
    }
  }

  if (peaks.length === 0) return []

  // ── 6.  Sort by elevation descending ─────────────────────────────
  peaks.sort((a, b) => b.elevation - a.elevation)

  // ── 7.  Prominence computation ───────────────────────────────────
  // The key saddle for peak P is the highest of the lowest points on
  // all paths from P to a *higher* peak.  For the overall highest peak
  // we approximate the key saddle by checking paths to the DEM boundary
  // (its "island parent").
  //
  // Performance: checking all higher peaks is O(n²) and becomes
  // impractical.  We check the 30 nearest higher peaks by spatial
  // proximity.  For most topographic settings the key saddle lies close
  // to the peak, so this approximation is accurate.

  // Boundary points used for the highest‑peak case.
  const boundaryPts: [number, number][] = [
    [0, 0],
    [0, cols - 1],
    [rows - 1, 0],
    [rows - 1, cols - 1],
    [rows >> 1, 0],
    [rows >> 1, cols - 1],
    [0, cols >> 1],
    [rows - 1, cols >> 1],
  ]

  for (let i = 0; i < peaks.length; i++) {
    const peak = peaks[i]!

    if (i === 0) {
      // ── Highest peak — check paths to DEM boundary ──────
      const saddleVals: number[] = []
      for (const [br, bc] of boundaryPts) {
        const lat2 = affine.f + br * affine.e
        const lon2 = affine.c + bc * affine.a
        const minE = minElevationOnPath(
          demData, cols, rows, affine,
          peak.lat, peak.lon, lat2, lon2,
          100,
        )
        if (minE !== null) saddleVals.push(minE)
      }

      if (saddleVals.length > 0 && peak.elevation > Math.max(...saddleVals)) {
        peak.prominence_m = peak.elevation - Math.max(...saddleVals)
      } else {
        peak.prominence_m = peak.elevation
      }
    } else {
      // ── Lower peaks — check nearby higher peaks ─────────
      // Compute squared‑distance proximity to find the 30 nearest
      // neighbours (substitutes for scipy.spatial.KDTree which is
      // not available in the browser).
      const MAX_K = 31
      const distances: { idx: number; distSq: number }[] = []
      for (let j = 0; j < peaks.length; j++) {
        const p = peaks[j]!
        distances.push({
          idx: j,
          distSq: (p.lat - peak.lat) ** 2 + (p.lon - peak.lon) ** 2,
        })
      }
      // Sort by proximity (stable for equal distances — not critical).
      distances.sort((a, b) => a.distSq - b.distSq)

      const higherIndices: number[] = []
      const limit = Math.min(MAX_K, distances.length)
      for (let k = 0; k < limit; k++) {
        if (distances[k]!.idx < i) {
          higherIndices.push(distances[k]!.idx)
        }
      }

      // If none of the nearest 30 are higher, fall back to
      // checking ALL higher peaks (rare for large N, but can
      // happen for the second‑highest peak when widely spaced).
      if (higherIndices.length === 0) {
        for (let j = 0; j < i; j++) higherIndices.push(j)
      }

      const saddleCandidates: number[] = []
      for (const j of higherIndices) {
        const higher = peaks[j]!
        const minOnPath = minElevationOnPath(
          demData, cols, rows, affine,
          peak.lat, peak.lon,
          higher.lat, higher.lon,
          50,
        )
        if (minOnPath !== null) saddleCandidates.push(minOnPath)
      }

      if (saddleCandidates.length > 0) {
        peak.prominence_m = peak.elevation - Math.max(...saddleCandidates)
      } else {
        peak.prominence_m = peak.elevation
      }
    }

    peak.prominence_m = Math.max(0, peak.prominence_m)
  }

  // ── 8.  Filter by minimum prominence ────────────────────────────
  const prominentPeaks = peaks.filter(p => p.prominence_m >= minProminenceM)

  // ── 9.  Non‑maximum suppression by minimum distance ──────────────
  const kept: Peak[] = []
  for (const p of prominentPeaks) {
    const tooClose = kept.some(
      k => haversineDistance(p.lat, p.lon, k.lat, k.lon) < minDistanceKm,
    )
    if (!tooClose) kept.push(p)
  }

  // ── 10.  Return clean result dicts ───────────────────────────────
  return kept.map(p => ({
    lat: p.lat,
    lon: p.lon,
    elevation_m: p.elevation,
    prominence_m: p.prominence_m,
  }))
}
