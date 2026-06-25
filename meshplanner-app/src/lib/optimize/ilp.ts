import { greedyMinSites, greedyMaxCoverage } from './greedy'
import type { CoverageMatrix, OptimizationResult } from '../types'

/**
 * Build a CPLEX LP-format problem string for the minimum-sites set-cover ILP.
 *
 * Variables:
 *   y_i ∈ {0,1} — 1 if site i is selected
 *   s_j ∈ [0,1] — slack for cell j (allows partial coverage below target)
 *
 * Objective:  minimize  Σ y_i
 *
 * Constraints:
 *   (1)  Σ(M_ij · y_i) + s_j >= 1   for each cell j
 *   (2)  Σ s_j <= (1-target) · nCells
 */
function buildLpString(
  matrix: CoverageMatrix,
  siteNames: string[],
  target: number,
): string {
  const { nSites, nCells, rowPtr, colIndices } = matrix
  const slackLimit = ((1 - target) * nCells).toFixed(1)
  const lines: string[] = []

  // Objective
  const objTerms: string[] = []
  for (let i = 0; i < nSites; i++) {
    objTerms.push(`y_${i}`)
  }
  lines.push('Minimize')
  lines.push(` obj: ${objTerms.join(' + ')}`)
  lines.push('')

  // Constraints
  lines.push('Subject To')

  // Pre-compute coverage lookup per cell: which sites cover cell j
  // We'll build the constraint strings directly by iterating the sparse matrix
  const cellCoverage: number[][] = Array.from({ length: nCells }, () => [])
  for (let si = 0; si < nSites; si++) {
    const end = rowPtr[si + 1]!
    for (let k = rowPtr[si]!; k < end; k++) {
      const cj = colIndices[k]
      if (cj !== undefined) cellCoverage[cj]!.push(si)
    }
  }

  for (let j = 0; j < nCells; j++) {
    const coveringSites = cellCoverage[j]!
    const terms = coveringSites.map(si => `y_${si}`)
    terms.push(`s_${j}`)
    lines.push(` c${j}: ${terms.join(' + ')} >= 1`)
  }

  // Slack upper bound: sum of slacks <= (1-target)*nCells
  const slackTerms: string[] = []
  for (let j = 0; j < nCells; j++) {
    slackTerms.push(`s_${j}`)
  }
  lines.push(` slack: ${slackTerms.join(' + ')} <= ${slackLimit}`)
  lines.push('')

  // Bounds
  lines.push('Bounds')
  for (let i = 0; i < nSites; i++) {
    lines.push(` 0 <= y_${i} <= 1`)
  }
  for (let j = 0; j < nCells; j++) {
    lines.push(` 0 <= s_${j} <= 1`)
  }
  lines.push('')

  // Integrality: site variables are binary
  lines.push('Binary')
  const binVars: string[] = []
  for (let i = 0; i < nSites; i++) {
    binVars.push(`y_${i}`)
  }
  lines.push(` ${binVars.join(' ')}`)
  lines.push('')

  lines.push('End')
  return lines.join('\n')
}

export async function ilpMinSites(
  matrix: CoverageMatrix,
  siteNames: string[],
  target: number,
  timeLimitS: number = 30,
): Promise<OptimizationResult> {
  const start = performance.now()

  // Start with greedy result immediately (fast feasible solution)
  const greedyResult = greedyMinSites(matrix, siteNames, target)

  // Try to load hiGHS WASM (lazy-loaded)
  try {
    const highs = await loadHiGHS()
    if (!highs) throw new Error('hiGHS not available')

    // Build the LP problem in CPLEX LP format
    const lpString = buildLpString(matrix, siteNames, target)

    // Solve with time limit
    const solution: HighsSolution = highs.solve(lpString, {
      time_limit: timeLimitS,
      output_flag: false,
    })

    if (solution.Status === 'Optimal' || solution.Status === 'Feasible') {
      const selected: number[] = []
      for (let i = 0; i < matrix.nSites; i++) {
        const col = solution.Columns[`y_${i}`]
        if (col && col.Primal > 0.5) selected.push(i)
      }

      // Compute covered cells from selected sites
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
        selectedSites: selected.map(i => siteNames[i]!),
        coveredFraction: nCovered / matrix.nCells,
        objectiveValue: solution.ObjectiveValue,
        solveTimeS: (performance.now() - start) / 1000,
        status: solution.Status,
        source: 'ilp',
      }
    }
  } catch {
    // hiGHS unavailable — fall back to greedy
  }

  return { ...greedyResult, solveTimeS: (performance.now() - start) / 1000, source: 'greedy_fallback' }
}

async function loadHiGHS(): Promise<HighsClient | null> {
  try {
    const highsModule: any = await import('highs')
    const highs: HighsClient = await highsModule.default()
    return highs
  } catch {
    return null
  }
}

// Local types avoid conflict with the package's global `Highs` type

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
