import type { CoverageMatrix, OptimizationResult } from "../types"

function countGain(matrix: CoverageMatrix, siteIdx: number, covered: Uint8Array): number {
  let gain = 0
  const end = matrix.rowPtr[siteIdx + 1]!
  for (let j = matrix.rowPtr[siteIdx]!; j < end; j++) {
    const ci = matrix.colIndices[j]!
    if (!covered[ci]) gain++
  }
  return gain
}

function markCovered(matrix: CoverageMatrix, siteIdx: number, covered: Uint8Array, nCovered: { v: number }) {
  const end = matrix.rowPtr[siteIdx + 1]!
  for (let j = matrix.rowPtr[siteIdx]!; j < end; j++) {
    const ci = matrix.colIndices[j]!
    if (!covered[ci]) { covered[ci] = 1; nCovered.v++ }
  }
}

export function greedyMinSites(matrix: CoverageMatrix, siteNames: string[], target: number): OptimizationResult {
  const start = performance.now()
  const nCells = matrix.nCells
  const nSites = matrix.nSites
  const covered = new Uint8Array(nCells)
  const selected: number[] = []
  const used = new Uint8Array(nSites)
  const nCovered = { v: 0 }
  const targetCells = Math.ceil(target * nCells)

  while (nCovered.v < targetCells && selected.length < nSites) {
    let bestIdx = -1
    let bestGain = 0
    for (let i = 0; i < nSites; i++) {
      if (used[i]) continue
      const gain = countGain(matrix, i, covered)
      if (gain > bestGain) { bestGain = gain; bestIdx = i }
    }
    if (bestIdx < 0 || bestGain === 0) break
    selected.push(bestIdx)
    used[bestIdx] = 1
    markCovered(matrix, bestIdx, covered, nCovered)
  }

  return {
    selectedSites: selected.map(i => siteNames[i] ?? `Site ${i}`),
    coveredFraction: nCovered.v / nCells,
    solveTimeS: (performance.now() - start) / 1000,
    status: nCovered.v >= targetCells ? "Optimal" : "Feasible",
    source: "greedy",
  }
}

export function greedyMaxCoverage(matrix: CoverageMatrix, siteNames: string[], nWanted: number): OptimizationResult {
  const start = performance.now()
  const nCells = matrix.nCells
  const covered = new Uint8Array(nCells)
  const selected: number[] = []
  const used = new Uint8Array(matrix.nSites)
  const nCovered = { v: 0 }

  while (selected.length < nWanted && selected.length < matrix.nSites) {
    let bestIdx = -1
    let bestGain = 0
    for (let i = 0; i < matrix.nSites; i++) {
      if (used[i]) continue
      const gain = countGain(matrix, i, covered)
      if (gain > bestGain) { bestGain = gain; bestIdx = i }
    }
    if (bestIdx < 0 || bestGain === 0) break
    selected.push(bestIdx)
    used[bestIdx] = 1
    markCovered(matrix, bestIdx, covered, nCovered)
  }

  return {
    selectedSites: selected.map(i => siteNames[i] ?? `Site ${i}`),
    coveredFraction: nCovered.v / nCells,
    solveTimeS: (performance.now() - start) / 1000,
    status: "Optimal",
    source: "greedy",
  }
}
