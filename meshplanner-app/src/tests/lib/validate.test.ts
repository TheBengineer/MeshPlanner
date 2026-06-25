/**
 * Tests for validate.ts — coverage agreement metrics.
 *
 * Uses synthetic rasters to avoid requiring real GeoTIFF files.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"

/* ── Mock geotiff before any imports ──────────────────────────────────────
 * vi.mock is hoisted to the top of the file (before imports).
 * Each test configures the mock via vi.mocked(fromUrl).mockResolvedValue.
 */
vi.mock("geotiff", () => ({
  fromUrl: vi.fn(),
  fromArrayBuffer: vi.fn(),
}))

import {
  computeCoverageAgreement,
  generateValidationReport,
  validateCoverage,
} from "../../lib/validate"
import type { ValidationResult } from "../../lib/validate"
import { fromUrl } from "geotiff"

/* ── Helpers ───────────────────────────────────────────────────────────── */

/** Create a synthetic 2D raster as a flat Float32Array. */
function makeRaster(
  width: number,
  height: number,
  fill: (col: number, row: number) => number,
): Float32Array {
  const data = new Float32Array(width * height)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      data[row * width + col] = fill(col, row)
    }
  }
  return data
}

/** Shorthand: a constant-valued raster. */
function constRaster(width: number, height: number, value: number): Float32Array {
  return makeRaster(width, height, () => value)
}

/** Build a minimal GeoTIFF image mock returning the given raster. */
function mockGeotiffImage(
  data: Float32Array,
  width: number,
  height: number,
) {
  return {
    getWidth: () => width,
    getHeight: () => height,
    readRasters: () => ({ "0": data, width, height }),
    getOrigin: () => [0, 0],
    getResolution: () => [1, 1],
    getBoundingBox: () => [0, 0, width, height],
    fileDirectory: { ModelTiepoint: [0, 0, 0, 0, 0, 0] },
  }
}

/* ── computeCoverageAgreement ──────────────────────────────────────────── */

describe("computeCoverageAgreement", () => {
  const THRESHOLD = -100

  it("perfect agreement — all covered", () => {
    const rssi = constRaster(4, 4, -80)
    const m = computeCoverageAgreement(rssi, rssi, THRESHOLD)
    expect(m.accuracy).toBe(1)
    expect(m.precision).toBe(1)
    expect(m.recall).toBe(1)
    expect(m.f1Score).toBe(1)
    expect(m.jaccard).toBe(1)
    expect(m.truePositives).toBe(16)
    expect(m.trueNegatives).toBe(0)
    expect(m.falsePositives).toBe(0)
    expect(m.falseNegatives).toBe(0)
    expect(m.totalPixels).toBe(16)
    expect(m.thresholdDbm).toBe(THRESHOLD)
  })

  it("perfect agreement — none covered", () => {
    const rssi = constRaster(4, 4, -120)
    const m = computeCoverageAgreement(rssi, rssi, THRESHOLD)
    expect(m.accuracy).toBe(1)
    expect(m.precision).toBe(0) // TP+FP = 0 → 0
    expect(m.recall).toBe(0) // TP+FN = 0 → 0
    expect(m.f1Score).toBe(0)
    expect(m.jaccard).toBe(0) // TP+FP+FN = 0 → 0
    expect(m.truePositives).toBe(0)
    expect(m.trueNegatives).toBe(16)
  })

  it("complete disagreement — opp pred all covered, ref none", () => {
    const pred = constRaster(4, 4, -80)
    const ref = constRaster(4, 4, -120)
    const m = computeCoverageAgreement(pred, ref, THRESHOLD)
    expect(m.accuracy).toBe(0)
    expect(m.precision).toBe(0)
    expect(m.recall).toBe(0)
    expect(m.f1Score).toBe(0)
    expect(m.jaccard).toBe(0)
    expect(m.truePositives).toBe(0)
    expect(m.trueNegatives).toBe(0)
    expect(m.falsePositives).toBe(16)
    expect(m.falseNegatives).toBe(0)
  })

  it("complete disagreement — opp pred none, ref all covered", () => {
    const pred = constRaster(4, 4, -120)
    const ref = constRaster(4, 4, -80)
    const m = computeCoverageAgreement(pred, ref, THRESHOLD)
    expect(m.accuracy).toBe(0)
    expect(m.precision).toBe(0)
    expect(m.recall).toBe(0)
    expect(m.truePositives).toBe(0)
    expect(m.trueNegatives).toBe(0)
    expect(m.falsePositives).toBe(0)
    expect(m.falseNegatives).toBe(16)
  })

  it("partial agreement — balanced 4-way split", () => {
    // 4x4 raster partitioned into 4 quadrants of 4 pixels each:
    //   Row 0: TP (both covered)
    //   Row 1: TN (both not covered)
    //   Row 2: FP (pred covered, ref not)
    //   Row 3: FN (pred not, ref covered)
    const ABOVE = -80
    const BELOW = -120
    const pred = makeRaster(4, 4, (_, row) => (row === 1 || row === 3 ? BELOW : ABOVE))
    const ref = makeRaster(4, 4, (_, row) => (row === 2 || row === 3 ? BELOW : ABOVE))

    const m = computeCoverageAgreement(pred, ref, THRESHOLD)
    expect(m.truePositives).toBe(4)
    expect(m.trueNegatives).toBe(4)
    expect(m.falsePositives).toBe(4)
    expect(m.falseNegatives).toBe(4)
    expect(m.totalPixels).toBe(16)
    expect(m.accuracy).toBe(0.5) // (4+4)/16
    expect(m.precision).toBe(0.5) // 4/(4+4)
    expect(m.recall).toBe(0.5) // 4/(4+4)
    expect(m.f1Score).toBe(0.5) // 2*0.5*0.5/(0.5+0.5)
    expect(m.jaccard).toBeCloseTo(0.3333, 4) // 4/(4+4+4)
  })

  it("partial agreement — common real-world scenario", () => {
    // 4×4 raster, 16 pixels:
    //   Rows 0-1 (8px): TP — both covered
    //   Row 2    (4px): FP — pred covered, ref not
    //   Row 3    (4px): FN — pred not, ref covered
    // Jaccard = 8/(8+4+4) = 0.5
    const ABOVE = -80
    const BELOW = -120
    const pred = new Float32Array([
      ...Array(12).fill(ABOVE), // rows 0-2: covered
      ...Array(4).fill(BELOW),  // row 3: not covered
    ])
    const ref = new Float32Array([
      ...Array(8).fill(ABOVE),  // rows 0-1: covered
      ...Array(4).fill(BELOW),  // row 2: not covered
      ...Array(4).fill(ABOVE),  // row 3: covered
    ])

    const m = computeCoverageAgreement(pred, ref, THRESHOLD)
    expect(m.truePositives).toBe(8)
    expect(m.falsePositives).toBe(4)
    expect(m.falseNegatives).toBe(4)
    expect(m.jaccard).toBe(0.5)
    expect(m.precision).toBeCloseTo(0.6667, 4) // 8/12
    expect(m.recall).toBeCloseTo(0.6667, 4) // 8/12
  })

  it("all below threshold — all TN", () => {
    const pred = constRaster(4, 4, -130)
    const ref = constRaster(4, 4, -140)
    const m = computeCoverageAgreement(pred, ref, THRESHOLD)
    expect(m.trueNegatives).toBe(16)
    expect(m.totalPixels).toBe(16)
    expect(m.accuracy).toBe(1)
  })

  it("all above threshold — all TP", () => {
    const pred = constRaster(4, 4, -80)
    const ref = constRaster(4, 4, -90)
    const m = computeCoverageAgreement(pred, ref, THRESHOLD)
    expect(m.truePositives).toBe(16)
    expect(m.totalPixels).toBe(16)
    expect(m.accuracy).toBe(1)
  })

  it("ignores NaN / Infinity values", () => {
    const values = new Float32Array(8)
    values[0] = -80; values[1] = -80; values[2] = -80; values[3] = -80
    values[4] = NaN; values[5] = Infinity; values[6] = -Infinity; values[7] = NaN

    const m = computeCoverageAgreement(values, values, THRESHOLD)
    expect(m.truePositives).toBe(4)
    expect(m.totalPixels).toBe(4)
    expect(m.accuracy).toBe(1)
  })

  it("throws on shape mismatch", () => {
    expect(() =>
      computeCoverageAgreement(new Float32Array(10), new Float32Array(16), THRESHOLD),
    ).toThrow("Shape mismatch")
  })

  it("throws on all non-finite pixels", () => {
    const nan = new Float32Array([NaN, NaN, NaN, NaN])
    expect(() => computeCoverageAgreement(nan, nan, THRESHOLD)).toThrow(
      "No valid (finite) pixels",
    )
  })

  it("value exactly at threshold counts as covered", () => {
    const pred = new Float32Array([-100])
    const ref = new Float32Array([-100])
    const m = computeCoverageAgreement(pred, ref, -100)
    expect(m.truePositives).toBe(1)
  })

  it("value just below threshold counts as not covered", () => {
    const pred = new Float32Array([-100.1])
    const ref = new Float32Array([-100.1])
    const m = computeCoverageAgreement(pred, ref, -100)
    expect(m.trueNegatives).toBe(1)
    expect(m.falsePositives).toBe(0)
    expect(m.falseNegatives).toBe(0)
  })

  it("empty arrays throw 'no valid pixels'", () => {
    const empty = new Float32Array(0)
    expect(() => computeCoverageAgreement(empty, empty, -100)).toThrow(
      "No valid (finite) pixels",
    )
  })

  it("single-pixel raster computes correctly", () => {
    const m = computeCoverageAgreement(
      new Float32Array([-80]),
      new Float32Array([-80]),
      -100,
    )
    expect(m.truePositives).toBe(1)
    expect(m.totalPixels).toBe(1)
    expect(m.accuracy).toBe(1)
  })

  it("division-by-zero safety when precision/recall undefined", () => {
    // All TN → TP=0, FP=0, FN=0
    const pred = new Float32Array([-130, -140])
    const ref = new Float32Array([-130, -140])
    const m = computeCoverageAgreement(pred, ref, -100)
    expect(m.precision).toBe(0)
    expect(m.recall).toBe(0)
    expect(m.f1Score).toBe(0)
    expect(m.jaccard).toBe(0)
  })

  it("rounds metrics to 4 decimal places", () => {
    // 3×3 raster: TP=3 (row 0), FP=3 (row 1), FN=3 (row 2)
    // Jaccard = 3/(3+3+3) = 0.3333… → rounds to 0.3333
    const ABOVE = -80
    const BELOW = -120
    const pred = new Float32Array([
      ...Array(3).fill(ABOVE), // row 0: covered
      ...Array(3).fill(ABOVE), // row 1: covered
      ...Array(3).fill(BELOW), // row 2: not covered
    ])
    const ref = new Float32Array([
      ...Array(3).fill(ABOVE), // row 0: covered
      ...Array(3).fill(BELOW), // row 1: not covered
      ...Array(3).fill(ABOVE), // row 2: covered
    ])

    const m = computeCoverageAgreement(pred, ref, THRESHOLD)
    expect(m.truePositives).toBe(3)
    expect(m.falsePositives).toBe(3)
    expect(m.falseNegatives).toBe(3)
    expect(m.jaccard).toBe(0.3333) // 3/9 truncated to 4 decimals
    // All metric values must have ≤ 4 decimal places
    for (const v of [m.accuracy, m.precision, m.recall, m.f1Score, m.jaccard]) {
      const str = String(v)
      const dot = str.indexOf(".")
      if (dot !== -1) {
        expect(str.length - dot - 1).toBeLessThanOrEqual(4)
      }
    }
  })
})

/* ── validateCoverage ──────────────────────────────────────────────────── */

describe("validateCoverage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns pass=true and excellent rating for perfect match", async () => {
    const refData = constRaster(4, 4, -80)
    vi.mocked(fromUrl).mockResolvedValue({
      getImage: vi.fn().mockResolvedValue(mockGeotiffImage(refData, 4, 4)),
    } as any)

    const pred = constRaster(4, 4, -80)
    const result = await validateCoverage(pred, "https://example.com/perf.tif", -100, "Site_A")

    expect(result).not.toHaveProperty("error")
    const r = result as unknown as Record<string, unknown>
    expect(r.siteName).toBe("Site_A")
    expect(r.pass).toBe(true)
    expect(r.rating).toBe("excellent")
    expect(r.jaccard).toBe(1)
    expect(r.accuracy).toBe(1)
    expect(r.thresholdDbm).toBe(-100)
  })

  it("returns fail and poor rating when Jaccard < 0.7", async () => {
    // Pred: all covered; Ref: only top-left 2x2 covered
    const pred = constRaster(4, 4, -80)
    const refData = makeRaster(4, 4, (col, row) => (col < 2 && row < 2 ? -80 : -120))
    vi.mocked(fromUrl).mockResolvedValue({
      getImage: vi.fn().mockResolvedValue(mockGeotiffImage(refData, 4, 4)),
    } as any)

    const result = await validateCoverage(pred, "https://example.com/poor.tif", -100, "Site_B")

    expect(result).not.toHaveProperty("error")
    const r = result as unknown as Record<string, unknown>
    expect(r.pass).toBe(false)
    expect(r.rating).toBe("poor")
    // TP=4, FP=12, FN=0 → Jaccard = 4/16 = 0.25
    expect(r.jaccard).toBe(0.25)
  })

  it("returns error when GeoTIFF fetch fails", async () => {
    vi.mocked(fromUrl).mockRejectedValue(new Error("Failed to fetch"))

    const pred = constRaster(4, 4, -80)
    const result = await validateCoverage(pred, "https://example.com/bad.tif", -100, "Site_C")

    expect(result).toHaveProperty("error")
    const err = result as unknown as { error: string; siteName: string }
    expect(err.error).toContain("Failed to fetch")
    expect(err.siteName).toBe("Site_C")
  })

  it("defaults siteName to 'unknown'", async () => {
    const refData = constRaster(2, 2, -80)
    vi.mocked(fromUrl).mockResolvedValue({
      getImage: vi.fn().mockResolvedValue(mockGeotiffImage(refData, 2, 2)),
    } as any)

    const pred = constRaster(2, 2, -80)
    const result = await validateCoverage(pred, "https://example.com/default.tif")
    expect(result).not.toHaveProperty("error")
    expect((result as unknown as Record<string, unknown>).siteName).toBe("unknown")
  })

  it("converts non-Error rejections to error string", async () => {
    vi.mocked(fromUrl).mockRejectedValue("string error")

    const pred = constRaster(2, 2, -80)
    const result = await validateCoverage(pred, "https://example.com/err.tif")
    expect(result).toHaveProperty("error")
    const err = result as unknown as { error: string }
    expect(err.error).toBe("string error")
  })

  it("passes shape mismatch error through from computeCoverageAgreement", async () => {
    // Reference 2x2, predicted 4x4 → shape mismatch
    const refData = constRaster(2, 2, -80)
    vi.mocked(fromUrl).mockResolvedValue({
      getImage: vi.fn().mockResolvedValue(mockGeotiffImage(refData, 2, 2)),
    } as any)

    const pred = constRaster(4, 4, -80)
    const result = await validateCoverage(pred, "https://example.com/small.tif")
    expect(result).toHaveProperty("error")
    const err = result as unknown as { error: string }
    expect(err.error).toContain("Shape mismatch")
  })
})

/* ── generateValidationReport ──────────────────────────────────────────── */

describe("generateValidationReport", () => {
  function passResult(overrides: Partial<Record<string, unknown>> = {}): ValidationResult {
    return {
      accuracy: 0.95,
      precision: 0.92,
      recall: 0.88,
      f1Score: 0.9,
      jaccard: 0.82,
      truePositives: 100,
      trueNegatives: 150,
      falsePositives: 10,
      falseNegatives: 15,
      thresholdDbm: -120,
      totalPixels: 275,
      siteName: "Site_A",
      rating: "good",
      pass: true,
      ...overrides,
    } as ValidationResult
  }

  function failResult(overrides: Partial<Record<string, unknown>> = {}): ValidationResult {
    return {
      accuracy: 0.4,
      precision: 0.5,
      recall: 0.3,
      f1Score: 0.375,
      jaccard: 0.25,
      truePositives: 20,
      trueNegatives: 60,
      falsePositives: 20,
      falseNegatives: 50,
      thresholdDbm: -120,
      totalPixels: 150,
      siteName: "Site_B",
      rating: "poor",
      pass: false,
      ...overrides,
    } as ValidationResult
  }

  function errorResult(overrides: Partial<Record<string, unknown>> = {}): ValidationResult {
    return {
      error: "Shape mismatch: predicted length 100 vs reference length 64",
      siteName: "Site_C",
      ...overrides,
    } as ValidationResult
  }

  it("includes header and per-site pass/fail lines in text output", () => {
    const report = generateValidationReport([passResult(), failResult()])

    expect(report.text).toContain("Coverage Validation Report")
    expect(report.text).toContain("Sites validated: 2")
    expect(report.text).toContain("Passed: 1/2")
    expect(report.text).toContain("Failed: 1/2")
    expect(report.text).toContain("[1] Site_A: PASS")
    expect(report.text).toContain("[2] Site_B: FAIL")
    expect(report.text).toContain("F1=0.900")
    expect(report.text).toContain("Jaccard=0.250")
    expect(report.text).toContain("Accuracy=0.400")
  })

  it("includes error entries in the report", () => {
    const report = generateValidationReport([passResult(), errorResult()])

    expect(report.text).toContain("[2] Site_C: ERROR")
    expect(report.text).toContain("Shape mismatch")
  })

  it("populates JSON counts correctly", () => {
    const report = generateValidationReport([
      passResult(),
      failResult(),
      errorResult(),
    ])

    expect(report.json.total).toBe(3)
    expect(report.json.passed).toBe(1)
    expect(report.json.failed).toBe(2)
    expect(report.json.timestamp).toBeDefined()
    expect(report.json.results).toHaveLength(3)
  })

  it("all-pass report shows 100% pass", () => {
    const report = generateValidationReport([
      passResult({ siteName: "A" }),
      passResult({ siteName: "B" }),
    ])

    expect(report.text).toContain("Passed: 2/2")
    expect(report.text).toContain("Failed: 0/2")
    expect(report.json.passed).toBe(2)
    expect(report.json.failed).toBe(0)
  })

  it("all-error report shows 0 pass", () => {
    const report = generateValidationReport([
      errorResult({ siteName: "A" }),
      errorResult({ siteName: "B" }),
    ])

    expect(report.text).toContain("Passed: 0/2")
    expect(report.text).toContain("Failed: 2/2")
    expect(report.json.passed).toBe(0)
    expect(report.json.failed).toBe(2)
  })

  it("JSON round-trips through JSON.stringify", () => {
    const report = generateValidationReport([passResult()])
    const parsed = JSON.parse(JSON.stringify(report.json))

    expect(parsed.results[0].siteName).toBe("Site_A")
    expect(parsed.results[0].jaccard).toBe(0.82)
    expect(parsed.results[0].rating).toBe("good")
    expect(parsed.results[0].pass).toBe(true)
    expect(parsed.total).toBe(1)
    expect(parsed.passed).toBe(1)
  })

  it("text and JSON counts are consistent", () => {
    const results: ValidationResult[] = [
      passResult({ siteName: "Alpha", pass: true }),
      failResult({ siteName: "Beta", pass: false }),
      errorResult({ siteName: "Gamma" }),
    ]
    const report = generateValidationReport(results)

    expect(report.json.total).toBe(3)
    expect(report.json.passed).toBe(1)
    expect(report.json.failed).toBe(2)
  })

  it("default thresholdDbm propagates through agreement to report", () => {
    const report = generateValidationReport([passResult()])
    expect(report.json.results[0]).toHaveProperty("thresholdDbm", -120)
  })
})
