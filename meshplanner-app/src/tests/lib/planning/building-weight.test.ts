import { buildCellWeights } from "@/lib/planning/building-weight"
import { describe, expect, it } from "vitest"

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a simple axis-aligned square polygon from corner coordinates.
 * Returns a closed ring in `[lng, lat][]` form.
 */
function square(west: number, south: number, east: number, north: number): [number, number][] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south], // close
  ]
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * 8×8 DEM, cellSizePx=4 → 2×2 matrix grid (4 cells).
 *
 *   affine: a=1, c=0, e=-1, f=10
 *
 *   Cell (row, col)      centre (lon, lat)
 *   (0, 0)                (2, 8)
 *   (0, 1)                (6, 8)
 *   (1, 0)                (2, 4)
 *   (1, 1)                (6, 4)
 */
const DEM_W = 8
const DEM_H = 8
const AFFINE = { a: 1, c: 0, e: -1, f: 10 }
const CELL_SZ = 4

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildCellWeights", () => {
  it("returns all 1s when no buildings are provided", () => {
    const w = buildCellWeights([], DEM_W, DEM_H, AFFINE, CELL_SZ)
    expect(w).toHaveLength(4)
    for (let i = 0; i < w.length; i++) {
      expect(w[i]).toBe(1)
    }
  })

  it("returns 1 for every cell when buildings array is empty (default cellSize)", () => {
    const w = buildCellWeights([], DEM_W, DEM_H, AFFINE)
    expect(w).toHaveLength(4)
    for (let i = 0; i < w.length; i++) {
      expect(w[i]).toBe(1)
    }
  })

  it("assigns weight 2 to cells intersected by a single building", () => {
    // Square covering lon [1, 3], lat [7, 9] → contains cell (0,0) centre (2, 8)
    const building = square(1, 7, 3, 9)
    const w = buildCellWeights([building], DEM_W, DEM_H, AFFINE, CELL_SZ)

    expect(w).toHaveLength(4)
    // cell (0,0) — inside the building
    expect(w[0]).toBe(2)
    // cell (0,1), (1,0), (1,1) — outside
    expect(w[1]).toBe(1)
    expect(w[2]).toBe(1)
    expect(w[3]).toBe(1)
  })

  it("assigns weight 3 to cells with two overlapping buildings", () => {
    // Both squares contain cell (0,0) centre (2, 8)
    const buildingA = square(1, 7, 3, 9)
    const buildingB = square(1.5, 7.5, 2.5, 8.5)
    const w = buildCellWeights([buildingA, buildingB], DEM_W, DEM_H, AFFINE, CELL_SZ)

    expect(w).toHaveLength(4)
    // cell (0,0) — inside both buildings → weight = 1 + 2 = 3
    expect(w[0]).toBe(3)
    // other cells — outside
    expect(w[1]).toBe(1)
    expect(w[2]).toBe(1)
    expect(w[3]).toBe(1)
  })

  it("handles buildings that partially overlap the raster edge", () => {
    // Building spans lon [-5, 8], lat [5, 12].
    //   Cell (0,0) centre (2,  8) — inside (lat 8 ≥ 5)
    //   Cell (0,1) centre (6,  8) — inside
    //   Cell (1,0) centre (2,  4) — outside (lat 4 < 5)
    //   Cell (1,1) centre (6,  4) — outside
    const big = square(-5, 5, 8, 12)
    const w = buildCellWeights([big], DEM_W, DEM_H, AFFINE, CELL_SZ)

    expect(w).toHaveLength(4)
    expect(w[0]).toBe(2)
    expect(w[1]).toBe(2)
    expect(w[2]).toBe(1)
    expect(w[3]).toBe(1)
  })

  it("respects default cellSizePx of 4", () => {
    // Same as "returns all 1s" but with no explicit cellSizePx
    const w = buildCellWeights([], DEM_W, DEM_H, AFFINE)
    expect(w).toHaveLength(4)
  })

  it("computes correct grid size for non-divisible dimensions", () => {
    // 10×5 DEM, cellSizePx=4 → ceil(10/4)×ceil(5/4) = 3×2 = 6 cells
    const w = buildCellWeights([], 10, 5, AFFINE, 4)
    expect(w).toHaveLength(6)
  })

  it("handles a building that intersects no cell centres", () => {
    // Tiny building in a gap between cell centres, e.g. lon [3.5, 4.5], lat [5.5, 6.5]
    // Cell centres are at lon 2 and 6, lat 8 and 4 → no match.
    const tiny = square(3.5, 5.5, 4.5, 6.5)
    const w = buildCellWeights([tiny], DEM_W, DEM_H, AFFINE, CELL_SZ)

    expect(w).toHaveLength(4)
    for (let i = 0; i < w.length; i++) {
      expect(w[i]).toBe(1)
    }
  })

  it("assigns higher weight to cells with many buildings", () => {
    // 3 disjoint buildings, each covering a different cell.
    // Using a bigger DEM so we have more cells to work with.
    // 16×8 DEM, cellSizePx=4 → 4×2 = 8 cells
    // Cell centres (col, row):
    //   (0,0)→ (2, 10), (1,0)→ (6, 10), (2,0)→ (10, 10), (3,0)→ (14, 10)
    //   (0,1)→ (2, 6),  (1,1)→ (6, 6),  (2,1)→ (10, 6),  (3,1)→ (14, 6)
    const bigAffine = { a: 1, c: 0, e: -1, f: 12 }
    // B0 covers cell (0,0)  centre (2, 10)
    // B1 covers cell (1,0)  centre (6, 10)
    // B2 covers cell (2,0)  centre (10, 10)
    // B3 overlaps B0 and B1 → cell (0,0) and (1,0)
    const b0 = square(1, 9, 3, 11) // covers (0,0)
    const b1 = square(5, 9, 7, 11) // covers (1,0)
    const b2 = square(9, 9, 11, 11) // covers (2,0)
    const b3 = square(1, 9, 7, 11) // overlaps b0 and b1

    const w = buildCellWeights([b0, b1, b2, b3], 16, 8, bigAffine, 4)

    expect(w).toHaveLength(8)
    // cell (0,0) — inside b0 and b3 → weight = 1 + 2 = 3
    expect(w[0]).toBe(3)
    // cell (1,0) — inside b1 and b3 → weight = 1 + 2 = 3
    expect(w[1]).toBe(3)
    // cell (2,0) — inside b2 only → weight = 2
    expect(w[2]).toBe(2)
    // cell (3,0) — no building
    expect(w[3]).toBe(1)
    // bottom row cells — no building
    expect(w[4]).toBe(1)
    expect(w[5]).toBe(1)
    expect(w[6]).toBe(1)
    expect(w[7]).toBe(1)
  })
})
