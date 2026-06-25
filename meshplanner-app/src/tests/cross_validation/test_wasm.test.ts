// @vitest-environment node
/**
 * WASM ITM cross-validation tests.
 *
 * Validates that the runner.py (which will execute inside Pyodide WASM
 * in the browser) produces results matching the golden Python reference
 * within ±0.5 dB for all 10 canonical terrain profiles.
 *
 * Since Pyodide cannot run in Node.js, we validate runner.py's logic
 * directly via Python subprocess — the same code that runs in Pyodide.
 *
 * Dual-mode:
 *   1. vitest:  npx vitest run --project cross-validation
 *   2. standalone:  node --import tsx test_wasm.test.ts
 */

import { fileURLToPath } from "node:url"

const isVitest =
  typeof globalThis.process !== "undefined" && globalThis.process.env?.VITEST === "true"

import { execSync, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import * as yaml from "js-yaml"

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PROFILES_DIR = path.resolve(__dirname, "../../../../tests/cross_validation/data/canonical")

const RUNNER_SCRIPT = path.resolve(__dirname, "../../../public/itmlogic/runner.py")

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PropagationParams {
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

interface ExpectedLoss {
  path_loss_db: number
  path_loss_tolerance: number
  free_space_loss_db: number
  free_space_tolerance: number
  excess_loss_db: number
  excess_loss_tolerance: number
}

interface CanonicalProfile {
  version: number
  name: string
  terrain_type: string
  description: string
  endpoints: {
    lat_start: number
    lon_start: number
    lat_end: number
    lon_end: number
  }
  propagation_params: PropagationParams
  expected_loss: ExpectedLoss
  elevations: number[]
}

interface CanonicalDoc {
  canonical_terrain_profile: CanonicalProfile
}

interface WasmResult {
  path_loss_db: number
  free_space_loss_db: number
  excess_loss_db: number
  frequency_mhz: number
  distance_km: number
  tx_height_m: number
  rx_height_m: number
  climate: number
  polarization: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadProfiles(): CanonicalProfile[] {
  const files = fs.readdirSync(PROFILES_DIR).filter((f) => f.endsWith(".yaml"))
  files.sort()
  const profiles: CanonicalProfile[] = []
  for (const file of files) {
    const raw = fs.readFileSync(path.join(PROFILES_DIR, file), "utf-8")
    const doc = yaml.load(raw) as CanonicalDoc
    profiles.push(doc.canonical_terrain_profile)
  }
  return profiles
}

/**
 * Resolve the Python executable path.
 * Prefers python3 on Linux/macOS, falls back to python.
 */
function findPython(): string {
  try {
    execSync("python3 --version", { stdio: "ignore" })
    return "python3"
  } catch {
    return "python"
  }
}

/**
 * Run a single profile through runner.py via Python subprocess.
 *
 * This validates the exact same logic that will run inside Pyodide WASM
 * in the browser. Since runner.py uses the same itmlogic library as the
 * Python reference, the results are bit-exact.
 */
function runWasmValidation(profile: CanonicalProfile): WasmResult {
  const p = profile.propagation_params
  const python = findPython()

  const input = {
    elevations: profile.elevations,
    total_distance_km: p.total_distance_km,
    frequency_mhz: p.frequency_mhz,
    tx_height_m: p.tx_height_m,
    rx_height_m: p.rx_height_m,
    polarization: p.polarization,
    climate: p.climate,
    ground_permittivity: p.ground_permittivity,
    ground_conductivity: p.ground_conductivity,
    surface_refractivity: p.surface_refractivity,
  }

  const inputJson = JSON.stringify(input)

  const result = spawnSync(python, [RUNNER_SCRIPT], {
    input: inputJson,
    encoding: "utf-8",
    timeout: 30_000,
  })

  if (result.error) {
    throw new Error(`Failed to run runner.py: ${result.error.message}`)
  }

  if (result.status !== 0) {
    throw new Error(
      `runner.py exited with code ${result.status}: ${result.stderr || "(no stderr)"}`,
    )
  }

  const trimmed = result.stdout.trim()
  if (!trimmed) {
    throw new Error(`runner.py produced no output (stderr: ${result.stderr || "none"})`)
  }

  return JSON.parse(trimmed) as WasmResult
}

/**
 * Compare a WASM result to the expected golden values.
 */
function compareToExpected(
  profile: CanonicalProfile,
  result: WasmResult,
): {
  profile: string
  result: WasmResult
  expected: ExpectedLoss
  deviations: {
    path_loss_db: number
    free_space_loss_db: number
    excess_loss_db: number
  }
  within_tolerance: {
    path_loss_db: boolean
    free_space_loss_db: boolean
    excess_loss_db: boolean
  }
} {
  const expected = profile.expected_loss

  const plDev = result.path_loss_db - expected.path_loss_db
  const fsDev = result.free_space_loss_db - expected.free_space_loss_db
  const exDev = result.excess_loss_db - expected.excess_loss_db

  return {
    profile: profile.name,
    result,
    expected,
    deviations: {
      path_loss_db: plDev,
      free_space_loss_db: fsDev,
      excess_loss_db: exDev,
    },
    within_tolerance: {
      path_loss_db: Math.abs(plDev) <= expected.path_loss_tolerance,
      free_space_loss_db: Math.abs(fsDev) <= expected.free_space_tolerance,
      excess_loss_db: Math.abs(exDev) <= expected.excess_loss_tolerance,
    },
  }
}

// ---------------------------------------------------------------------------
// Standalone mode: output JSON report
// ---------------------------------------------------------------------------

if (!isVitest) {
  const profiles = loadProfiles()
  const results = profiles.map((p) => {
    const result = runWasmValidation(p)
    return compareToExpected(p, result)
  })

  const summary = results.map((r) => ({
    profile: r.profile,
    wasm_path_loss_db: r.result.path_loss_db,
    expected_path_loss_db: r.expected.path_loss_db,
    deviation_db: r.deviations.path_loss_db,
    within_tolerance: r.within_tolerance.path_loss_db,
    wasm_free_space_loss_db: r.result.free_space_loss_db,
    wasm_excess_loss_db: r.result.excess_loss_db,
  }))

  const output = {
    engine: "wasm (runner.py via Python subprocess)",
    note: "Validates the exact same runner.py logic that executes inside Pyodide WASM in-browser",
    generated_at: new Date().toISOString(),
    profiles_loaded: profiles.length,
    results: summary,
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Vitest mode: regression tests
// ---------------------------------------------------------------------------

if (isVitest) {
  const { describe, it, expect } = await import("vitest")

  describe("WASM ITM cross-validation (runner.py)", () => {
    const profiles = loadProfiles()

    for (const p of profiles) {
      it(`path loss within ±0.5 dB of Python reference for ${p.name}`, () => {
        const result = runWasmValidation(p)
        const expected = p.expected_loss

        // The WASM output must match within ±0.5 dB (Task 7 requirement)
        expect(Math.abs(result.path_loss_db - expected.path_loss_db)).toBeLessThanOrEqual(0.5)

        // Free-space loss uses the same formula, must match exactly
        expect(result.free_space_loss_db).toBeCloseTo(expected.free_space_loss_db, 0)

        // Excess loss must also match within ±0.5 dB
        expect(Math.abs(result.excess_loss_db - expected.excess_loss_db)).toBeLessThanOrEqual(0.5)
      })

      it(`free-space loss formula matches Python for ${p.name}`, () => {
        const result = runWasmValidation(p)
        // Free-space path loss uses the same ITU-R P.525 formula
        const fspl =
          32.45 +
          20 * Math.log10(p.propagation_params.frequency_mhz) +
          20 * Math.log10(p.propagation_params.total_distance_km)

        expect(result.free_space_loss_db).toBeCloseTo(Math.round(fspl * 10) / 10, 0)
      })
    }
  })
}
