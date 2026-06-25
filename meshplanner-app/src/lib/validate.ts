/**
 * Coverage validation framework.
 *
 * Compares MeshPlanner coverage predictions against reference tools
 * (Radio Mobile, Splat!, or field measurements).
 *
 * Methodology:
 * 1. Generate coverage prediction with MeshPlanner
 * 2. Load reference coverage from GeoTIFF (same area, resolution, threshold)
 * 3. Compute agreement metrics: accuracy, precision, recall, F1, Jaccard
 * 4. Produce validation report
 *
 * Ported from Python's validate.py (271 LOC).
 */

import { fromArrayBuffer, fromUrl } from "geotiff"

/* ── Types ──────────────────────────────────────────────────────────────── */

export interface AgreementMetrics {
  accuracy: number
  precision: number
  recall: number
  f1Score: number
  jaccard: number
  truePositives: number
  trueNegatives: number
  falsePositives: number
  falseNegatives: number
  thresholdDbm: number
  totalPixels: number
}

export type Rating = "excellent" | "good" | "acceptable" | "poor"

export interface ValidationPassResult extends AgreementMetrics {
  siteName: string
  rating: Rating
  pass: boolean
}

export interface ValidationErrorResult {
  error: string
  siteName: string
}

export type ValidationResult = ValidationPassResult | ValidationErrorResult

export interface ValidationReportJson {
  timestamp: string
  total: number
  passed: number
  failed: number
  results: ValidationResult[]
}

export interface ValidationReport {
  text: string
  json: ValidationReportJson
}

export interface ReferenceRaster {
  rssi: Float32Array
  width: number
  height: number
  metadata: Record<string, unknown>
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function jaccardToRating(jaccard: number): Rating {
  if (jaccard >= 0.9) return "excellent"
  if (jaccard >= 0.8) return "good"
  if (jaccard >= 0.7) return "acceptable"
  return "poor"
}

/* ── Core computation ──────────────────────────────────────────────────── */

/**
 * Compute agreement metrics between predicted and reference coverage.
 *
 * Both rasters must be the same length (flattened 2D arrays).
 * Both are thresholded at `thresholdDbm` to produce binary coverage masks.
 *
 * @param predictedRssi  RSSI raster from MeshPlanner (dBm).
 * @param referenceRssi  RSSI raster from reference tool (dBm).
 * @param thresholdDbm   RSSI threshold for coverage (default -120 dBm for SF10).
 * @returns AgreementMetrics with accuracy, precision, recall, F1, Jaccard, etc.
 */
export function computeCoverageAgreement(
  predictedRssi: ArrayLike<number>,
  referenceRssi: ArrayLike<number>,
  thresholdDbm = -120,
): AgreementMetrics {
  if (predictedRssi.length !== referenceRssi.length) {
    throw new Error(
      `Shape mismatch: predicted length ${predictedRssi.length} vs ` +
        `reference length ${referenceRssi.length}`,
    )
  }

  const len = predictedRssi.length
  let tp = 0
  let tn = 0
  let fp = 0
  let fn = 0
  let validCount = 0

  for (let i = 0; i < len; i++) {
    const p = predictedRssi[i] as number
    const r = referenceRssi[i] as number
    if (!Number.isFinite(p) || !Number.isFinite(r)) continue

    validCount++
    const predCovered = p >= thresholdDbm
    const refCovered = r >= thresholdDbm

    if (predCovered && refCovered) {
      tp++
    } else if (!predCovered && !refCovered) {
      tn++
    } else if (predCovered && !refCovered) {
      fp++
    } else {
      fn++
    }
  }

  if (validCount === 0) {
    throw new Error("No valid (finite) pixels to compare")
  }

  const total = tp + tn + fp + fn
  const accuracy = total > 0 ? (tp + tn) / total : 0
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const f1Score =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0
  const jaccard = tp + fp + fn > 0 ? tp / (tp + fp + fn) : 0

  return {
    accuracy: roundTo(accuracy, 4),
    precision: roundTo(precision, 4),
    recall: roundTo(recall, 4),
    f1Score: roundTo(f1Score, 4),
    jaccard: roundTo(jaccard, 4),
    truePositives: tp,
    trueNegatives: tn,
    falsePositives: fp,
    falseNegatives: fn,
    thresholdDbm,
    totalPixels: total,
  }
}

/* ── GeoTIFF loader ────────────────────────────────────────────────────── */

/**
 * Load a reference coverage GeoTIFF from a URL or ArrayBuffer.
 *
 * Uses the geotiff.js library to parse the file and extract the first
 * band as a Float32Array.
 *
 * @param source  URL string or ArrayBuffer containing GeoTIFF data.
 * @returns ReferenceRaster with the RSSI data, dimensions, and metadata.
 */
export async function loadReferenceGeotiff(
  source: string | ArrayBuffer,
): Promise<ReferenceRaster> {
  const tiff =
    typeof source === "string" ? await fromUrl(source) : await fromArrayBuffer(source)

  const image = await tiff.getImage()
  const raw = await image.readRasters()
  const band = raw[0]

  let rssi: Float32Array
  if (band instanceof Float32Array) {
    rssi = band
  } else {
    rssi = new Float32Array(band as ArrayLike<number>)
  }

  const width = image.getWidth()
  const height = image.getHeight()

  const metadata: Record<string, unknown> = {
    width,
    height,
    origin: image.getOrigin(),
    resolution: image.getResolution(),
    bbox: image.getBoundingBox(),
    ...(image.fileDirectory ? { tags: { ...image.fileDirectory } } : {}),
    source: typeof source === "string" ? source : "(ArrayBuffer)",
  }

  return { rssi, width, height, metadata }
}

/* ── Validation runner ─────────────────────────────────────────────────── */

/**
 * Full validation of a coverage prediction against a reference GeoTIFF.
 *
 * @param predictedRssi  RSSI raster from MeshPlanner.
 * @param referencePath  URL or file path to reference coverage GeoTIFF.
 * @param thresholdDbm   RSSI coverage threshold.
 * @param siteName       Name/ID of the site being validated.
 * @returns ValidationResult with agreement metrics or an error.
 */
export async function validateCoverage(
  predictedRssi: Float32Array,
  referencePath: string,
  thresholdDbm = -120,
  siteName = "unknown",
): Promise<ValidationResult> {
  try {
    const { rssi: referenceRssi } = await loadReferenceGeotiff(referencePath)
    const agreement = computeCoverageAgreement(
      predictedRssi,
      referenceRssi,
      thresholdDbm,
    )

    const rating = jaccardToRating(agreement.jaccard)

    return {
      ...agreement,
      siteName,
      rating,
      pass: agreement.jaccard >= 0.7,
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      siteName,
    }
  }
}

/* ── Report generator ──────────────────────────────────────────────────── */

/**
 * Generate a human-readable validation report.
 *
 * @param results  List of validateCoverage result objects.
 * @returns ValidationReport with both formatted text and JSON output.
 */
export function generateValidationReport(
  results: ValidationResult[],
): ValidationReport {
  const timestamp = new Date().toISOString()

  const passed = results.filter(
    (r) => !("error" in r) && (r as ValidationPassResult).pass,
  ).length
  const failed = results.length - passed

  const lines: string[] = [
    "=".repeat(60),
    "Coverage Validation Report",
    `Generated: ${timestamp}`,
    `Sites validated: ${results.length}`,
    "=".repeat(60),
    `Passed: ${passed}/${results.length}`,
    `Failed: ${failed}/${results.length}`,
    "",
  ]

  for (const [i, result] of results.entries()) {
    if ("error" in result) {
      lines.push(
        `  [${i + 1}] ${result.siteName}: ERROR - ${result.error}`,
      )
    } else {
      const status = result.pass ? "PASS" : "FAIL"
      lines.push(
        `  [${i + 1}] ${result.siteName}: ${status} ` +
          `(F1=${result.f1Score.toFixed(3)}, ` +
          `Jaccard=${result.jaccard.toFixed(3)}, ` +
          `Accuracy=${result.accuracy.toFixed(3)})`,
      )
    }
  }

  return {
    text: lines.join("\n"),
    json: {
      timestamp,
      total: results.length,
      passed,
      failed,
      results,
    },
  }
}
