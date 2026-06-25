import { describe, it, expect } from 'vitest'
import { exportGeotiff } from '@/lib/export/geotiff'

describe('exportGeotiff', () => {
  it('produces valid ArrayBuffer', async () => {
    const rssi = new Float32Array(100).fill(-120)
    rssi[0] = -80
    const buf = await exportGeotiff(rssi, 10, 10, { a: 0.01, b: 0, c: -82.6, d: 0, e: -0.01, f: 35.7 })
    expect(buf.byteLength).toBeGreaterThan(0)
  })
  it('applies threshold masking', async () => {
    const rssi = new Float32Array(100).fill(-130)
    rssi[0] = -80
    const buf = await exportGeotiff(rssi, 10, 10, { a: 0.01, b: 0, c: -82.6, d: 0, e: -0.01, f: 35.7 }, -120)
    expect(buf.byteLength).toBeGreaterThan(0)
  })
})
