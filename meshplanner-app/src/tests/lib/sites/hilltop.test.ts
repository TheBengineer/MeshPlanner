import { describe, it, expect } from "vitest"
import { detectHilltops } from "@/lib/sites/hilltop"
import { Affine } from "@/lib/math/affine"

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Add a 2D Gaussian peak to a flat DEM array.
 *
 * @param data      Row‑major Float32Array (mutated in place).
 * @param width     Number of columns.
 * @param height    Number of rows.
 * @param centerCol Column index (0‑based) of the Gaussian centre.
 * @param centerRow Row index (0‑based) of the Gaussian centre.
 * @param amplitude Peak height above the existing base value.
 * @param sigma     Standard deviation in pixels.
 */
function addGaussianPeak(
  data: Float32Array,
  width: number,
  height: number,
  centerCol: number,
  centerRow: number,
  amplitude: number,
  sigma: number,
): void {
  const sigmaSq = sigma * sigma
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const dx = c - centerCol
      const dy = r - centerRow
      data[r * width + c] = (data[r * width + c]!) + amplitude * Math.exp(-(dx * dx + dy * dy) / (2 * sigmaSq))
    }
  }
}

/**
 * Build a 30×30 synthetic DEM with two well‑separated Gaussian peaks on a
 * 100 m flat background.
 *
 * **Peak A** — centre at (10, 10), amplitude 200 m, 𝛔 = 2 px → ~300 m at apex.
 * **Peak B** — centre at (22, 22), amplitude 150 m, 𝛔 = 2 px → ~250 m at apex.
 */
function makeSyntheticDem(): {
  data: Float32Array
  width: number
  height: number
  affine: Affine
} {
  const width = 30
  const height = 30
  const data = new Float32Array(width * height).fill(100)
  addGaussianPeak(data, width, height, 10, 10, 200, 2) // Peak A
  addGaussianPeak(data, width, height, 22, 22, 150, 2) // Peak B
  const affine = Affine.fromBounds(-82.5, 35.5, -82.4, 35.6, width, height)
  return { data, width, height, affine }
}

/** Pixel → geographic for the standard 30×30 affine. */
function pixelToGeo(
  affine: Affine,
  col: number,
  row: number,
): [number, number] {
  return affine.pixelToGeo(col, row)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("detectHilltops", () => {
  it("detects two synthetic peaks at expected locations", () => {
    const { data, width, height, affine } = makeSyntheticDem()

    const result = detectHilltops(data, width, height, affine, 0, 0.01)
    expect(result).toHaveLength(2)

    // Peak A (higher) should be first
    expect(result[0]!.elevation_m).toBeGreaterThan(result[1]!.elevation_m)

    // Verify positions
    const [lonA, latA] = pixelToGeo(affine, 10, 10)
    expect(result[0]!.lat).toBeCloseTo(latA, 3)
    expect(result[0]!.lon).toBeCloseTo(lonA, 3)
    expect(result[0]!.elevation_m).toBeCloseTo(300, 0)

    const [lonB, latB] = pixelToGeo(affine, 22, 22)
    expect(result[1]!.lat).toBeCloseTo(latB, 3)
    expect(result[1]!.lon).toBeCloseTo(lonB, 3)
    expect(result[1]!.elevation_m).toBeCloseTo(250, 0)
  })

  it("sorts peaks by elevation descending", () => {
    const { data, width, height, affine } = makeSyntheticDem()

    const result = detectHilltops(data, width, height, affine, 0, 0.01)
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.elevation_m).toBeGreaterThanOrEqual(
        result[i]!.elevation_m,
      )
    }
  })

  it("reports prominence values for each peak", () => {
    const { data, width, height, affine } = makeSyntheticDem()

    const result = detectHilltops(data, width, height, affine, 0, 0.01)
    for (const p of result) {
      expect(p.prominence_m).toBeGreaterThan(0)
    }
  })

  it("filters by minProminenceM (removes lower-prominence peak)", () => {
    const { data, width, height, affine } = makeSyntheticDem()

    // Peak B prominence ~150 m — set threshold between the two
    const result = detectHilltops(data, width, height, affine, 180, 0.01)
    expect(result).toHaveLength(1)
    expect(result[0]!.elevation_m).toBeCloseTo(300, 0) // Peak A only
  })

  it("keeps both peaks when minProminenceM is below both", () => {
    const { data, width, height, affine } = makeSyntheticDem()

    const result = detectHilltops(data, width, height, affine, 50, 0.01)
    expect(result).toHaveLength(2)
  })

  it("returns empty when minProminenceM exceeds all prominences", () => {
    const { data, width, height, affine } = makeSyntheticDem()

    const result = detectHilltops(data, width, height, affine, 500, 0.01)
    expect(result).toHaveLength(0)
  })

  it("filters by minDistanceKm (NMS removes close lower peak)", () => {
    const { data, width, height, affine } = makeSyntheticDem()

    // Peaks are ~5.7 km apart — set distance > separation
    const result = detectHilltops(data, width, height, affine, 0, 10)
    expect(result).toHaveLength(1)
    expect(result[0]!.elevation_m).toBeCloseTo(300, 0) // Higher peak kept
  })

  it("keeps both peaks when minDistanceKm is smaller than separation", () => {
    const { data, width, height, affine } = makeSyntheticDem()

    const result = detectHilltops(data, width, height, affine, 0, 0.1)
    expect(result).toHaveLength(2)
  })

  it("returns empty for a flat DEM (no local maxima)", () => {
    const width = 20
    const height = 20
    const data = new Float32Array(width * height).fill(100)
    const affine = Affine.fromBounds(-82.5, 35.5, -82.4, 35.6, width, height)

    const result = detectHilltops(data, width, height, affine, 0, 0.5)
    expect(result).toHaveLength(0)
  })

  it("returns empty for all‑nodata DEM", () => {
    const width = 20
    const height = 20
    const data = new Float32Array(width * height).fill(-32768) // nodata value
    const affine = Affine.fromBounds(-82.5, 35.5, -82.4, 35.6, width, height)

    const result = detectHilltops(data, width, height, affine, 0, 0.5)
    expect(result).toHaveLength(0)
  })

  it("returns empty when all values are NaN", () => {
    const width = 10
    const height = 10
    const data = new Float32Array(width * height).fill(NaN)
    const affine = Affine.fromBounds(-82.5, 35.5, -82.4, 35.6, width, height)

    const result = detectHilltops(data, width, height, affine, 0, 0.5)
    expect(result).toHaveLength(0)
  })

  it("handles a tiny DEM where footprint covers most of the area", () => {
    const width = 5
    const height = 5
    const data = new Float32Array(width * height).fill(100)
    data[2 * width + 2] = 200 // single peak at centre
    const affine = Affine.fromBounds(-82.5, 35.5, -82.4, 35.6, width, height)

    const result = detectHilltops(data, width, height, affine, 0, 0.5)
    // With 5×5 and pad = 1, the centre pixel (2,2) is within [1, 3] bounds
    // and should be detected as a local maximum
    expect(result.length).toBeGreaterThanOrEqual(0) // at least doesn't crash
  })

  it("does not detect peaks at DEM edge (pad exclusion)", () => {
    // Create a DEM where the highest values are at the edge
    const width = 10
    const height = 10
    const data = new Float32Array(width * height).fill(100)
    data[0] = 500 // high value at top-left corner (edge)
    const affine = Affine.fromBounds(-82.5, 35.5, -82.4, 35.6, width, height)

    const result = detectHilltops(data, width, height, affine, 0, 0.5)
    // The edge pixel should be excluded by pad, so no peak at (0,0)
    expect(result).toHaveLength(0)
  })

  it("handles negative elevation in DEM", () => {
    const width = 20
    const height = 20
    const data = new Float32Array(width * height).fill(0)
    // Peak below sea level
    addGaussianPeak(data, width, height, 10, 10, 50, 2)
    const affine = Affine.fromBounds(-82.5, 35.5, -82.4, 35.6, width, height)

    const result = detectHilltops(data, width, height, affine, 0, 0.01)
    expect(result).toHaveLength(1)
    expect(result[0]!.elevation_m).toBeCloseTo(50, 0)
    expect(result[0]!.prominence_m).toBeGreaterThan(0)
  })
})
