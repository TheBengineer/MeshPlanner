import { describe, it, expect } from "vitest"
import { rasterToCoverageGeoJson, coverageResultsToCsv } from "@/lib/export/geojson"
import { Affine } from "@/lib/math/affine"

describe("rasterToCoverageGeoJson", () => {
  it("returns a FeatureCollection with polygon features for covered cells", () => {
    // 4x4 raster, all cells covered
    const mask = new Uint8Array(16).fill(1)
    const affine = new Affine(0.01, 0, -82.5, 0, -0.01, 35.6)
    const result = rasterToCoverageGeoJson(mask, 4, 4, affine, 2)

    expect(result.type).toBe("FeatureCollection")
    expect(Array.isArray(result.features)).toBe(true)
    // 4x4 downsampled by 2 => 2x2 output cells = 4 features
    expect(result.features.length).toBe(4)
    for (const f of result.features) {
      expect(f.type).toBe("Feature")
      expect(f.geometry.type).toBe("Polygon")
    }
  })

  it("returns empty FeatureCollection for all-uncovered raster", () => {
    const mask = new Uint8Array(16).fill(0)
    const affine = new Affine(0.01, 0, -82.5, 0, -0.01, 35.6)
    const result = rasterToCoverageGeoJson(mask, 4, 4, affine, 2)
    expect(result.features.length).toBe(0)
  })

  it("handles partial coverage", () => {
    // 4x4, only top-left 2x2 covered
    const mask = new Uint8Array(16)
    mask[0] = 1; mask[1] = 1; mask[4] = 1; mask[5] = 1
    const affine = new Affine(0.01, 0, -82.5, 0, -0.01, 35.6)
    const result = rasterToCoverageGeoJson(mask, 4, 4, affine, 2)
    expect(result.features.length).toBe(1)
  })
})

describe("coverageResultsToCsv", () => {
  it("returns correct CSV header and data rows", () => {
    const csv = coverageResultsToCsv(["Site A", "Site B"], 0.85, 850, 1000, 12.5, -120)
    const lines = csv.split("\n")
    expect(lines[0]).toBe("site,covered_fraction,covered_cells,total_cells,compute_time_s,threshold_dbm")
    expect(lines[1]).toBe('"all",0.8500,850,1000,12.50,-120')
    expect(lines[2]).toBe('"Site A",,,,12.50,-120')
    expect(lines[3]).toBe('"Site B",,,,12.50,-120')
  })
})
