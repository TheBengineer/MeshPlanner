import type { CandidateSite, SiteType } from '../types'

const SITE_TYPE_VALUES: readonly SiteType[] = ['existing', 'required-coverage', 'relay-candidate']

interface GeoJSONFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties?: Record<string, unknown>
}

interface GeoJSONCollection {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

export function parseSitesGeoJson(text: string): CandidateSite[] {
  const data = JSON.parse(text) as GeoJSONCollection
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error('Invalid GeoJSON: expected FeatureCollection')
  }
  
  const sites: CandidateSite[] = []
  const seenNames = new Set<string>()
  let counter = 0
  
  for (const feature of data.features) {
    counter++
    if (feature.type !== 'Feature' || feature.geometry?.type !== 'Point') continue
    const [lon, lat] = feature.geometry.coordinates
    if (typeof lat !== 'number' || typeof lon !== 'number') continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    
    const props = feature.properties ?? {}
    const name = String(props?.name ?? props?.Name ?? `Site ${counter}`)
    const uniqueName = seenNames.has(name) ? `${name} (${counter})` : name
    seenNames.add(uniqueName)
    
    const siteTypeRaw = props?.siteType !== undefined ? String(props.siteType).toLowerCase() : undefined
    const siteType: SiteType | undefined = SITE_TYPE_VALUES.includes(siteTypeRaw as SiteType)
      ? (siteTypeRaw as SiteType)
      : undefined

    sites.push({
      name: uniqueName,
      latitude: lat,
      longitude: lon,
      elevationM: props?.elevation_m !== undefined ? Number(props.elevation_m) : undefined,
      notes: props?.notes !== undefined ? String(props.notes) : undefined,
      siteType,
    })
  }
  
  return sites
}

export function exportSitesGeoJson(sites: CandidateSite[]): string {
  const features = sites.map(s => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [s.longitude, s.latitude] as [number, number] },
    properties: {
      name: s.name,
      elevation_m: s.elevationM ?? null,
      notes: s.notes ?? null,
      siteType: s.siteType ?? null,
    },
  }))
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2)
}
