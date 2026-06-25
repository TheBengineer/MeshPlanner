import { describe, it, expect } from 'vitest'
import { computePathLoss } from '@/lib/propagation/itm'
import type { TerrainProfile } from '@/lib/types'

function flatProfile(distKm: number, elev: number = 0, n: number = 100): TerrainProfile {
  const e = new Float64Array(n).fill(elev)
  const d = new Float64Array(n)
  for (let i = 0; i < n; i++) d[i] = distKm * i / (n - 1)
  return { elevations: e, distancesKm: d, totalDistanceKm: distKm, maxElevation: elev, minElevation: elev, avgElevation: elev, latlons: [] }
}

describe('computePathLoss', () => {
  it('flat 10km terrain ~ free space', () => {
    const result = computePathLoss(flatProfile(10), { frequencyMhz: 915, txHeightM: 10, rxHeightM: 1.5 })
    const fspl = 32.45 + 20 * Math.log10(915) + 20 * Math.log10(10)
    expect(result.freeSpaceLossDb).toBeCloseTo(fspl, 0)
    expect(result.pathLossDb).toBeGreaterThan(fspl)
    // Full ITM gives ~26.5 dB excess for 10 km flat terrain
    expect(result.pathLossDb).toBeLessThan(fspl + 30)
  })
  it('longer distance = more loss', () => {
    const near = computePathLoss(flatProfile(1), { frequencyMhz: 915, txHeightM: 10, rxHeightM: 1.5 })
    const far = computePathLoss(flatProfile(20), { frequencyMhz: 915, txHeightM: 10, rxHeightM: 1.5 })
    expect(far.pathLossDb).toBeGreaterThan(near.pathLossDb)
  })
  it('mountain has more loss than flat at same distance', () => {
    const flat = computePathLoss(flatProfile(10), { frequencyMhz: 915, txHeightM: 10, rxHeightM: 1.5 })
    const mountain: TerrainProfile = { ...flatProfile(10), maxElevation: 200, minElevation: 0, avgElevation: 50, elevations: new Float64Array(100).fill(0).map((_, i) => i > 40 && i < 60 ? 200 : 0) }
    const mountainResult = computePathLoss(mountain, { frequencyMhz: 915, txHeightM: 10, rxHeightM: 1.5 })
    expect(mountainResult.pathLossDb).toBeGreaterThanOrEqual(flat.pathLossDb)
  })
})
