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
  it('parses siteType property', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-82.5, 35.6] }, properties: { name: 'SiteA', siteType: 'existing' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-82.4, 35.7] }, properties: { name: 'SiteB', siteType: 'required-coverage' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-82.3, 35.8] }, properties: { name: 'SiteC', siteType: 'relay-candidate' } },
      ],
    })
    const sites = parseSitesGeoJson(geojson)
    expect(sites).toHaveLength(3)
    expect(sites[0]?.siteType).toBe('existing')
    expect(sites[1]?.siteType).toBe('required-coverage')
    expect(sites[2]?.siteType).toBe('relay-candidate')
  })
  it('ignores invalid siteType values', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-82.5, 35.6] }, properties: { name: 'SiteA', siteType: 'nonsense' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-82.4, 35.7] }, properties: { name: 'SiteB' } },
      ],
    })
    const sites = parseSitesGeoJson(geojson)
    expect(sites).toHaveLength(2)
    expect(sites[0]?.siteType).toBeUndefined()
    expect(sites[1]?.siteType).toBeUndefined()
  })
  it('backward compatible without siteType property', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-82.5, 35.6] }, properties: { name: 'SiteA' } }],
    })
    const sites = parseSitesGeoJson(geojson)
    expect(sites).toHaveLength(1)
    expect(sites[0]?.siteType).toBeUndefined()
    expect(sites[0]?.name).toBe('SiteA')
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
  it('preserves siteType through round-trip', () => {
    const sites = [{ name: 'A', latitude: 35.6, longitude: -82.5, siteType: 'existing' }]
    const json = exportSitesGeoJson(sites)
    const parsed = parseSitesGeoJson(json)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.siteType).toBe('existing')
  })
})
