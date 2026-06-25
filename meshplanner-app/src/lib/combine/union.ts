import type { CoverageRaster } from "../types"

export function combineCoverage(rasters: CoverageRaster[], method: "best" | "mean" | "worst" = "best"): CoverageRaster {
  if (!rasters.length) throw new Error("No rasters to combine")
  if (rasters.length === 1) return rasters[0]!

  const first = rasters[0]!
  if (!first) throw new Error("First raster is undefined")
  const { width, height, affine, txLat, txLon, params, maxRangeKm, numRadials } = first
  const result = new Float32Array(width * height)

  for (let i = 0; i < width * height; i++) {
    const values: number[] = []
    for (const r of rasters) {
      const val = r.rssi[i]
      if (val !== undefined && val > -Infinity) values.push(val)
    }
    if (values.length === 0) { result[i] = -Infinity; continue }
    if (method === "best") result[i] = Math.max(...values)
    else if (method === "worst") result[i] = Math.min(...values)
    else result[i] = values.reduce((a, b) => a + b, 0) / values.length
  }

  return { rssi: result, width, height, affine, txLat, txLon, params, maxRangeKm, numRadials }
}

export function combineAtThreshold(rasters: CoverageRaster[], threshold: number, require: "any" | "all" = "any"): Uint8Array {
  const first = rasters[0]
  if (!first) throw new Error("No rasters provided")
  const n = first.width * first.height
  const result = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (require === "any") result[i] = rasters.some(r => (r.rssi[i] ?? -Infinity) >= threshold) ? 1 : 0
    else result[i] = rasters.every(r => (r.rssi[i] ?? -Infinity) >= threshold) ? 1 : 0
  }
  return result
}
