import { greedyMinSites, greedyMaxCoverage } from './greedy'
import type { CoverageMatrix, OptimizationResult } from '../types'

// ────────────────────────────────────────────────────────────────────
// Multi-resolve thenable
//
// A Promise-like object that can resolve MULTIPLE times.  Every
// .then() / .catch() / .finally() callback queued at the time of a
// .resolve() call fires once.  Subsequent .resolve() calls fire any
// newly queued callbacks again, so callers can `await promise` to get
// greedy, then `await promise` again to get the ILP result.
//
// The class structurally matches the TypeScript `Promise<T>` interface
// (then / catch / finally / [Symbol.toStringTag]) so it is assignable
// to `Promise<T>` without a cast.
// ────────────────────────────────────────────────────────────────────

class MultiResolve<T> implements Promise<T> {
  private queue: Array<{
    resolve: (value: T) => void
    reject: (reason: any) => void
  }> = []

  /** Cached last-resolved value so repeat .then()/await always works. */
  private settled = false
  private lastValue: T | null = null
  private lastError: any = null

  // ── Promise interface ────────────────────────────────────────────

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    // If already settled, resolve/reject immediately from cache
    if (this.settled) {
      if (this.lastValue !== null) {
        try {
          const v = onfulfilled ? onfulfilled(this.lastValue) : this.lastValue
          return Promise.resolve(v as TResult1 | TResult2)
        } catch (e) {
          return Promise.reject(e)
        }
      }
      if (this.lastError !== null) {
        try {
          if (onrejected) return Promise.resolve(onrejected(this.lastError) as TResult1 | TResult2)
          return Promise.reject(this.lastError)
        } catch (e) {
          return Promise.reject(e)
        }
      }
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        resolve: (value: T) => {
          try {
            resolve(onfulfilled ? onfulfilled(value) : (value as unknown as TResult1))
          } catch (e) {
            reject(e)
          }
        },
        reject: (err: any) => {
          try {
            onrejected
              ? resolve(onrejected(err) as TResult1)
              : reject(err)
          } catch (e2) {
            reject(e2)
          }
        },
      })
    })
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    return this.then(null, onrejected)
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.then(
      (v) => {
        onfinally?.()
        return v
      },
      (e) => {
        onfinally?.()
        throw e
      },
    )
  }

  get [Symbol.toStringTag](): string {
    return 'Promise'
  }

  // ── Multi-resolution API ─────────────────────────────────────────

  resolve(value: T): void {
    this.lastValue = value
    this.settled = true
    const entries = this.queue.splice(0)
    for (const entry of entries) entry.resolve(value)
  }

  reject(err: any): void {
    this.lastError = err
    this.settled = true
    const entries = this.queue.splice(0)
    for (const entry of entries) entry.reject(err)
  }
}

// ────────────────────────────────────────────────────────────────────
// Public options
// ────────────────────────────────────────────────────────────────────

export interface WarmStartOptions {
  /** ILP time limit in seconds (default: 30) */
  timeLimitS?: number
  /**
   * Synchronous callback fired on each resolution.
   * Callers that cannot re-await the promise can use this instead.
   */
  onUpdate?: (result: OptimizationResult, phase: 'greedy' | 'ilp') => void
}

// ────────────────────────────────────────────────────────────────────
// CPLEX LP-format builders (mirrors the formulation in ilp.ts)
// ────────────────────────────────────────────────────────────────────

/**
 * Set-cover ILP (minimum sites for target coverage).
 *
 * Variables:
 *   y_i ∈ {0,1}  — 1 if site i is selected
 *   s_j ∈ [0,1]  — slack for cell j (allows partial coverage below target)
 *
 * Objective:  minimize  Σ y_i
 *
 * Constraints:
 *   (1)  Σ(M_ij · y_i) + s_j ≥ 1      for each cell j
 *   (2)  Σ s_j ≤ (1 - target) · nCells
 */
function buildMinSitesLp(matrix: CoverageMatrix, target: number): string {
  const { nSites, nCells, rowPtr, colIndices } = matrix
  const slackLimit = ((1 - target) * nCells).toFixed(1)
  const lines: string[] = []

  // Pre-compute coverage lookup per cell (which sites cover each cell)
  const cellCoverage: number[][] = Array.from({ length: nCells }, () => [])
  for (let si = 0; si < nSites; si++) {
    const end = rowPtr[si + 1]!
    for (let k = rowPtr[si]!; k < end; k++) {
      const cj = colIndices[k]
      if (cj !== undefined) cellCoverage[cj]!.push(si)
    }
  }

  // Objective
  lines.push('Minimize')
  const objTerms: string[] = []
  for (let i = 0; i < nSites; i++) objTerms.push(`y_${i}`)
  lines.push(` obj: ${objTerms.join(' + ')}`)
  lines.push('')

  // Constraints
  lines.push('Subject To')

  for (let j = 0; j < nCells; j++) {
    const terms = cellCoverage[j]!.map((si) => `y_${si}`)
    terms.push(`s_${j}`)
    lines.push(` c${j}: ${terms.join(' + ')} >= 1`)
  }

  const slackTerms: string[] = []
  for (let j = 0; j < nCells; j++) slackTerms.push(`s_${j}`)
  lines.push(` slack: ${slackTerms.join(' + ')} <= ${slackLimit}`)
  lines.push('')

  // Bounds
  lines.push('Bounds')
  for (let i = 0; i < nSites; i++) lines.push(` 0 <= y_${i} <= 1`)
  for (let j = 0; j < nCells; j++) lines.push(` 0 <= s_${j} <= 1`)
  lines.push('')

  // Integrality
  lines.push('Binary')
  const binVars: string[] = []
  for (let i = 0; i < nSites; i++) binVars.push(`y_${i}`)
  lines.push(` ${binVars.join(' ')}`)
  lines.push('')

  lines.push('End')
  return lines.join('\n')
}

/**
 * Max-coverage ILP (maximise coverage with exactly nWanted sites).
 *
 * Variables:
 *   y_i ∈ {0,1}  — 1 if site i is selected
 *   c_j ∈ [0,1]  — coverage indicator for cell j (continuous; the
 *                   maximization push and the constraint together
 *                   keep it effectively binary)
 *
 * Objective:  maximize  Σ c_j
 *
 * Constraints:
 *   (1)  c_j ≤ Σ(M_ij · y_i)     for each cell j
 *   (2)  Σ y_i = nWanted
 */
function buildMaxCoverageLp(matrix: CoverageMatrix, nWanted: number): string {
  const { nSites, nCells, rowPtr, colIndices } = matrix
  const lines: string[] = []

  // Pre-compute coverage lookup per cell
  const cellCoverage: number[][] = Array.from({ length: nCells }, () => [])
  for (let si = 0; si < nSites; si++) {
    const end = rowPtr[si + 1]!
    for (let k = rowPtr[si]!; k < end; k++) {
      const cj = colIndices[k]
      if (cj !== undefined) cellCoverage[cj]!.push(si)
    }
  }

  // Objective
  lines.push('Maximize')
  const objTerms: string[] = []
  for (let j = 0; j < nCells; j++) objTerms.push(`c_${j}`)
  lines.push(` obj: ${objTerms.join(' + ')}`)
  lines.push('')

  // Constraints
  lines.push('Subject To')

  for (let j = 0; j < nCells; j++) {
    const coverSites = cellCoverage[j]!
    if (coverSites.length === 0) continue // cell never covered — skip
    const terms: string[] = [`c_${j}`]
    for (const si of coverSites) terms.push(`- y_${si}`)
    lines.push(` cov${j}: ${terms.join(' ')} <= 0`)
  }

  // Exactly nWanted sites
  const siteTerms: string[] = []
  for (let i = 0; i < nSites; i++) siteTerms.push(`y_${i}`)
  lines.push(` count: ${siteTerms.join(' + ')} = ${nWanted}`)
  lines.push('')

  // Bounds
  lines.push('Bounds')
  for (let i = 0; i < nSites; i++) lines.push(` 0 <= y_${i} <= 1`)
  for (let j = 0; j < nCells; j++) lines.push(` 0 <= c_${j} <= 1`)
  lines.push('')

  // Integrality — only site variables are binary; c_j stay continuous
  lines.push('Binary')
  const binVars: string[] = []
  for (let i = 0; i < nSites; i++) binVars.push(`y_${i}`)
  lines.push(` ${binVars.join(' ')}`)
  lines.push('')

  lines.push('End')
  return lines.join('\n')
}

// ────────────────────────────────────────────────────────────────────
// Local hiGHS types (avoid collision with npm package's global types)
// ────────────────────────────────────────────────────────────────────

interface HighsSolution {
  Status: string
  ObjectiveValue: number
  Columns: Record<string, { Primal: number }>
  Rows: unknown[]
}

interface HighsOptions {
  time_limit?: number
  output_flag?: boolean
}

interface HighsClient {
  solve(problem: string, options?: HighsOptions): HighsSolution
}

// ────────────────────────────────────────────────────────────────────
// Internal ILP runner (pure ILP — no greedy step)
// Returns null on failure, the ILP result on success.
// ────────────────────────────────────────────────────────────────────

async function runIlpSolver(
  lpString: string,
  matrix: CoverageMatrix,
  siteNames: string[],
  timeLimitS: number,
): Promise<OptimizationResult | null> {
  try {
    // Lazy-load hiGHS WASM
    // Lazy-load hiGHS WASM
    const mod: any = await import('highs')
    const locateFile = (path: string) => {
      // hiGHS looks for its WASM relative to its script location.
      // Vite pre-bundles it to /node_modules/.vite/deps/highs.js but the
      // WASM is at /node_modules/highs/build/highs.wasm. Point there.
      return `/node_modules/highs/build/${path}`
    }
    const solver: HighsClient = await mod.default({ locateFile })

    const solution: HighsSolution = solver.solve(lpString, {
      time_limit: timeLimitS,
      output_flag: false,
    })

    if (solution.Status !== 'Optimal' && solution.Status !== 'Feasible') {
      return null
    }

    // Extract selected sites
    const selected: number[] = []
    for (let i = 0; i < matrix.nSites; i++) {
      const col = solution.Columns[`y_${i}`]
      if (col && col.Primal > 0.5) selected.push(i)
    }

    // Compute covered cells from the selected sites
    const covered = new Uint8Array(matrix.nCells)
    for (const si of selected) {
      const end = matrix.rowPtr[si + 1]!
      for (let k = matrix.rowPtr[si]!; k < end; k++) {
        const cj = matrix.colIndices[k]
        if (cj !== undefined) covered[cj] = 1
      }
    }
    const nCovered = covered.reduce((a, b) => a + b, 0)

    return {
      selectedSites: selected.map((i) => siteNames[i] ?? `Site ${i}`),
      coveredFraction: nCovered / matrix.nCells,
      objectiveValue: solution.ObjectiveValue,
      solveTimeS: 0, // caller fills this in
      status: solution.Status,
      source: 'ilp',
    }
  } catch (err) {
      console.warn('ILP solver failed:', err)
    return null
  }
}

// ────────────────────────────────────────────────────────────────────
// Warm-start: Minimum-sites (set-cover)
//
// Returns a Promise that resolves IMMEDIATELY with the greedy result
// and resolves AGAIN in the background when hiGHS ILP completes.
// ────────────────────────────────────────────────────────────────────

export function warmStartMinSites(
  matrix: CoverageMatrix,
  siteNames: string[],
  target: number,
  opts?: WarmStartOptions,
): Promise<OptimizationResult> {
  const timeLimit = opts?.timeLimitS ?? 30
  const deferred = new MultiResolve<OptimizationResult>()

  // 1. Greedy — synchronous, sub-100ms
  const greedy = greedyMinSites(matrix, siteNames, target)
  deferred.resolve(greedy)
  opts?.onUpdate?.(greedy, 'greedy')

  // 2. Background ILP
  ;(async () => {
    const ilpStart = performance.now()
    try {
      const lpString = buildMinSitesLp(matrix, target)
      const ilp = await runIlpSolver(lpString, matrix, siteNames, timeLimit)

      if (ilp) {
        ilp.solveTimeS = (performance.now() - ilpStart) / 1000

        if (isImprovement(ilp, greedy)) {
          deferred.resolve(ilp)
          opts?.onUpdate?.(ilp, 'ilp')
          return
        }

        // ILP solved but didn't improve — signal completion with ILP result
        opts?.onUpdate?.(ilp, 'ilp')
        deferred.resolve(ilp)
        return
      }
    } catch (err) {
      console.warn('ILP solver failed:', err)
      // Fall through — signal completion with greedy below
    }
    // ILP failed/timed out — signal completion with greedy fallback
    opts?.onUpdate?.(greedy, 'ilp')
    deferred.resolve(greedy)
  })()

  return deferred
}

// ────────────────────────────────────────────────────────────────────
// Warm-start: Maximum coverage
// ────────────────────────────────────────────────────────────────────

export function warmStartMaxCoverage(
  matrix: CoverageMatrix,
  siteNames: string[],
  nSites: number,
  _weights?: number[],
  opts?: WarmStartOptions,
): Promise<OptimizationResult> {
  const timeLimit = opts?.timeLimitS ?? 30
  const deferred = new MultiResolve<OptimizationResult>()

  // 1. Greedy — synchronous
  const greedy = greedyMaxCoverage(matrix, siteNames, nSites)
  deferred.resolve(greedy)
  opts?.onUpdate?.(greedy, 'greedy')

  // 2. Background ILP
  ;(async () => {
    const ilpStart = performance.now()
    try {
      const lpString = buildMaxCoverageLp(matrix, nSites)
      const ilp = await runIlpSolver(lpString, matrix, siteNames, timeLimit)

      if (ilp) {
        ilp.solveTimeS = (performance.now() - ilpStart) / 1000

        if (isImprovement(ilp, greedy)) {
          deferred.resolve(ilp)
          opts?.onUpdate?.(ilp, 'ilp')
          return
        }

        // ILP solved but didn't improve — signal completion with ILP result
        opts?.onUpdate?.(ilp, 'ilp')
        deferred.resolve(ilp)
        return
      }
    } catch (err) {
      console.warn('ILP solver failed:', err)
      // Fall through — signal completion with greedy below
    }
    // ILP failed/timed out — signal completion with greedy fallback
    opts?.onUpdate?.(greedy, 'ilp')
    deferred.resolve(greedy)
  })()

  return deferred
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * True when `ilp` found a materially different / better solution than
 * `greedy` — either fewer sites selected (min-sites) or higher
 * coverage fraction (max-coverage).  Falls-through to greedy when ILP
 * returned a fallback or the same solution.
 */
function isImprovement(ilp: OptimizationResult, greedy: OptimizationResult): boolean {
  if (ilp.source === 'greedy_fallback') return false
  if (ilp.selectedSites.length !== greedy.selectedSites.length) return true
  return Math.abs(ilp.coveredFraction - greedy.coveredFraction) > 1e-10
}
