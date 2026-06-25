/**
 * Sensitivity analysis for optimization parameters.
 *
 * Re-runs the site-selection optimizer under pessimistic, nominal, and
 * optimistic parameter assumptions to quantify how coverage changes when
 * input assumptions vary.  This is useful for:
 *
 * - Evaluating robustness of a site plan against RSSI estimation errors.
 * - Understanding how spreading-factor choices affect the solution.
 * - Reporting a "coverage range" rather than a single point estimate to
 *   decision-makers.
 *
 * Typical usage:
 *
 * ```ts
 * import { buildCoverageMatrix } from './matrix'
 * import { sensitivityMinSites, createScenarios } from './sensitivity'
 *
 * const matrix = buildCoverageMatrix(rasters, -120, 4)
 * const scenarios = createScenarios(-120)
 * const result = await sensitivityMinSites(matrix, names, 0.95, scenarios)
 * console.log(`Coverage range: ${result.range.min} – ${result.range.max}`)
 * ```
 *
 * @module
 */

import type { CoverageMatrix, OptimizationResult } from '../types'
import { warmStartMinSites, warmStartMaxCoverage } from './warmstart'
import type { WarmStartOptions } from './warmstart'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A single scenario definition. */
export interface Scenario {
  /** Scenario label (e.g. "optimistic", "nominal", "pessimistic"). */
  name: string
  /** RSSI threshold in dBm (e.g. -125 for optimistic, -120 nominal, -115 pessimistic). */
  threshold: number
  /** Coverage target (fraction 0–1). Only meaningful for min-sites. */
  target: number
  /** Optional cell weights for max-coverage mode. */
  weights?: number[]
}

/** Result for one scenario. */
export interface ScenarioResult {
  /** Scenario label copied from the input. */
  name: string
  /** Fraction of cells covered [0, 1]. */
  coveredFraction: number
  /** Number of sites selected. */
  nSites: number
  /** ILP solver wall time in seconds. */
  solveTimeS: number
  /** Solver status (e.g. "Optimal", "Feasible", or a fallback note). */
  status: string
}

/** Overall sensitivity result. */
export interface SensitivityResult {
  /** Per-scenario results in input order (deduplicated). */
  scenarios: ScenarioResult[]
  /** Spread of covered fractions across all scenarios. */
  range: {
    /** Minimum covered fraction across scenarios. */
    min: number
    /** Maximum covered fraction across scenarios. */
    max: number
    /** max - min. */
    spread: number
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate standard sensitivity scenarios.
 *
 * Creates three scenarios that model different RSSI assumptions:
 *
 * - **optimistic** (`threshold = baseThreshold - 5 dB`):
 *   Models a lower threshold (easier to achieve coverage), corresponding
 *   e.g. to using a higher spreading factor (SF12 ≈ -137 dBm).
 * - **nominal** (`threshold = baseThreshold`):
 *   The default or best-guess assumption.
 * - **pessimistic** (`threshold = baseThreshold + 5 dB`):
 *   Models a higher threshold (harder to achieve coverage), corresponding
 *   e.g. to using a lower spreading factor (SF7 ≈ -123 dBm) or including
 *   a fade margin.
 *
 * @param baseThreshold - The nominal RSSI threshold in dBm (default `-120`).
 * @returns A list of three Scenario objects.
 */
export function createScenarios(baseThreshold = -120): Scenario[] {
  return [
    {
      name: 'optimistic',
      threshold: baseThreshold - 5,
      target: 0.95,
    },
    {
      name: 'nominal',
      threshold: baseThreshold,
      target: 0.95,
    },
    {
      name: 'pessimistic',
      threshold: baseThreshold + 5,
      target: 0.95,
    },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remove duplicate scenarios (by name), keeping the first occurrence.
 */
function deduplicateScenarios(scenarios: Scenario[]): Scenario[] {
  const seen = new Set<string>()
  const deduped: Scenario[] = []
  for (const sc of scenarios) {
    if (seen.has(sc.name)) continue
    seen.add(sc.name)
    deduped.push(sc)
  }
  return deduped
}

/**
 * Internal wrapper around warmStartMinSites that collects both the greedy
 * and the final (ILP or greedy-fallback) result into one stable record.
 *
 * The public warmStartMinSites returns a `Promise<OptimizationResult>` that
 * resolves **twice** (greedy immediately, then ILP later).  We use the
 * `onUpdate` callback to capture the final (ILP-phase) resolution.
 */
function runMinSitesScenario(
  matrix: CoverageMatrix,
  names: string[],
  target: number,
  timeLimitS: number,
): Promise<{ final: OptimizationResult; ilp: OptimizationResult | null }> {
  return new Promise((resolve) => {
    let greedy: OptimizationResult | null = null

    warmStartMinSites(matrix, names, target, {
      timeLimitS,
      onUpdate: (result, phase) => {
        if (phase === 'greedy') {
          greedy = result
        } else {
          // phase === 'ilp' – final resolution (ILP result or greedy fallback)
          resolve({
            final: result,
            ilp: result !== greedy ? result : null,
          })
        }
      },
    } as WarmStartOptions)
  })
}

/**
 * Internal wrapper around warmStartMaxCoverage that collects both the greedy
 * and the final (ILP or greedy-fallback) result into one stable record.
 */
function runMaxCoverageScenario(
  matrix: CoverageMatrix,
  names: string[],
  nSites: number,
  weights: number[] | undefined,
  timeLimitS: number,
): Promise<{ final: OptimizationResult; ilp: OptimizationResult | null }> {
  return new Promise((resolve) => {
    let greedy: OptimizationResult | null = null

    warmStartMaxCoverage(matrix, names, nSites, weights, {
      timeLimitS,
      onUpdate: (result, phase) => {
        if (phase === 'greedy') {
          greedy = result
        } else {
          // phase === 'ilp' – final resolution
          resolve({
            final: result,
            ilp: result !== greedy ? result : null,
          })
        }
      },
    } as WarmStartOptions)
  })
}

/**
 * Build a ScenarioResult from the solver output.
 */
function toScenarioResult(
  name: string,
  finalResult: OptimizationResult,
  ilpResult: OptimizationResult | null,
): ScenarioResult {
  const ilp = ilpResult ?? finalResult
  const usedFallback = ilpResult === null

  const status = usedFallback
    ? `Feasible (greedy fallback from ILP ${finalResult.status})`
    : finalResult.status

  return {
    name,
    coveredFraction: finalResult.coveredFraction,
    nSites: finalResult.selectedSites.length,
    solveTimeS: ilp.solveTimeS,
    status,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sensitivity: minimum-sites
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run min-sites optimisation across multiple scenarios.
 *
 * For each scenario, calls `warmStartMinSites` (greedy → ILP with fallback)
 * and collects the coverage fraction, site count, and solve time.
 *
 * @param matrix - Nominal sparse binary coverage matrix (N_sites × N_cells).
 * @param names - Candidate site names in matrix row order.
 * @param target - Default coverage target (overridden by per-scenario `target`).
 *                 Default `0.95`.
 * @param scenarios - List of scenario definitions.  Defaults to
 *                    `createScenarios()` using a -120 dBm base threshold.
 * @param timeLimitS - ILP solver time limit per scenario in seconds (default `60`).
 * @returns A `SensitivityResult` with per-scenario details and coverage range.
 */
export async function sensitivityMinSites(
  matrix: CoverageMatrix,
  names: string[],
  target = 0.95,
  scenarios?: Scenario[],
  timeLimitS = 60,
): Promise<SensitivityResult> {
  if (!scenarios) {
    scenarios = createScenarios()
  }

  // ── Deduplicate ────────────────────────────────────────────────────────
  scenarios = deduplicateScenarios(scenarios)

  if (scenarios.length === 0) {
    return {
      scenarios: [],
      range: { min: 0, max: 0, spread: 0 },
    }
  }

  // ── Run each scenario ──────────────────────────────────────────────────
  const perScenario: ScenarioResult[] = []

  for (const sc of scenarios) {
    const scTarget = sc.target ?? target

    const { final: finalResult, ilp: ilpResult } = await runMinSitesScenario(
      matrix,
      names,
      scTarget,
      timeLimitS,
    )

    perScenario.push(toScenarioResult(sc.name, finalResult, ilpResult))
  }

  // ── Compute coverage range ─────────────────────────────────────────────
  const fractions = perScenario.map((s) => s.coveredFraction)
  const minFrac = fractions.length > 0 ? Math.min(...fractions) : 0
  const maxFrac = fractions.length > 0 ? Math.max(...fractions) : 0

  return {
    scenarios: perScenario,
    range: {
      min: minFrac,
      max: maxFrac,
      spread: Math.round((maxFrac - minFrac) * 1e10) / 1e10,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sensitivity: maximum-coverage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run max-coverage optimisation across multiple scenarios.
 *
 * For each scenario, calls `warmStartMaxCoverage` (greedy → ILP with fallback)
 * and collects the coverage fraction and solve time.
 *
 * Per-scenario `weights` (if provided) are passed to the solver to prioritise
 * certain cells.
 *
 * @param matrix - Nominal sparse binary coverage matrix (N_sites × N_cells).
 * @param names - Candidate site names in matrix row order.
 * @param nSites - Number of sites to select (fixed across scenarios).
 * @param scenarios - List of scenario definitions.  Defaults to
 *                    `createScenarios()` using a -120 dBm base threshold.
 * @param timeLimitS - ILP solver time limit per scenario in seconds (default `60`).
 * @returns A `SensitivityResult` with per-scenario details and coverage range.
 */
export async function sensitivityMaxCoverage(
  matrix: CoverageMatrix,
  names: string[],
  nSites: number,
  scenarios?: Scenario[],
  timeLimitS = 60,
): Promise<SensitivityResult> {
  if (!scenarios) {
    scenarios = createScenarios()
  }

  // ── Deduplicate ────────────────────────────────────────────────────────
  scenarios = deduplicateScenarios(scenarios)

  if (scenarios.length === 0) {
    return {
      scenarios: [],
      range: { min: 0, max: 0, spread: 0 },
    }
  }

  // ── Run each scenario ──────────────────────────────────────────────────
  const perScenario: ScenarioResult[] = []

  for (const sc of scenarios) {
    const scWeights = sc.weights

    // Adjust nSites if the matrix has fewer rows than requested
    const effectiveNSites = Math.min(nSites, matrix.nSites)

    const { final: finalResult, ilp: ilpResult } = await runMaxCoverageScenario(
      matrix,
      names,
      effectiveNSites,
      scWeights,
      timeLimitS,
    )

    perScenario.push(toScenarioResult(sc.name, finalResult, ilpResult))
  }

  // ── Compute coverage range ─────────────────────────────────────────────
  const fractions = perScenario.map((s) => s.coveredFraction)
  const minFrac = fractions.length > 0 ? Math.min(...fractions) : 0
  const maxFrac = fractions.length > 0 ? Math.max(...fractions) : 0

  return {
    scenarios: perScenario,
    range: {
      min: minFrac,
      max: maxFrac,
      spread: Math.round((maxFrac - minFrac) * 1e10) / 1e10,
    },
  }
}
