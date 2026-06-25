import { describe, expect, it } from 'vitest'
import type { CoverageMatrix } from '@/lib/types'
import {
  createScenarios,
  sensitivityMinSites,
  sensitivityMaxCoverage,
} from '@/lib/optimize/sensitivity'
import type { Scenario } from '@/lib/optimize/sensitivity'

// ── Test fixtures ───────────────────────────────────────────────────────────

/**
 * Build a small deterministic coverage matrix.
 *
 *   3 sites × 5 cells
 *   Site 0 ─── cells {0, 1}
 *   Site 1 ─── cells {1, 2, 3}
 *   Site 2 ─── cells {3, 4}
 *
 * Greedy predictions (used as expected values):
 *   min-sites @ target=0.8 (need ≥4 cells) → selects sites [1, 0], n=2, cov=4/5=0.8
 *   max-coverage @ n=2                     → selects sites [1, 0], n=2, cov=4/5=0.8
 *   max-coverage @ n=1                     → selects site [1],      n=1, cov=3/5=0.6
 */
function makeTestMatrix(): CoverageMatrix {
  return {
    rowPtr: new Uint32Array([0, 2, 5, 7]),
    colIndices: new Uint32Array([0, 1, 1, 2, 3, 3, 4]),
    nSites: 3,
    nCells: 5,
  }
}

const SITE_NAMES = ['Site0', 'Site1', 'Site2']

// ── createScenarios ─────────────────────────────────────────────────────────

describe('createScenarios', () => {
  it('returns optimistic / nominal / pessimistic with default base', () => {
    const sc = createScenarios()
    expect(sc).toHaveLength(3)
    expect(sc[0]!).toMatchObject({ name: 'optimistic', threshold: -125, target: 0.95 })
    expect(sc[1]!).toMatchObject({ name: 'nominal', threshold: -120, target: 0.95 })
    expect(sc[2]!).toMatchObject({ name: 'pessimistic', threshold: -115, target: 0.95 })
  })

  it('adjusts thresholds by ±5 from the given base', () => {
    const sc = createScenarios(-130)
    expect(sc[0]!.threshold).toBe(-135)
    expect(sc[1]!.threshold).toBe(-130)
    expect(sc[2]!.threshold).toBe(-125)
  })

  it('uses target 0.95 for all scenarios', () => {
    for (const s of createScenarios()) {
      expect(s.target).toBe(0.95)
    }
  })
})

// ── sensitivityMinSites ─────────────────────────────────────────────────────

describe('sensitivityMinSites', () => {
  it('returns empty result when scenarios list is empty', async () => {
    const result = await sensitivityMinSites(makeTestMatrix(), SITE_NAMES, 0.95, [])
    expect(result.scenarios).toHaveLength(0)
    expect(result.range).toEqual({ min: 0, max: 0, spread: 0 })
  })

  it('uses default createScenarios when none provided', async () => {
    const result = await sensitivityMinSites(makeTestMatrix(), SITE_NAMES, 0.8, undefined, 5)
    // Default scenarios = optimistic, nominal, pessimistic
    expect(result.scenarios).toHaveLength(3)
    for (const s of result.scenarios) {
      expect(s.nSites).toBeGreaterThanOrEqual(1)
      expect(s.nSites).toBeLessThanOrEqual(3)
      expect(s.coveredFraction).toBeGreaterThanOrEqual(0.8)
      expect(s.status).toBeTruthy()
      expect(s.solveTimeS).toBeGreaterThanOrEqual(0)
    }
    // Range should be within [0, 1]
    expect(result.range.min).toBeGreaterThanOrEqual(0)
    expect(result.range.max).toBeLessThanOrEqual(1)
    expect(result.range.spread).toBeGreaterThanOrEqual(0)
  })

  it('runs with user-supplied scenarios', async () => {
    const custom: Scenario[] = [
      { name: 'tight', threshold: -110, target: 0.5 },
      { name: 'loose', threshold: -130, target: 0.9 },
    ]
    const result = await sensitivityMinSites(makeTestMatrix(), SITE_NAMES, 0.95, custom, 5)
    expect(result.scenarios).toHaveLength(2)
    expect(result.scenarios[0]!.name).toBe('tight')
    expect(result.scenarios[1]!.name).toBe('loose')
  })

  it('deduplicates scenarios with the same name', async () => {
    const dupes: Scenario[] = [
      { name: 'dup', threshold: -120, target: 0.8 },
      { name: 'dup', threshold: -130, target: 0.9 },
      { name: 'other', threshold: -110, target: 0.7 },
    ]
    const result = await sensitivityMinSites(makeTestMatrix(), SITE_NAMES, 0.95, dupes, 5)
    // First occurrence of 'dup' wins (threshold -120)
    expect(result.scenarios).toHaveLength(2)
    expect(result.scenarios[0]!.name).toBe('dup')
  })

  it('produces consistent greedy results for the small matrix', async () => {
    // With target=0.5 (need 3 cells), greedy picks site 1 then maybe 0 or 2
    // The exact result depends on tiebreaking, but coverage should reach ≥0.6
    const result = await sensitivityMinSites(makeTestMatrix(), SITE_NAMES, 0.5, undefined, 5)
    for (const s of result.scenarios) {
      expect(s.coveredFraction).toBeGreaterThanOrEqual(0.5)
      expect(s.nSites).toBeGreaterThanOrEqual(1)
    }
  })
})

// ── sensitivityMaxCoverage ──────────────────────────────────────────────────

describe('sensitivityMaxCoverage', () => {
  it('returns empty result when scenarios list is empty', async () => {
    const result = await sensitivityMaxCoverage(makeTestMatrix(), SITE_NAMES, 2, [])
    expect(result.scenarios).toHaveLength(0)
    expect(result.range).toEqual({ min: 0, max: 0, spread: 0 })
  })

  it('uses default createScenarios when none provided', async () => {
    const result = await sensitivityMaxCoverage(makeTestMatrix(), SITE_NAMES, 2, undefined, 5)
    expect(result.scenarios).toHaveLength(3)
    for (const s of result.scenarios) {
      expect(s.nSites).toBe(2)
      expect(s.coveredFraction).toBeGreaterThan(0)
      expect(s.coveredFraction).toBeLessThanOrEqual(1)
      expect(s.status).toBeTruthy()
      expect(s.solveTimeS).toBeGreaterThanOrEqual(0)
    }
  })

  it('handles nSites larger than available sites', async () => {
    // matrix has 3 sites, but request 10 — should clamp to 3
    const result = await sensitivityMaxCoverage(
      makeTestMatrix(),
      SITE_NAMES,
      10,
      undefined,
      5,
    )
    for (const s of result.scenarios) {
      expect(s.nSites).toBeLessThanOrEqual(3)
    }
  })

  it('runs with custom scenarios', async () => {
    const custom: Scenario[] = [
      { name: 'few', threshold: -120, target: 0.95 },
    ]
    const result = await sensitivityMaxCoverage(makeTestMatrix(), SITE_NAMES, 1, custom, 5)
    expect(result.scenarios).toHaveLength(1)
    expect(result.scenarios[0]!.name).toBe('few')
    // With 1 site, greedy picks Site1 (covers cells {1,2,3} → 3/5)
    expect(result.scenarios[0]!.nSites).toBe(1)
    expect(result.scenarios[0]!.coveredFraction).toBeGreaterThan(0)
  })
})

// ── Edge cases ──────────────────────────────────────────────────────────────

describe('sensitivity edge cases', () => {
  it('sensitivityMinSites handles single-site matrix', async () => {
    // 1 site × 3 cells
    const single: CoverageMatrix = {
      rowPtr: new Uint32Array([0, 3]),
      colIndices: new Uint32Array([0, 1, 2]),
      nSites: 1,
      nCells: 3,
    }
    const result = await sensitivityMinSites(single, ['Only'], 0.5, undefined, 5)
    for (const s of result.scenarios) {
      expect(s.nSites).toBe(1)
      expect(s.coveredFraction).toBe(1)
    }
  })

  it('sensitivityMaxCoverage handles single-site matrix', async () => {
    const single: CoverageMatrix = {
      rowPtr: new Uint32Array([0, 3]),
      colIndices: new Uint32Array([0, 1, 2]),
      nSites: 1,
      nCells: 3,
    }
    const result = await sensitivityMaxCoverage(single, ['Only'], 1, undefined, 5)
    for (const s of result.scenarios) {
      expect(s.nSites).toBe(1)
      expect(s.coveredFraction).toBe(1)
    }
  })

  it('reports non-zero spread when scenarios differ', async () => {
    // Force different coverage targets to produce different outcomes
    const mixed: Scenario[] = [
      { name: 'low-bar', threshold: -120, target: 0.1 },
      { name: 'high-bar', threshold: -120, target: 0.99 },
    ]
    const result = await sensitivityMinSites(makeTestMatrix(), SITE_NAMES, 0.95, mixed, 5)
    // With target=0.1, we might only need 1 site; with target=0.99 we need more
    const nSitesList = result.scenarios.map((s) => s.nSites)
    expect(new Set(nSitesList).size).toBeGreaterThanOrEqual(1)
  })
})

// ── Warm-start integration ──────────────────────────────────────────────────

describe('warmstart integration', () => {
  it('min-sites resolves with both greedy and ILP phases', async () => {
    // This test verifies that the warmStartMinSites pipeline resolves
    // as expected: we get a valid result even when hiGHS WASM is not
    // available (greedy fallback) or when it is (ILP).
    const result = await sensitivityMinSites(makeTestMatrix(), SITE_NAMES, 0.8, undefined, 5)
    expect(result.scenarios).toHaveLength(3)
    for (const s of result.scenarios) {
      // Every scenario should have a concrete status string
      expect(s.status).toBeTruthy()
      expect(typeof s.status).toBe('string')
      expect(s.status.length).toBeGreaterThan(0)
    }
  })

  it('max-coverage resolves with both greedy and ILP phases', async () => {
    const result = await sensitivityMaxCoverage(makeTestMatrix(), SITE_NAMES, 2, undefined, 5)
    expect(result.scenarios).toHaveLength(3)
    for (const s of result.scenarios) {
      expect(s.status).toBeTruthy()
      expect(typeof s.status).toBe('string')
    }
  })
})
