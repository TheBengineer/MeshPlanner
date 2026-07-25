/**
 * Connectivity-aware greedy site selector.
 *
 * Extends the standard greedy-min-sites heuristic with a connectivity bonus
 * that favours sites having line-of-sight to already-selected sites.  As the
 * selected set grows, connectivity dominates the scoring so the result forms
 * a connected mesh backbone.  MST edges among the chosen sites are returned
 * for downstream visualisation and plan validation.
 *
 * @module
 */

import type { CoverageMatrix } from "../types"
import type { ConnectivityEdge } from "./connectivity"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MeshSelectorResult {
  /** Indices into the original candidate list. */
  selected: number[]
  /** Fraction of cells covered by the selected sites. */
  coveredFraction: number
  /** MST edges (Kruskal's on the subgraph induced by selected indices). */
  edges: ConnectivityEdge[]
  /** Whether every selected site is reachable from every other. */
  connected: boolean
  /** Wall-clock solve time in seconds. */
  solveTimeS: number
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Select sites using connectivity-augmented greedy scoring.
 *
 * Algorithm
 * ─────────
 * 1. Build an adjacency set from `ConnectivityEdge[]` for O(1) LOS lookups.
 * 2. Standard greedy iteration where each unused site scores:
 *      `score = coverageGain + connBonusWeight · |selected| · connectivityBonus`
 *    - `coverageGain`  — cells this site would newly cover.
 *    - `connectivityBonus` — 1 if site has LOS to ANY site in the selected
 *      set, 0 otherwise.
 *    - The `|selected|` multiplier makes connectivity dominate as the set
 *      grows.
 *    - **First site**: connectivity bonus is zero for all sites; pick by
 *      pure coverage gain.
 * 3. After greedy selection, compute the MST of the subgraph induced by
 *    selected indices via Kruskal's algorithm (weight = distanceKm).
 * 4. Determine whether all selected sites form a single connected component.
 *
 * @param matrix       Coverage matrix (row-pointer compressed sparse rows).
 * @param siteNames    Display names for logging / debug output.
 * @param connectivity Pairwise line-of-sight edges between candidates.
 * @param target       Coverage target fraction (0–1); e.g. 0.95 → 95 %.
 * @param opts.connBonusWeight  Weight of the connectivity bonus (default 0.3).
 * @param opts.debug            When true, log per-iteration debug info.
 */
export function selectMeshSites(
  matrix: CoverageMatrix,
  _siteNames: string[],
  connectivity: ConnectivityEdge[],
  target: number,
  opts?: {
    connBonusWeight?: number
    debug?: boolean
    /** Per-cell weights for greedy scoring (length = matrix.nCells). When
     *  provided, the gain from covering a cell is its weight instead of 1. */
    cellWeights?: Float32Array
  },
): MeshSelectorResult {
  const start = performance.now()
  const nCells = matrix.nCells
  const nSites = matrix.nSites
  const covered = new Uint8Array(nCells)
  const selected: number[] = []
  const used = new Uint8Array(nSites)
  const nCovered = { v: 0 }
  const targetCells = Math.ceil(target * nCells)
  const connWeight = opts?.connBonusWeight ?? 0.3
  const debug = opts?.debug ?? false
  const cellWeights = opts?.cellWeights

  // ── 1. Adjacency set from LOS-clear edges ──────────────────────────────
  const adj: Map<number, Set<number>> = new Map()
  for (let i = 0; i < nSites; i++) adj.set(i, new Set())
  for (const edge of connectivity) {
    if (!edge.losClear) continue
    adj.get(edge.sourceIdx)!.add(edge.targetIdx)
    adj.get(edge.targetIdx)!.add(edge.sourceIdx)
  }

  // ── 2. Greedy selection ────────────────────────────────────────────────
  while (nCovered.v < targetCells && selected.length < nSites) {
    let bestIdx = -1
    let bestScore = -Infinity
    const selLen = selected.length

    for (let i = 0; i < nSites; i++) {
      if (used[i]) continue
      const gain = countGain(matrix, i, covered, cellWeights)
      // Skip zero-gain sites after the first pick (they add no coverage).
      if (gain === 0 && selLen > 0) continue

      // Connectivity bonus — does this site see any already-selected site?
      let connBonus = 0
      if (selLen > 0) {
        const neighbors = adj.get(i)!
        for (let k = 0; k < selLen; k++) {
          if (neighbors.has(selected[k]!)) {
            connBonus = 1
            break
          }
        }
      }

      const score = gain + connWeight * selLen * connBonus
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    if (bestIdx < 0 || bestScore <= 0) break

    selected.push(bestIdx)
    used[bestIdx] = 1
    markCovered(matrix, bestIdx, covered, nCovered)

    if (debug) {
      const name = _siteNames[bestIdx] ?? `Site ${bestIdx}`
      const prevSel = selected.length - 1
      const lastGain =
        prevSel > 0
          ? countGain(matrix, selected[prevSel - 1]!, covered, cellWeights)
          : 0
      console.log(
        `[selector] iteration ${selected.length}: picked ${name} ` +
          `(gain=${lastGain}, covered=${nCovered.v}/${targetCells})`,
      )
    }
  }

  // ── 3. MST via Kruskal's on selected subgraph ──────────────────────────
  const uf = new UnionFind(nSites)
  const mstEdges: ConnectivityEdge[] = []
  const selSet = new Set(selected)

  const candidateEdges = connectivity
    .filter(e => e.losClear && selSet.has(e.sourceIdx) && selSet.has(e.targetIdx))
    .sort((a, b) => a.distanceKm - b.distanceKm)

  for (const edge of candidateEdges) {
    if (uf.find(edge.sourceIdx) !== uf.find(edge.targetIdx)) {
      uf.union(edge.sourceIdx, edge.targetIdx)
      mstEdges.push(edge)
    }
  }

  // ── 4. Connected check ────────────────────────────────────────────────
  const connected = selected.length <= 1 || (() => {
    const root = uf.find(selected[0]!)
    for (let i = 1; i < selected.length; i++) {
      if (uf.find(selected[i]!) !== root) return false
    }
    return true
  })()

  return {
    selected,
    coveredFraction: nCells > 0 ? nCovered.v / nCells : 0,
    edges: mstEdges,
    connected,
    solveTimeS: (performance.now() - start) / 1000,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Count how many NEW cells site `siteIdx` would cover, given the current
 * `covered` bitmask.
 */
function countGain(
  matrix: CoverageMatrix,
  siteIdx: number,
  covered: Uint8Array,
  cellWeights?: Float32Array,
): number {
  let gain = 0
  const end = matrix.rowPtr[siteIdx + 1]!
  for (let j = matrix.rowPtr[siteIdx]!; j < end; j++) {
    const ci = matrix.colIndices[j]!
    if (!covered[ci]) gain += cellWeights ? cellWeights[ci]! : 1
  }
  return gain
}

/**
 * Mark all cells covered by `siteIdx` in the covered bitmask and update the
 * running total.
 */
function markCovered(
  matrix: CoverageMatrix,
  siteIdx: number,
  covered: Uint8Array,
  nCovered: { v: number },
) {
  const end = matrix.rowPtr[siteIdx + 1]!
  for (let j = matrix.rowPtr[siteIdx]!; j < end; j++) {
    const ci = matrix.colIndices[j]!
    if (!covered[ci]) {
      covered[ci] = 1
      nCovered.v++
    }
  }
}

// ---------------------------------------------------------------------------
// Union-Find (disjoint-set) for Kruskal's algorithm
// ---------------------------------------------------------------------------

class UnionFind {
  parent: number[]
  rank: number[]

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
    this.rank = new Array(n).fill(0)
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]!)
    }
    return this.parent[x]!
  }

  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    if (this.rank[ra]! < this.rank[rb]!) {
      this.parent[ra] = rb
    } else if (this.rank[ra]! > this.rank[rb]!) {
      this.parent[rb] = ra
    } else {
      this.parent[rb] = ra
      this.rank[ra]!++
    }
  }
}
