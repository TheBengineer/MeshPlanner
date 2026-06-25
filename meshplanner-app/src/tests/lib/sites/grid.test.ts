import { describe, it, expect } from 'vitest'
import { generateGrid, generateGridWithinPolygon } from '@/lib/sites/grid'
import type { Bbox } from '@/lib/types'

describe('generateGrid', () => {
  it('generates a grid with sequential naming', () => {
    // 2° × 2° bbox with ~111.32 km spacing → 1° lat steps
    // lon_step = 1 / cos(mid_lat) = 1 / cos(1°) ≈ 1.00015
    const bbox: Bbox = { west: 0, south: 0, east: 2, north: 2 }
    const sites = generateGrid(bbox, 111.32, 'Test')
    // 3 lat values (0, 1, 2) × 2 lon values (0, 1.00015) = 6
    expect(sites).toHaveLength(6)
    expect(sites[0]?.name).toBe('Test-0-0')
    expect(sites[0]?.latitude).toBe(0)
    expect(sites[0]?.longitude).toBe(0)
    expect(sites[2]?.name).toBe('Test-1-0')
    expect(sites[2]?.latitude).toBe(1)
    expect(sites[2]?.longitude).toBe(0)
    expect(sites[3]?.name).toBe('Test-1-1')
    expect(sites[5]?.name).toBe('Test-2-1')
    expect(sites[5]?.latitude).toBe(2)
    expect(sites[5]?.longitude).toBeGreaterThan(1)
  })

  it('uses default name prefix "Grid"', () => {
    const bbox: Bbox = { west: 0, south: 0, east: 1, north: 1 }
    const sites = generateGrid(bbox, 111.32)
    expect(sites[0]?.name).toBe('Grid-0-0')
  })

  it('returns empty for degenerate bounding box (north <= south)', () => {
    const bbox1: Bbox = { west: 0, south: 1, east: 2, north: 0 }
    expect(generateGrid(bbox1, 1)).toEqual([])
    const bbox2: Bbox = { west: 0, south: 0, east: 2, north: 0 }
    expect(generateGrid(bbox2, 1)).toEqual([])
  })

  it('returns empty for degenerate bounding box (east <= west)', () => {
    const bbox: Bbox = { west: 1, south: 0, east: 0, north: 1 }
    expect(generateGrid(bbox, 1)).toEqual([])
    const bbox2: Bbox = { west: 2, south: 0, east: 2, north: 1 }
    expect(generateGrid(bbox2, 1)).toEqual([])
  })

  it('returns empty for zero or negative spacing', () => {
    const bbox: Bbox = { west: 0, south: 0, east: 1, north: 1 }
    expect(generateGrid(bbox, 0)).toEqual([])
    expect(generateGrid(bbox, -1)).toEqual([])
  })

  it('produces at least one site even for a tiny bbox', () => {
    const bbox: Bbox = { west: 0, south: 0, east: 0.001, north: 0.001 }
    const sites = generateGrid(bbox, 1)
    expect(sites).toHaveLength(1)
  })

  it('names sites sequentially in row-major order', () => {
    // At mid_lat=0, cos=1, so lat_step = lon_step = 1.0
    const bbox: Bbox = { west: -1, south: -1, east: 1, north: 1 }
    const sites = generateGrid(bbox, 111.32, 'S')
    expect(sites).toHaveLength(9)
    // Row 0: lat ≈ -1
    expect(sites[0]?.name).toBe('S-0-0')
    expect(sites[0]?.latitude).toBeCloseTo(-1, 10)
    expect(sites[0]?.longitude).toBeCloseTo(-1, 10)
    expect(sites[2]?.name).toBe('S-0-2')
    expect(sites[2]?.longitude).toBeCloseTo(1, 10)
    // Row 1: lat ≈ 0
    expect(sites[3]?.name).toBe('S-1-0')
    expect(sites[3]?.latitude).toBeCloseTo(0, 10)
    // Row 2: lat ≈ 1
    expect(sites[8]?.name).toBe('S-2-2')
    expect(sites[8]?.latitude).toBeCloseTo(1, 10)
    expect(sites[8]?.longitude).toBeCloseTo(1, 10)
  })

  it('generates more sites with smaller spacing', () => {
    const bbox: Bbox = { west: 0, south: 0, east: 1, north: 1 }
    const coarse = generateGrid(bbox, 55)
    const fine = generateGrid(bbox, 11)
    expect(fine.length).toBeGreaterThan(coarse.length)
  })

  it('handles negative coordinates', () => {
    const bbox: Bbox = { west: -5, south: -5, east: -4, north: -4 }
    const sites = generateGrid(bbox, 111.32, 'Neg')
    expect(sites.length).toBeGreaterThanOrEqual(1)
    expect(sites[0]?.latitude).toBeLessThan(-4)
    expect(sites[0]?.name).toBe('Neg-0-0')
  })
})

describe('generateGridWithinPolygon', () => {
  const fullBbox: Bbox = { west: 0, south: 0, east: 2, north: 2 }
  const fullGrid = generateGrid(fullBbox, 111.32)
  const fullCount = fullGrid.length // 6

  it('returns grid sites inside a rectangular polygon', () => {
    const polygon: [number, number][] = [
      [0, 0], [2, 0], [2, 2], [0, 2], [0, 0],
    ]
    const sites = generateGridWithinPolygon(polygon, 111.32)
    expect(sites.length).toBeGreaterThan(0)
    expect(sites.length).toBeLessThanOrEqual(fullCount)
    expect(sites[0]?.name).toBe('Grid-0-0')
  })

  it('filters sites outside a triangle polygon', () => {
    const polygon: [number, number][] = [
      [0, 0], [2, 0], [0, 2], [0, 0],
    ]
    const sites = generateGridWithinPolygon(polygon, 111.32)
    expect(sites.length).toBeLessThan(fullCount)
    expect(sites.length).toBeGreaterThan(0)
    for (const site of sites) {
      expect(site.latitude + site.longitude).toBeLessThanOrEqual(2 + 1e-10)
    }
  })

  it('works with a counter-clockwise polygon', () => {
    const polygon: [number, number][] = [
      [0, 0], [0, 2], [2, 2], [2, 0], [0, 0],
    ]
    const sites = generateGridWithinPolygon(polygon, 111.32)
    expect(sites.length).toBeGreaterThan(0)
    expect(sites.length).toBeLessThanOrEqual(fullCount)
  })

  it('returns empty for polygon with < 3 vertices', () => {
    expect(generateGridWithinPolygon([], 1)).toEqual([])
    expect(generateGridWithinPolygon([[0, 0]], 1)).toEqual([])
    expect(generateGridWithinPolygon([[0, 0], [1, 1]], 1)).toEqual([])
  })

  it('returns empty when polygon bbox is degenerate', () => {
    // All points at same coordinate → bbox has north=south, east=west
    const polygon: [number, number][] = [
      [0, 0], [0, 0], [0, 0],
    ]
    const sites = generateGridWithinPolygon(polygon, 100)
    expect(sites).toEqual([])
  })

  it('handles polygon that contains only a subset of grid points', () => {
    const polygon: [number, number][] = [
      [0.6, 0.6], [1.4, 0.6], [1.4, 1.4], [0.6, 1.4], [0.6, 0.6],
    ]
    const sites = generateGridWithinPolygon(polygon, 111.32)
    expect(sites.length).toBeGreaterThanOrEqual(1)
    for (const site of sites) {
      expect(site.latitude).toBeGreaterThanOrEqual(0.6)
      expect(site.latitude).toBeLessThanOrEqual(1.4)
      expect(site.longitude).toBeGreaterThanOrEqual(0.6)
      expect(site.longitude).toBeLessThanOrEqual(1.4)
    }
  })
})
