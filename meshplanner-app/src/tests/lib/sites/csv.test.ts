import { describe, it, expect } from 'vitest'
import { parseSitesCsv, exportSitesCsv } from '@/lib/sites/csv'

describe('parseSitesCsv', () => {
  it('parses valid CSV', () => {
    const csv = 'name,lat,lon\nSiteA,35.6,-82.5\nSiteB,35.7,-82.4'
    const sites = parseSitesCsv(csv)
    expect(sites).toHaveLength(2)
    expect(sites[0]?.name).toBe('SiteA')
    expect(sites[0]?.latitude).toBeCloseTo(35.6)
  })
  it('throws on missing columns', () => {
    expect(() => parseSitesCsv('name\nhello')).toThrow('CSV must have columns')
  })
  it('handles empty input', () => {
    expect(parseSitesCsv('')).toEqual([])
  })
  it('deduplicates names', () => {
    const csv = 'name,lat,lon\nSiteA,35,-82\nSiteA,36,-83'
    const sites = parseSitesCsv(csv)
    expect(sites).toHaveLength(2)
    expect(sites[1]?.name).toContain('SiteA')
  })
})

describe('exportSitesCsv', () => {
  it('round-trips correctly', () => {
    const sites = [{ name: 'A', latitude: 35.6, longitude: -82.5 }]
    const csv = exportSitesCsv(sites)
    const parsed = parseSitesCsv(csv)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.name).toBe('A')
  })
})
