import type { Affine } from "../math/affine"

/**
 * Convert a binary coverage mask (Uint8Array) to a GeoJSON FeatureCollection
 * of polygon rectangles. Only covered cells (value >= 0.5) are included.
 * Downsampled by cellSizePx for display performance.
 */
export function rasterToCoverageGeoJson(
  mask: Uint8Array | Float32Array,
  width: number,
  height: number,
  affine: Affine,
  cellSizePx = 4,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  const outW = Math.ceil(width / cellSizePx)
  const outH = Math.ceil(height / cellSizePx)

  for (let row = 0; row < outH; row++) {
    for (let col = 0; col < outW; col++) {
      // Check if any pixel in this cell is covered
      let covered = false
      for (let dr = 0; dr < cellSizePx && !covered; dr++) {
        for (let dc = 0; dc < cellSizePx && !covered; dc++) {
          const pixRow = row * cellSizePx + dr
          const pixCol = col * cellSizePx + dc
          if (pixRow >= height || pixCol >= width) continue
          const idx = pixRow * width + pixCol
          const val = mask[idx]
          if (val !== undefined && val >= 0.5) covered = true
        }
      }
      if (!covered) continue

      // Compute lon/lat for this output cell
      const [lon0] = affine.pixelToGeo(col * cellSizePx, row * cellSizePx)
      const [, lat0] = affine.pixelToGeo(col * cellSizePx, row * cellSizePx)
      const [lon1] = affine.pixelToGeo((col + 1) * cellSizePx, row * cellSizePx)
      const [, lat1] = affine.pixelToGeo(col * cellSizePx, (row + 1) * cellSizePx)

      // affine.e is negative -> lat decreases as row increases
      const west = Math.min(lon0, lon1)
      const east = Math.max(lon0, lon1)
      const north = Math.max(lat0, lat1)
      const south = Math.min(lat0, lat1)

      features.push({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [[
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ]],
        },
      })
    }
  }

  return { type: "FeatureCollection", features }
}

/** Format coverage results as CSV text. */
export function coverageResultsToCsv(
  selectedSites: string[],
  coveredFraction: number,
  coveredCells: number,
  totalCells: number,
  computeTimeS: number,
  threshold: number,
): string {
  const lines: string[] = [
    "site,covered_fraction,covered_cells,total_cells,compute_time_s,threshold_dbm",
    `"all",${coveredFraction.toFixed(4)},${coveredCells},${totalCells},${computeTimeS.toFixed(2)},${threshold}`,
  ]
  for (const site of selectedSites) {
    lines.push(`"${site}",,,,${computeTimeS.toFixed(2)},${threshold}`)
  }
  return lines.join("\n")
}

/** Trigger a browser file download. */
export function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Download results as GeoJSON. */
export function downloadGeoJson(fc: GeoJSON.FeatureCollection, filename = "coverage.geojson") {
  downloadBlob(JSON.stringify(fc, null, 2), filename, "application/geo+json")
}

/** Download results as CSV. */
export function downloadCsv(
  selectedSites: string[],
  coveredFraction: number,
  coveredCells: number,
  totalCells: number,
  computeTimeS: number,
  threshold: number,
  filename = "coverage.csv",
) {
  const csv = coverageResultsToCsv(selectedSites, coveredFraction, coveredCells, totalCells, computeTimeS, threshold)
  downloadBlob(csv, filename, "text/csv")
}
