import { describe, expect, it } from "vitest"
import type { CoverageMatrix } from "@/lib/types"
import type { ConnectivityEdge } from "@/lib/planning/connectivity"
import { selectMeshSites } from "@/lib/planning/selector"

// ── Test fixtures ───────────────────────────────────────────────────────────

/**
 * 3 sites × 5 cells
 *
 *   Site 0 ─── cells {0, 1}
 *   Site 1 ─── cells {1, 2, 3}
 *   Site 2 ─── cells {3, 4}
 *
 * Greedy (pure coverage) picks Site 1 first (3 cells), then Site 0 (gain 1)
 * or Site 2 (gain 1).  With connectivity, the one linked to Site 1 wins.
 */
function matrix3x5(): CoverageMatrix {
  return {
    rowPtr: new Uint32Array([0, 2, 5, 7]),
    colIndices: new Uint32Array([0, 1, 1, 2, 3, 3, 4]),
    nSites: 3,
    nCells: 5,
  }
}

/**
 * 3 sites × 6 cells where connectivity breaks a coverage tie.
 *
 *   Site 0 ─── cells {0, 1}   ← has LOS to Site 1
 *   Site 1 ─── cells {2, 3, 4}  ← best first pick (3 cells)
 *   Site 2 ─── cells {0, 5}   ← NO LOS to Site 1
 *
 * After picking Site 1, both Site 0 and Site 2 have gain = 2.
 * Connectivity bonus should make Site 0 win (score = 2 + 0.3·1·1 = 2.3 vs 2.0).
 */
function matrixTiebreak(): CoverageMatrix {
  return {
    rowPtr: new Uint32Array([0, 2, 5, 7]),
    colIndices: new Uint32Array([0, 1, 2, 3, 4, 0, 5]),
    nSites: 3,
    nCells: 6,
  }
}

const SITE_NAMES = ["Site0", "Site1", "Site2"]

/**
 * Chain connectivity:
 *   0 ── 1 ── 2   (all losClear)
 */
function chainEdges(): ConnectivityEdge[] {
  return [
    { sourceIdx: 0, targetIdx: 1, distanceKm: 2, losClear: true },
    { sourceIdx: 1, targetIdx: 2, distanceKm: 3, losClear: true },
  ]
}

// ── Basic selection ─────────────────────────────────────────────────────────

describe("selectMeshSites", () => {
  it("selects sites meeting the coverage target", () => {
    const result = selectMeshSites(matrix3x5(), SITE_NAMES, chainEdges(), 0.8)
    // Need 4/5 cells → greedy picks Site 1 (covers 3) then one more.
    expect(result.selected.length).toBeGreaterThanOrEqual(2)
    expect(result.coveredFraction).toBeGreaterThanOrEqual(0.8)
  })

  it("returns indices into the candidate list", () => {
    const result = selectMeshSites(matrix3x5(), SITE_NAMES, chainEdges(), 0.8)
    for (const idx of result.selected) {
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(3)
    }
  })

  it("first site is the one with most coverage", () => {
    // Site 1 covers 3 cells, Site 0 covers 2, Site 2 covers 2.
    const result = selectMeshSites(matrix3x5(), SITE_NAMES, chainEdges(), 0.8)
    expect(result.selected[0]).toBe(1)
  })

  it("coveredFraction is 0 when nCells is 0", () => {
    const emptyMatrix: CoverageMatrix = {
      rowPtr: new Uint32Array([0, 0]),
      colIndices: new Uint32Array([]),
      nSites: 1,
      nCells: 0,
    }
    const result = selectMeshSites(emptyMatrix, ["Only"], [], 0.95)
    expect(result.selected).toHaveLength(0)
    expect(result.coveredFraction).toBe(0)
  })
})

// ── Connectivity bonus ──────────────────────────────────────────────────────

describe("connectivity bonus", () => {
  it("breaks ties in favour of the connected site", () => {
    // Site 1 selected first.  Site 0 and Site 2 both have gain = 2, but
    // only Site 0 has LOS to Site 1 → Site 0 should be picked second.
    const edges: ConnectivityEdge[] = [
      { sourceIdx: 0, targetIdx: 1, distanceKm: 2, losClear: true },
      // Site 2 has NO edge to Site 1.
    ]
    const result = selectMeshSites(matrixTiebreak(), SITE_NAMES, edges, 0.95)
    expect(result.selected[0]).toBe(1) // Site 1 first (pure coverage)
    expect(result.selected).toContain(0) // Site 0 wins tie via connectivity

    // With lower target (0.5 → 3 cells), Site 1 alone suffices.
    const result2 = selectMeshSites(matrixTiebreak(), SITE_NAMES, edges, 0.5)
    expect(result2.selected).toEqual([1])
    expect(result2.coveredFraction).toBeGreaterThanOrEqual(0.5)
  })

  it("connectivity bonus scales with |selected|", () => {
    // 4‑site chain so the bonus grows each iteration:
    //   Site 3 (best coverage) → Site 2 → Site 1 → Site 0
    // Each step the |selected| multiplier increases, making connectivity
    // progressively more important.
    const rowPtr = new Uint32Array([0, 1, 2, 4, 7])
    const colIndices = new Uint32Array([0, 1, 2, 3, 4, 5, 6])
    // Site 3 covers cells {5,6} = 2, Site 2 covers {3,4} = 2,
    // Site 1 covers {1} = 1, Site 0 covers {0} = 1
    // nCells = 7
    const fourMatrix: CoverageMatrix = {
      rowPtr,
      colIndices,
      nSites: 4,
      nCells: 7,
    }
    const fourEdges: ConnectivityEdge[] = [
      { sourceIdx: 0, targetIdx: 1, distanceKm: 1, losClear: true },
      { sourceIdx: 1, targetIdx: 2, distanceKm: 1, losClear: true },
      { sourceIdx: 2, targetIdx: 3, distanceKm: 1, losClear: true },
    ]
    const result = selectMeshSites(fourMatrix, ["A", "B", "C", "D"], fourEdges, 0.95)
    expect(result.connected).toBe(true)
    // All 4 should be selected (need 7/7 cells)
    expect(result.selected).toHaveLength(4)
    // Check chain ordering: 3 (gain 2) → 2 (gain 2, conn=1) → 1 (gain 1, conn=1) → 0 (gain 1, conn=1)
    // After picking 3 then 2: |selected|=2, bonus weight multiplies by 2.
    // Site 1: gain=1, conn=1 → score = 1 + 0.3*2*1 = 1.6
    // Site 0: gain=1, conn=0 → score = 1 + 0.3*2*0 = 1.0
    expect(result.selected).toEqual([3, 2, 1, 0])
  })

  it("zero connBonusWeight disables connectivity bonus", () => {
    const edges: ConnectivityEdge[] = [
      { sourceIdx: 0, targetIdx: 1, distanceKm: 2, losClear: true },
    ]
    const result = selectMeshSites(matrixTiebreak(), SITE_NAMES, edges, 0.95, {
      connBonusWeight: 0,
    })
    // Both have gain=2, tie goes to first encountered (Site 0)
    expect(result.selected).toContain(1) // Site 1 first
    expect(result.selected).toContain(0) // Site 0 second (tie, first encountered)
  })
})

// ── MST computation ─────────────────────────────────────────────────────────

describe("MST (Kruskal's)", () => {
  it("returns MST edges among selected sites", () => {
    const result = selectMeshSites(matrix3x5(), SITE_NAMES, chainEdges(), 0.8)
    // selected = [1, 0] (Site 1 first, then Site 0)
    // Edge (0,1) has both endpoints selected → MST includes it.
    expect(result.edges.length).toBeGreaterThanOrEqual(1)
    for (const e of result.edges) {
      expect(e.losClear).toBe(true)
      expect(e.distanceKm).toBeGreaterThan(0)
    }
  })

  it("includes all selected nodes in MST edges", () => {
    // All 3 sites selected, chain edges → MST should connect all 3.
    // Use a matrix so small that all sites are needed.
    const tinyMatrix: CoverageMatrix = {
      rowPtr: new Uint32Array([0, 1, 2, 3]),
      colIndices: new Uint32Array([0, 1, 2]),
      nSites: 3,
      nCells: 3,
    }
    const result = selectMeshSites(tinyMatrix, SITE_NAMES, chainEdges(), 1.0)
    expect(result.selected).toHaveLength(3)
    // MST should have 2 edges (n-1) connecting all 3
    expect(result.edges).toHaveLength(2)
    // Connected component check
    expect(result.connected).toBe(true)
  })

  it("does not include edges whose losClear is false", () => {
    const edges: ConnectivityEdge[] = [
      { sourceIdx: 0, targetIdx: 1, distanceKm: 2, losClear: false },
      { sourceIdx: 1, targetIdx: 2, distanceKm: 3, losClear: true },
    ]
    const result = selectMeshSites(matrix3x5(), SITE_NAMES, edges, 1.0)
    // Site 1 and Site 2 have losClear edge, Site 0 does not.
    // After selecting all 3 sites, the MST edge (0,1) should NOT appear.
    for (const e of result.edges) {
      expect(e.losClear).toBe(true)
    }
  })
})

// ── Connected check ─────────────────────────────────────────────────────────

describe("connected check", () => {
  it("is true when selected sites form a single component", () => {
    const result = selectMeshSites(matrix3x5(), SITE_NAMES, chainEdges(), 0.8)
    expect(result.connected).toBe(true)
  })

  it("is false when no connectivity edges exist", () => {
    const result = selectMeshSites(matrix3x5(), SITE_NAMES, [], 0.8)
    // Multiple sites selected, but no edges to connect them.
    if (result.selected.length > 1) {
      expect(result.connected).toBe(false)
    }
  })

  it("is true for a single selected site", () => {
    // target=0.3 → need 2/5 cells, Site 1 alone covers 3 → just one site.
    const result = selectMeshSites(matrix3x5(), SITE_NAMES, [], 0.3)
    expect(result.selected).toHaveLength(1)
    expect(result.connected).toBe(true)
  })

  it("is true when no sites selected", () => {
    const empty: CoverageMatrix = {
      rowPtr: new Uint32Array([0, 0]),
      colIndices: new Uint32Array([]),
      nSites: 0,
      nCells: 0,
    }
    const result = selectMeshSites(empty, [], [], 0.95)
    expect(result.selected).toHaveLength(0)
    expect(result.connected).toBe(true)
  })
})

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles empty connectivity gracefully", () => {
    const result = selectMeshSites(matrix3x5(), SITE_NAMES, [], 0.8)
    expect(result.selected.length).toBeGreaterThanOrEqual(1)
    expect(result.edges).toHaveLength(0)
  })

  it("handles single-site matrix", () => {
    const single: CoverageMatrix = {
      rowPtr: new Uint32Array([0, 3]),
      colIndices: new Uint32Array([0, 1, 2]),
      nSites: 1,
      nCells: 3,
    }
    // With no connectivity, single site should still be selected.
    const result = selectMeshSites(single, ["Only"], [], 0.5)
    expect(result.selected).toEqual([0])
    expect(result.coveredFraction).toBe(1)
    expect(result.connected).toBe(true)
    expect(result.edges).toHaveLength(0)
  })

  it("target=0 picks no sites", () => {
    const result = selectMeshSites(matrix3x5(), SITE_NAMES, chainEdges(), 0)
    expect(result.selected).toHaveLength(0)
    expect(result.coveredFraction).toBe(0)
    expect(result.connected).toBe(true)
  })

  it("all sites exhausted before target is met", () => {
    const partial: CoverageMatrix = {
      rowPtr: new Uint32Array([0, 1, 2]),
      colIndices: new Uint32Array([0, 1]),
      nSites: 2,
      nCells: 10,
    }
    const edges: ConnectivityEdge[] = [
      { sourceIdx: 0, targetIdx: 1, distanceKm: 1, losClear: true },
    ]
    const result = selectMeshSites(partial, ["A", "B"], edges, 0.95)
    expect(result.selected).toHaveLength(2)
    expect(result.coveredFraction).toBe(0.2) // 2/10
  })

  it("solveTimeS is non-negative", () => {
    const result = selectMeshSites(matrix3x5(), SITE_NAMES, chainEdges(), 0.8)
    expect(result.solveTimeS).toBeGreaterThanOrEqual(0)
  })
})

// ── Cell weights ─────────────────────────────────────────────────────────────

describe("cellWeights", () => {
  it("biases greedy selection toward higher-weight cells", () => {
    // 2 sites × 3 cells
    //   Site 0 ─── cells {0}      weight[0] = 100
    //   Site 1 ─── cells {1, 2}   weight[1] = 1, weight[2] = 1
    //
    // Without weights: Site 1 wins (gain 2 > 1)
    // With weights:    Site 0 wins (gain 100 > 2)
    const matrix: CoverageMatrix = {
      rowPtr: new Uint32Array([0, 1, 3]),
      colIndices: new Uint32Array([0, 1, 2]),
      nSites: 2,
      nCells: 3,
    }

    // Without weights — Site 1 should be first
    const noWeights = selectMeshSites(matrix, ["A", "B"], [], 0.95)
    expect(noWeights.selected[0]).toBe(1)

    // With weights — Site 0 (cell 0, weight 100) should be first
    const weights = new Float32Array([100, 1, 1])
    const withWeights = selectMeshSites(matrix, ["A", "B"], [], 0.95, {
      cellWeights: weights,
    })
    expect(withWeights.selected[0]).toBe(0)
  })

  it("is backward compatible when cellWeights is omitted", () => {
    // Same call as existing tests — must produce identical result.
    const result = selectMeshSites(matrix3x5(), SITE_NAMES, chainEdges(), 0.8)
    expect(result.selected.length).toBeGreaterThanOrEqual(2)
    expect(result.coveredFraction).toBeGreaterThanOrEqual(0.8)
  })
})

// ── Kruskal's edge selection ────────────────────────────────────────────────

describe("MST edge specificity", () => {
  it("picks shortest edges that avoid cycles", () => {
    // Triangle: 0↔1 (dist 1), 1↔2 (dist 2), 0↔2 (dist 10)
    // MST should be edges (0,1) and (1,2).
    const triangleEdges: ConnectivityEdge[] = [
      { sourceIdx: 0, targetIdx: 1, distanceKm: 1, losClear: true },
      { sourceIdx: 1, targetIdx: 2, distanceKm: 2, losClear: true },
      { sourceIdx: 0, targetIdx: 2, distanceKm: 10, losClear: true },
    ]
    const triMatrix: CoverageMatrix = {
      rowPtr: new Uint32Array([0, 1, 2, 3]),
      colIndices: new Uint32Array([0, 1, 2]),
      nSites: 3,
      nCells: 3,
    }
    const result = selectMeshSites(triMatrix, SITE_NAMES, triangleEdges, 1.0)
    expect(result.selected).toHaveLength(3)
    expect(result.edges).toHaveLength(2)
    // The long edge (0,2) should not be in the MST.
    for (const e of result.edges) {
      expect(e.distanceKm).toBeLessThan(10)
    }
    // Verify MST distance sum is minimal (1 + 2 = 3).
    const totalDist = result.edges.reduce((s, e) => s + e.distanceKm, 0)
    expect(totalDist).toBe(3)
  })
})
