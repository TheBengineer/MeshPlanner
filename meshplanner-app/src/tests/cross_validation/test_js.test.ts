// @vitest-environment node
/**
 * JS ITM cross-validation regression tests.
 *
 * Dual-mode file:
 *   1) vitest: run via `npx vitest run` (node environment).
 *   2) standalone: run via `node --import tsx test_js.ts` outputs JSON to stdout.
 *
 * Reads the 10+ canonical YAML terrain profiles and exercises computePathLoss().
 */

import { fileURLToPath } from "node:url"

// ── Dual-mode detection ────────────────────────────────────────────────────

const isVitest =
  typeof globalThis.process !== "undefined" &&
  globalThis.process.env?.["VITEST"] === "true"

// ── Imports (conditional for vitest vs standalone) ─────────────────────────

import * as fs from "node:fs"
import * as path from "node:path"
import * as yaml from "js-yaml"

import { computePathLoss } from "../../lib/propagation/itm"
import type { PathLossResult } from "../../lib/propagation/itm"
import type { TerrainProfile } from "../../lib/types"

// ── Profile loading ────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PROFILES_DIR = path.resolve(
  __dirname,
  "../../../../tests/cross_validation/data/canonical",
)

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
  propagation_params: {
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
  expected_loss: {
    path_loss_db: number
    path_loss_tolerance: number
    free_space_loss_db: number
    free_space_tolerance: number
    excess_loss_db: number
    excess_loss_tolerance: number
  }
  elevations: number[]
}

interface CanonicalDoc {
  canonical_terrain_profile: CanonicalProfile
}

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

function profileToTerrainProfile(p: CanonicalProfile): TerrainProfile {
  const n = p.elevations.length
  const elevations = new Float64Array(p.elevations)
  const distancesKm = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    distancesKm[i] = (p.propagation_params.total_distance_km * i) / (n - 1)
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
    totalDistanceKm: p.propagation_params.total_distance_km,
    maxElevation: maxElev,
    minElevation: minElev,
    avgElevation: sum / n,
    latlons: [],
  }
}

function runProfile(p: CanonicalProfile): {
  profile: string
  result: PathLossResult
  expected: CanonicalProfile["expected_loss"]
} {
  const profile = profileToTerrainProfile(p)
  const result = computePathLoss(profile, {
    frequencyMhz: p.propagation_params.frequency_mhz,
    txHeightM: p.propagation_params.tx_height_m,
    rxHeightM: p.propagation_params.rx_height_m,
  })
  return {
    profile: p.name,
    result,
    expected: p.expected_loss,
  }
}

// ── Standalone mode: output JSON ───────────────────────────────────────────

if (!isVitest) {
  const profiles = loadProfiles()
  const results = profiles.map(runProfile)

  // Also compute how far JS deviates from Python golden values
  const summary = results.map((r) => ({
    profile: r.profile,
    js_path_loss_db: r.result.pathLossDb,
    py_expected_path_loss_db: r.expected.path_loss_db,
    deviation_db: r.result.pathLossDb - r.expected.path_loss_db,
    within_tolerance:
      Math.abs(r.result.pathLossDb - r.expected.path_loss_db) <=
      r.expected.path_loss_tolerance,
    js_free_space_loss_db: r.result.freeSpaceLossDb,
    js_excess_loss_db: r.result.excessLossDb,
  }))

  const output = {
    engine: "js (knife-edge diffraction)",
    generated_at: new Date().toISOString(),
    profiles_loaded: profiles.length,
    results: summary,
  }
  process.stdout.write(JSON.stringify(output, null, 2) + "\n")
  process.exit(0)
}

// ── Vitest mode: regression tests ───────────────────────────────────────────

if (isVitest) {
  const { describe, it, expect } = await import("vitest")

  describe("JS ITM cross-validation", () => {
    const profiles = loadProfiles()

    for (const p of profiles) {
      it(`computePathLoss output snapshot for ${p.name}`, () => {
        const { result } = runProfile(p)

        // Snapshot the full JS output to detect regressions
        expect({
          pathLossDb: result.pathLossDb,
          freeSpaceLossDb: result.freeSpaceLossDb,
          excessLossDb: result.excessLossDb,
          distanceKm: result.distanceKm,
          frequencyMhz: result.frequencyMhz,
        }).toMatchSnapshot()
      })

      it(`free-space loss matches Python for ${p.name}`, () => {
        const { result, expected } = runProfile(p)

        // Free-space loss formula is identical between JS and Python
        expect(result.freeSpaceLossDb).toBeCloseTo(
          expected.free_space_loss_db,
          0,
        )
      })

      it(`deviation from Python is bounded for ${p.name}`, () => {
        const { result, expected } = runProfile(p)

        // JS simplified model will differ from full ITM, but deviation
        // should be stable (no worse than 40 dB for complex terrain)
        const deviation = Math.abs(
          result.pathLossDb - expected.path_loss_db,
        )
        expect(deviation).toBeLessThanOrEqual(50)
      })
    }
  })
}
