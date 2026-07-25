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
  it('parses site_type column', () => {
    const csv = 'name,lat,lon,site_type\nSiteA,35.6,-82.5,existing\nSiteB,35.7,-82.4,required-coverage\nSiteC,35.8,-82.3,relay-candidate'
    const sites = parseSitesCsv(csv)
    expect(sites).toHaveLength(3)
    expect(sites[0]?.siteType).toBe('existing')
    expect(sites[1]?.siteType).toBe('required-coverage')
    expect(sites[2]?.siteType).toBe('relay-candidate')
  })
  it('ignores invalid site_type values', () => {
    const csv = 'name,lat,lon,site_type\nSiteA,35.6,-82.5,invalid\nSiteB,35.7,-82.4,'
    const sites = parseSitesCsv(csv)
    expect(sites).toHaveLength(2)
    expect(sites[0]?.siteType).toBeUndefined()
    expect(sites[1]?.siteType).toBeUndefined()
  })
  it('backward compatible without site_type column', () => {
    const csv = 'name,lat,lon\nSiteA,35.6,-82.5'
    const sites = parseSitesCsv(csv)
    expect(sites).toHaveLength(1)
    expect(sites[0]?.siteType).toBeUndefined()
    expect(sites[0]?.name).toBe('SiteA')
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
  it('preserves site_type through round-trip', () => {
    const sites = [{ name: 'A', latitude: 35.6, longitude: -82.5, siteType: 'required-coverage' }]
    const csv = exportSitesCsv(sites)
    const parsed = parseSitesCsv(csv)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.siteType).toBe('required-coverage')
  })
})
