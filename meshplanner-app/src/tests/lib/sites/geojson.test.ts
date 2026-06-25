import { describe, it, expect } from 'vitest'
import { parseSitesGeoJson, exportSitesGeoJson } from '@/lib/sites/geojson'

describe('parseSitesGeoJson', () => {
  it('parses valid FeatureCollection', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-82.5, 35.6] }, properties: { name: 'SiteA' } }],
    })
    const sites = parseSitesGeoJson(geojson)
    expect(sites).toHaveLength(1)
    expect(sites[0]?.name).toBe('SiteA')
  })
  it('throws on invalid GeoJSON', () => {
    expect(() => parseSitesGeoJson('{"type":"Invalid"}')).toThrow()
  })
})

describe('exportSitesGeoJson', () => {
  it('round-trips correctly', () => {
    const sites = [{ name: 'A', latitude: 35.6, longitude: -82.5 }]
    const json = exportSitesGeoJson(sites)
    const parsed = parseSitesGeoJson(json)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.name).toBe('A')
    expect(parsed[0]?.latitude).toBeCloseTo(35.6)
  })
})
