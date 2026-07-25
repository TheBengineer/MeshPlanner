/**
 * Minimum spanning tree utilities for site selection.
 *
 * Provides Kruskal's algorithm for building an MST from a set of selected
 * sites, detection of disconnected components, and search for bridging
 * candidates that can re-connect components with minimal total distance.
 *
 * @module
 */

import type { ConnectivityEdge } from "./connectivity"

// ---------------------------------------------------------------------------
// Union-Find (disjoint-set) — file-private
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

// ---------------------------------------------------------------------------
// Adjacency helpers
// ---------------------------------------------------------------------------

/**
 * Build an adjacency map from LOS-clear edges.
 * For each node index, stores a map of neighbour index → edge data.
 */
function buildAdjacency(
  edges: ConnectivityEdge[],
): Map<number, Map<number, ConnectivityEdge>> {
  const adj: Map<number, Map<number, ConnectivityEdge>> = new Map()
  for (const edge of edges) {
    if (!edge.losClear) continue
    let srcMap = adj.get(edge.sourceIdx)
    if (!srcMap) {
      srcMap = new Map()
      adj.set(edge.sourceIdx, srcMap)
    }
    srcMap.set(edge.targetIdx, edge)

    let tgtMap = adj.get(edge.targetIdx)
    if (!tgtMap) {
      tgtMap = new Map()
      adj.set(edge.targetIdx, tgtMap)
    }
    tgtMap.set(edge.sourceIdx, edge)
  }
  return adj
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a minimum spanning tree (MST) over the subgraph induced by
 * `selectedIndices`, using only edges where `losClear` is true.
 *
 * Uses Kruskal's algorithm with Union-Find (path compression + union by rank).
 * Edge weight = `distanceKm`.
 *
 * @param selectedIndices  Indices of the selected sites.
 * @param edges            All-pairs connectivity graph edges.
 * @param totalCount       Total number of candidate sites (Union-Find size).
 * @returns The MST edges, sorted by distance ascending.
 */
export function buildMst(
  selectedIndices: number[],
  edges: ConnectivityEdge[],
  totalCount: number,
): ConnectivityEdge[] {
  if (selectedIndices.length <= 1) return []

  const selSet = new Set(selectedIndices)

  // Filter to edges wholly within the selected set with clear LOS.
  const candidateEdges = edges.filter(
    e =>
      e.losClear &&
      selSet.has(e.sourceIdx) &&
      selSet.has(e.targetIdx),
  )

  // Kruskal's: sort by weight, union if endpoints are in different sets.
  candidateEdges.sort((a, b) => a.distanceKm - b.distanceKm)

  const uf = new UnionFind(totalCount)
  const mstEdges: ConnectivityEdge[] = []

  for (const edge of candidateEdges) {
    if (uf.find(edge.sourceIdx) !== uf.find(edge.targetIdx)) {
      uf.union(edge.sourceIdx, edge.targetIdx)
      mstEdges.push(edge)
    }
  }

  return mstEdges
}

/**
 * Group selected indices into connected components based on LOS-clear edges.
 *
 * Two sites belong to the same component when there exists a path of
 * LOS-clear edges between them.
 *
 * @param selectedIndices  Indices of the selected sites.
 * @param edges            All-pairs connectivity graph edges.
 * @returns An array of connected component groups (each group is an array
 *          of site indices sorted ascending).
 */
export function detectDisconnectedComponents(
  selectedIndices: number[],
  edges: ConnectivityEdge[],
): number[][] {
  if (selectedIndices.length === 0) return []

  const selSet = new Set(selectedIndices)
  const adj = buildAdjacency(edges)

  // Only keep adjacency entries for selected nodes.
  const visited = new Set<number>()
  const components: number[][] = []

  for (const idx of selectedIndices) {
    if (visited.has(idx)) continue

    // BFS to find the whole component.
    const component: number[] = []
    const queue = [idx]
    visited.add(idx)

    while (queue.length > 0) {
      const cur = queue.shift()!
      component.push(cur)

      const neighbours = adj.get(cur)
      if (neighbours) {
        for (const [nei] of neighbours) {
          if (selSet.has(nei) && !visited.has(nei)) {
            visited.add(nei)
            queue.push(nei)
          }
        }
      }
    }

    component.sort((a, b) => a - b)
    components.push(component)
  }

  return components
}

/**
 * Find the best unselected candidate that bridges two disconnected components.
 *
 * A candidate is eligible when it has LOS-clear edges to at least one site in
 * `componentA` AND at least one site in `componentB`.  Among all eligible
 * candidates (from `allCandidates` that are not already in `selectedIndices`),
 * the one with the lowest cost is returned, where
 *
 *   cost = min distance to componentA + min distance to componentB
 *
 * @param allCandidates   All candidate site indices.
 * @param selectedIndices Currently selected site indices.
 * @param componentA      Indices belonging to component A.
 * @param componentB      Indices belonging to component B.
 * @param edges           All-pairs connectivity graph edges.
 * @returns The best bridging candidate and its cost, or `null` if none found.
 */
export function findBridgingCandidates(
  allCandidates: number[],
  selectedIndices: number[],
  componentA: number[],
  componentB: number[],
  edges: ConnectivityEdge[],
): { candidateIdx: number; cost: number } | null {
  const selSet = new Set(selectedIndices)
  const setA = new Set(componentA)
  const setB = new Set(componentB)

  // Build a lookup: per candidate, the cheapest edge to any node in A and B.
  // We iterate all LOS-clear edges and record the minimum distance.
  const minDistToA = new Map<number, number>()
  const minDistToB = new Map<number, number>()

  for (const edge of edges) {
    if (!edge.losClear) continue
    const { sourceIdx, targetIdx, distanceKm } = edge

    // Direction: source is the candidate, target is in a component.
    if (!selSet.has(sourceIdx) && (setA.has(targetIdx) || setB.has(targetIdx))) {
      const distMap = setA.has(targetIdx) ? minDistToA : minDistToB
      const current = distMap.get(sourceIdx) ?? Infinity
      if (distanceKm < current) {
        distMap.set(sourceIdx, distanceKm)
      }
    }

    // Direction: target is the candidate, source is in a component.
    if (!selSet.has(targetIdx) && (setA.has(sourceIdx) || setB.has(sourceIdx))) {
      const distMap = setA.has(sourceIdx) ? minDistToA : minDistToB
      const current = distMap.get(targetIdx) ?? Infinity
      if (distanceKm < current) {
        distMap.set(targetIdx, distanceKm)
      }
    }
  }

  // Among all candidates not in selectedIndices, find one with distances
  // to BOTH components and the lowest total cost.
  let best: { candidateIdx: number; cost: number } | null = null

  for (const candidate of allCandidates) {
    if (selSet.has(candidate)) continue
    const dA = minDistToA.get(candidate)
    const dB = minDistToB.get(candidate)
    if (dA === undefined || dB === undefined) continue

    const cost = dA + dB
    if (best === null || cost < best.cost) {
      best = { candidateIdx: candidate, cost }
    }
  }

  return best
}
