/**
 * Building-footprint weight array builder.
 *
 * Rasterises building polygons onto the coverage-matrix grid to produce a
 * per-cell weight array.  Cells that contain building centroids receive a
 * higher weight (1 + number of intersecting buildings), biasing the greedy
 * site selector toward areas with structures.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Point-in-polygon (ray casting)
// ---------------------------------------------------------------------------

/**
 * Ray-casting point-in-polygon test.
 *
 * Returns `true` when the point `(lon, lat)` lies inside the polygon defined
 * by an array of `[longitude, latitude]` pairs (GeoJSON convention).
 */
function pointInPolygon(lon: number, lat: number, polygon: [number, number][]): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = polygon[i]!
    const pj = polygon[j]!
    const [xi, yi] = pi
    const [xj, yj] = pj
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a per-cell weight array from building footprint polygons.
 *
 * Each cell in the coverage-matrix grid has its centre tested against every
 * building polygon.  The cell weight is `1 + buildingCount` so cells with
 * multiple overlapping buildings receive proportionally higher weight.
 *
 * The returned `Float32Array` has length `nCells` and can be passed directly
 * to `selectMeshSites` as `opts.cellWeights`.
 *
 * @param buildingCoords  Array of building polygons, each an array of
 *                        `[longitude, latitude]` pairs (closed rings).
 * @param demWidth        DEM pixel width  (number of columns).
 * @param demHeight       DEM pixel height (number of rows).
 * @param affine          DEM affine transform with `.a` (pixel width º),
 *                        `.c` (west edge lon), `.e` (pixel height º,
 *                        negative), `.f` (north edge lat).
 * @param cellSizePx      Size of a matrix cell in DEM pixels (default 4,
 *                        matching `buildCoverageMatrix`).
 * @returns               Float32Array of length `nCells` where each element
 *                        is `1 + number_of_buildings_intersecting_the_cell`.
 */
export function buildCellWeights(
  buildingCoords: [number, number][][],
  demWidth: number,
  demHeight: number,
  affine: { a: number; c: number; f: number; e: number },
  cellSizePx = 4,
): Float32Array {
  const nCols = Math.ceil(demWidth / cellSizePx)
  const nRows = Math.ceil(demHeight / cellSizePx)
  const nCells = nCols * nRows
  const weights = new Float32Array(nCells)

  // Pre-compute cell-centre longitude for every column so we don't re-do the
  // affine maths inside the building loop.
  const colLons = new Float64Array(nCols)
  for (let col = 0; col < nCols; col++) {
    colLons[col] = affine.c + (col + 0.5) * cellSizePx * affine.a
  }

  for (let row = 0; row < nRows; row++) {
    const cellLat = affine.f + (row + 0.5) * cellSizePx * affine.e

    for (let col = 0; col < nCols; col++) {
      const cellLon = colLons[col]!
      let buildingCount = 0

      for (const poly of buildingCoords) {
        if (pointInPolygon(cellLon, cellLat, poly)) {
          buildingCount++
        }
      }

      weights[row * nCols + col] = 1 + buildingCount
    }
  }

  return weights
}
