import { describe, it, expect } from 'vitest'
import { extractProfile } from '@/lib/propagation/profile'

describe('extractProfile', () => {
  it('returns correct structure', () => {
    const dem = new Float32Array(100).fill(600)
    const p = extractProfile(dem, 10, 10, { a: 0.01, c: -82.6, f: 35.7, e: -0.01 }, 35.68, -82.58, 35.69, -82.57, 10)
    expect(p.totalDistanceKm).toBeGreaterThan(0)
    expect(p.elevations.length).toBe(10)
    expect(p.maxElevation).toBe(600)
    expect(p.avgElevation).toBe(600)
  })
})
