/**
 * Coverage-index query methods for SiteCoverageIndex.
 *
 * Provides point queries (signalsAt, signalsAtLatLon), threshold-based site
 * lookup (sitesCovering), and pairwise overlap measurement (overlapArea).
 *
 * All functions are pure — no store or component imports.
 *
 * @module
 */

import type { CoverageRaster, SiteCoverageIndex } from "../types"

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Bilinear-interpolate the RSSI value at a fractional pixel position within
 * a single coverage raster.  Returns NaN when the point falls outside the
 * raster bounds or the surrounding pixels are missing.
 */
function sampleRaster(raster: CoverageRaster, row: number, col: number): number {
  const { rssi, width, height } = raster

  // Clamp to raster bounds — out-of-range → NaN
  if (row < 0 || row > height - 1 || col < 0 || col > width - 1) {
    return Number.NaN
  }

  const col0 = Math.floor(col)
  const row0 = Math.floor(row)
  const col1 = Math.min(col0 + 1, width - 1)
  const row1 = Math.min(row0 + 1, height - 1)
  const fx = col - col0
  const fy = row - row0

  const v00 = rssi[row0 * width + col0]
  const v10 = rssi[row0 * width + col1]
  const v01 = rssi[row1 * width + col0]
  const v11 = rssi[row1 * width + col1]

  if (v00 === undefined || v10 === undefined || v01 === undefined || v11 === undefined) {
    return Number.NaN
  }

  // Bilinear interpolation: first interpolate along x at row0 and row1,
  // then interpolate those results along y.
  const top = v00 + (v10 - v00) * fx
  const bottom = v01 + (v11 - v01) * fx
  return top + (bottom - top) * fy
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sample every site's coverage raster at the given DEM pixel coordinate.
 *
 * Each raster is sampled via bilinear interpolation at (demRow, demCol)
 * in its own pixel grid.  Returns a Float32Array of length
 * `index.siteNames.length` with signal dBm values; entries where the
 * point is outside the raster bounds are set to NaN.
 *
 * @param index   The site coverage index to query.
 * @param demRow  DEM pixel row (fractional).
 * @param demCol  DEM pixel column (fractional).
 * @returns       Float32Array of signal dBm values (or NaN) per site.
 */
export function signalsAt(index: SiteCoverageIndex, demRow: number, demCol: number): Float32Array {
  const names = index.siteNames
  const result = new Float32Array(names.length)
  for (let i = 0; i < names.length; i++) {
    const raster = index.rasters.get(names[i] ?? "")
    result[i] = raster ? sampleRaster(raster, demRow, demCol) : Number.NaN
  }
  return result
}

/**
 * Sample every site's coverage raster at a geographic (lat, lon) coordinate.
 *
 * Converts the lat/lon to DEM pixel coordinates via the supplied DEM affine,
 * then delegates to {@link signalsAt}.
 *
 * @param index     The site coverage index to query.
 * @param lat       Latitude in degrees.
 * @param lon       Longitude in degrees.
 * @param demAffine DEM-to-geo affine parameters: `a` = pixel width (deg),
 *                  `c` = west edge (deg), `f` = north edge (deg),
 *                  `e` = pixel height (deg, negative for north-up).
 * @returns         Float32Array of signal dBm values (or NaN) per site.
 */
export function signalsAtLatLon(
  index: SiteCoverageIndex,
  lat: number,
  lon: number,
  demAffine: { a: number; c: number; f: number; e: number },
): Float32Array {
  const col = (lon - demAffine.c) / demAffine.a
  const row = (lat - demAffine.f) / demAffine.e
  return signalsAt(index, row, col)
}

/**
 * Return the indices of sites whose signal at the given DEM pixel position
 * meets or exceeds the threshold.
 *
 * @param index     The site coverage index to query.
 * @param demRow    DEM pixel row (fractional).
 * @param demCol    DEM pixel column (fractional).
 * @param threshold Minimum RSSI in dBm.
 * @returns         Array of site indices (into `index.siteNames`).
 */
export function sitesCovering(
  index: SiteCoverageIndex,
  demRow: number,
  demCol: number,
  threshold: number,
): number[] {
  const values = signalsAt(index, demRow, demCol)
  const indices: number[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v !== undefined && v >= threshold) {
      indices.push(i)
    }
  }
  return indices
}

/**
 * Count the overlapping coverage pixels between two named sites.
 *
 * Iterates over every pixel in siteA's raster, maps each pixel's geographic
 * position to siteB's pixel grid via the respective affines, and counts pixels
 * where **both** coverage rasters have an RSSI ≥ `threshold`.
 *
 * Because this function must handle rasters with potentially different
 * dimensions or alignments, each siteA pixel is individually converted to
 * siteB's coordinate space via bilinear interpolation.
 *
 * @param index        The site coverage index.
 * @param siteA        Name of the first site.
 * @param siteB        Name of the second site.
 * @param threshold    RSSI threshold in dBm.
 * @param cellAreaKm2  Area of one DEM pixel in square kilometres (used to
 *                     estimate geographic overlap area).
 * @returns            Overlap pixel count and estimated area in km².
 */
export function overlapArea(
  index: SiteCoverageIndex,
  siteA: string,
  siteB: string,
  threshold: number,
  cellAreaKm2: number,
): { overlapPixels: number; overlapKm2: number } {
  const rasterA = index.rasters.get(siteA)
  const rasterB = index.rasters.get(siteB)

  if (!rasterA || !rasterB) {
    return { overlapPixels: 0, overlapKm2: 0 }
  }

  // Fast path: when both rasters share the same grid (same dimensions and
  // compatible affine), do a straight pixel-wise comparison.
  if (
    rasterA.width === rasterB.width &&
    rasterA.height === rasterB.height &&
    rasterA.affine.a === rasterB.affine.a &&
    rasterA.affine.c === rasterB.affine.c &&
    rasterA.affine.f === rasterB.affine.f &&
    rasterA.affine.e === rasterB.affine.e
  ) {
    let overlapPixels = 0
    const { width, height, rssi: dataA } = rasterA
    const { rssi: dataB } = rasterB
    for (let i = 0; i < width * height; i++) {
      const valA = dataA[i]
      const valB = dataB[i]
      if (valA !== undefined && valA >= threshold && valB !== undefined && valB >= threshold) {
        overlapPixels++
      }
    }
    return { overlapPixels, overlapKm2: overlapPixels * cellAreaKm2 }
  }

  // General path: iterate over siteA's pixels, map each to siteB via geo.
  // Use nearest-neighbour lookup for performance on large rasters.
  const { width: wA, height: hA, rssi: dataA, affine: affA } = rasterA
  const { width: wB, height: hB, rssi: dataB, affine: affB } = rasterB
  let overlapPixels = 0

  for (let row = 0; row < hA; row++) {
    for (let col = 0; col < wA; col++) {
      const valA = dataA[row * wA + col]
      if (valA === undefined || valA < threshold) continue

      // Pixel centre in geographic coordinates via rasterA's affine.
      const lat = affA.f + row * affA.e
      const lon = affA.c + col * affA.a

      // Map to pixel coordinate in rasterB's grid.
      const [bCol, bRow] = affB.geoToPixel(lon, lat)

      // Nearest-neighbour check with bounds guard.
      const bc = Math.round(bCol)
      const br = Math.round(bRow)
      if (bc < 0 || bc >= wB || br < 0 || br >= hB) continue

      const valB = dataB[br * wB + bc]
      if (valB !== undefined && valB >= threshold) {
        overlapPixels++
      }
    }
  }

  return { overlapPixels, overlapKm2: overlapPixels * cellAreaKm2 }
}
