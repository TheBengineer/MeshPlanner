import { describe, it, expect } from 'vitest'
import {
  lonToTileX,
  latToTileY,
  tileToLon,
  tileToLat,
  getTileRange,
} from '@/lib/dem/tile-coords'

describe('lonToTileX', () => {
  it('Greenwich at z0 is 0', () => {
    expect(lonToTileX(0, 0)).toBe(0)
  })

  it('180°E at z0 is 1', () => {
    expect(lonToTileX(180, 0)).toBe(1)
  })

  it('Asheville at z12', () => {
    expect(lonToTileX(-82.6, 12)).toBe(1108)
  })
})

describe('latToTileY', () => {
  it('equator at z0 is 0', () => {
    expect(latToTileY(0, 0)).toBe(0)
  })

  it('Asheville at z12', () => {
    expect(latToTileY(35.7, 12)).toBe(1612)
  })
})

describe('round trip', () => {
  it('lon -> tileX -> lon', () => {
    const lon = -82.5
    const zoom = 12
    const x = lonToTileX(lon, zoom)
    const back = tileToLon(x, zoom)
    expect(Math.abs(back - lon)).toBeLessThan(360 / Math.pow(2, zoom))
  })

  it('lat -> tileY -> lat', () => {
    const lat = 35.6
    const zoom = 12
    const y = latToTileY(lat, zoom)
    const back = tileToLat(y, zoom)
    expect(Math.abs(back - lat)).toBeLessThan(5)
  })
})

describe('tileToLon', () => {
  it('tile 0 at z0 is -180', () => {
    expect(tileToLon(0, 0)).toBe(-180)
  })

  it('tile 1 at z0 is 180', () => {
    expect(tileToLon(1, 0)).toBe(180)
  })
})

describe('tileToLat', () => {
  it('tile 0 at z0 is ~85', () => {
    expect(tileToLat(0, 0)).toBeCloseTo(85.0511, 3)
  })

  it('tile 1 at z0 is ~-85', () => {
    expect(tileToLat(1, 0)).toBeCloseTo(-85.0511, 3)
  })
})

describe('getTileRange', () => {
  it('Asheville area at z12', () => {
    const range = getTileRange(-82.65, 35.5, -82.45, 35.65, 12)
    expect(range.xMin).toBe(1107)
    expect(range.xMax).toBe(1109)
    expect(range.yMin).toBe(1615)
    expect(range.yMax).toBe(1613)
  })
})
