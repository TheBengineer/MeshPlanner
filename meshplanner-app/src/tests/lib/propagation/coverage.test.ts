import { describe, it, expect } from 'vitest'
import { computeCoverageRaster } from '@/lib/propagation/coverage'
import { DEFAULT_LORA_PARAMS } from '@/lib/constants'

describe('computeCoverageRaster', () => {
  it('returns correct shape', () => {
    const dem = new Float32Array(100).fill(500)
    const result = computeCoverageRaster(dem, 10, 10, { a: 0.01, c: -82.5, f: 35.6, e: -0.01 }, 35.6, -82.5, DEFAULT_LORA_PARAMS, 2, 36)
    expect(result.width).toBe(10)
    expect(result.height).toBe(10)
    expect(result.rssi.length).toBe(100)
    expect(result.maxRangeKm).toBe(2)
  })
})
