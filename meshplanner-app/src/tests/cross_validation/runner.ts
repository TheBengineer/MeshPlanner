// @vitest-environment node
/**
 * TypeScript cross-validation runner for ITM path loss.
 *
 * Loads canonical terrain profiles (YAML), runs the JS ITM port
 * (computePathLoss), and compares output to Python golden data
 * from pytest-regressions (YAML).  Reports pass/fail per profile
 * with configurable tolerance (target: ±3 dB).
 *
 * Usage (vitest):
 *   import { runAllValidations } from './runner'
 *   const { passed, failed } = runAllValidations()
 *
 * Usage (standalone):
 *   node --import tsx runner.ts
 */

import { readFileSync, readdirSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { load } from "js-yaml"
import { computePathLoss } from "../../lib/propagation/itm"
import type { TerrainProfile } from "../../lib/types"

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** Repo root — 4 levels up from src/tests/cross_validation/ */
const REPO_ROOT = resolve(__dirname, "../../../../")

/** Directory containing the 10 canonical YAML profile files. */
const CANONICAL_DIR = join(REPO_ROOT, "tests/cross_validation/data/canonical")

/** Directory containing pytest-regressions golden YAML files. */
const GOLDEN_DIR = join(REPO_ROOT, "tests/cross_validation/test_python")

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CanonicalProfile {
  name: string
  terrain_type: string
  lat1: number
  lon1: number
  lat2: number
  lon2: number
  elevations: number[]
  total_distance_km: number
  frequency_mhz: number
  tx_height_m: number
  rx_height_m: number
  expected_loss_range: [number, number]
}

export interface ValidationResult {
  profile: string
  terrainType: string
  pythonLossDb: number
  jsLossDb: number
  deltaDb: number
  pass: boolean
}

// ---------------------------------------------------------------------------
// Internal types (raw YAML structure)
// ---------------------------------------------------------------------------

interface RawExpectedLoss {
  path_loss_db: number
  path_loss_tolerance: number
  free_space_loss_db: number
  free_space_tolerance: number
  excess_loss_db: number
  excess_loss_tolerance: number
}

interface RawPropagationParams {
  total_distance_km: number
  frequency_mhz: number
  tx_height_m: number
  rx_height_m: number
  polarization: number
  climate: number
  ground_permittivity: number
  ground_conductivity: number
  surface_refractivity: number
}

interface RawEndpoints {
  lat_start: number
  lon_start: number
  lat_end: number
  lon_end: number
}

interface RawProfile {
  version: number
  name: string
  terrain_type: string
  description: string
  endpoints: RawEndpoints
  propagation_params: RawPropagationParams
  expected_loss: RawExpectedLoss
  elevations: number[]
}

interface RawDoc {
  canonical_terrain_profile: RawProfile
}

/** Shape of a pytest-regressions golden data YAML file. */
interface GoldenData {
  profile: string
  path_loss_db: number
  free_space_loss_db: number
  excess_loss_db: number
  distance_km: number
  frequency_mhz: number
}

// ---------------------------------------------------------------------------
// Profile loading
// ---------------------------------------------------------------------------

/**
 * Flatten a raw YAML profile into the simplified CanonicalProfile shape.
 */
function flattenProfile(raw: RawProfile): CanonicalProfile {
  const p = raw.propagation_params
  const e = raw.expected_loss
  return {
    name: raw.name,
    terrain_type: raw.terrain_type,
    lat1: raw.endpoints.lat_start,
    lon1: raw.endpoints.lon_start,
    lat2: raw.endpoints.lat_end,
    lon2: raw.endpoints.lon_end,
    elevations: raw.elevations,
    total_distance_km: p.total_distance_km,
    frequency_mhz: p.frequency_mhz,
    tx_height_m: p.tx_height_m,
    rx_height_m: p.rx_height_m,
    expected_loss_range: [e.path_loss_db, e.path_loss_tolerance],
  }
}

/**
 * Load all canonical terrain profiles from disk.
 *
 * Reads every `*.yaml` file under `CANONICAL_DIR`, parses it, and
 * returns a sorted array of flattened `CanonicalProfile` objects.
 */
export function loadProfiles(): CanonicalProfile[] {
  const files = readdirSync(CANONICAL_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort()

  const profiles: CanonicalProfile[] = []
  for (const file of files) {
    const raw = readFileSync(join(CANONICAL_DIR, file), "utf-8")
    const doc = load(raw) as RawDoc
    profiles.push(flattenProfile(doc.canonical_terrain_profile))
  }
  return profiles
}

// ---------------------------------------------------------------------------
// Golden data loading
// ---------------------------------------------------------------------------

/**
 * Load the Python golden path_loss_db for a given profile name.
 *
 * The golden data was generated by `pytest-regressions` and stored as
 * a flat YAML file at `tests/cross_validation/test_python/<name>.yml`.
 *
 * @param profileName — profile name (e.g. "flat", "mountain_ridge")
 * @returns The Python reference `path_loss_db` value.
 */
export function loadGoldenData(profileName: string): number {
  const filePath = join(GOLDEN_DIR, `${profileName}.yml`)
  const raw = readFileSync(filePath, "utf-8")
  const golden = load(raw) as GoldenData
  return golden.path_loss_db
}

// ---------------------------------------------------------------------------
// Profile conversion
// ---------------------------------------------------------------------------

/**
 * Convert a CanonicalProfile to the TerrainProfile type expected by
 * computePathLoss.
 */
function toTerrainProfile(p: CanonicalProfile): TerrainProfile {
  const n = p.elevations.length
  const elevations = new Float64Array(p.elevations)
  const distancesKm = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    distancesKm[i] = (p.total_distance_km * i) / (n - 1)
  }

  let maxElev = -Infinity
  let minElev = Infinity
  let sum = 0
  for (const e of p.elevations) {
    if (e > maxElev) maxElev = e
    if (e < minElev) minElev = e
    sum += e
  }

  return {
    elevations,
    distancesKm,
    totalDistanceKm: p.total_distance_km,
    maxElevation: maxElev,
    minElevation: minElev,
    avgElevation: sum / n,
    latlons: [],
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a single canonical profile against Python golden data.
 *
 * Runs the JS `computePathLoss` for the given profile, loads the
 * corresponding Python golden value, and compares the two.
 *
 * @param profile — the canonical profile to validate
 * @returns A ValidationResult with JS/Python values and pass/fail verdict.
 */
export function validateProfile(profile: CanonicalProfile): ValidationResult {
  const terrain = toTerrainProfile(profile)
  const result = computePathLoss(terrain, {
    frequencyMhz: profile.frequency_mhz,
    txHeightM: profile.tx_height_m,
    rxHeightM: profile.rx_height_m,
  })

  const pyLoss = loadGoldenData(profile.name)
  const deltaDb = Math.round((result.pathLossDb - pyLoss) * 100) / 100

  return {
    profile: profile.name,
    terrainType: profile.terrain_type,
    pythonLossDb: pyLoss,
    jsLossDb: result.pathLossDb,
    deltaDb,
    pass: false, // caller sets pass/fail based on tolerance
  }
}

// ---------------------------------------------------------------------------
// Batch runner
// ---------------------------------------------------------------------------

/**
 * Run cross-validation for all canonical profiles.
 *
 * @param toleranceDb — maximum acceptable absolute deviation in dB (default 3.0)
 * @returns Aggregated results including pass/fail counts.
 */
export function runAllValidations(
  toleranceDb: number = 3.0,
): {
  results: ValidationResult[]
  passed: number
  failed: number
  total: number
} {
  const profiles = loadProfiles()
  const results: ValidationResult[] = []

  for (const p of profiles) {
    const vr = validateProfile(p)
    vr.pass = Math.abs(vr.deltaDb) <= toleranceDb
    results.push(vr)
  }

  let passed = 0
  let failed = 0
  for (const r of results) {
    if (r.pass) passed++
    else failed++
  }

  return { results, passed, failed, total: results.length }
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const maxTolerance = parseFloat(process.argv[2] ?? "3")
  const { results, passed, failed, total } = runAllValidations(maxTolerance)

  const report = {
    engine: "js (full ITM / Longley-Rice)",
    tolerance_db: maxTolerance,
    generated_at: new Date().toISOString(),
    profiles_loaded: total,
    summary: { passed, failed, total },
    results: results.map((r) => ({
      profile: r.profile,
      terrain_type: r.terrainType,
      python_loss_db: r.pythonLossDb,
      js_loss_db: r.jsLossDb,
      delta_db: r.deltaDb,
      pass: r.pass,
    })),
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (failed > 0) {
    process.exit(1)
  }
}
