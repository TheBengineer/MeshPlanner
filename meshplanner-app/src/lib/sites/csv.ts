import type { CandidateSite, SiteType } from '../types'

const SITE_TYPE_VALUES: readonly SiteType[] = ['existing', 'required-coverage', 'relay-candidate']

export function parseSitesCsv(text: string): CandidateSite[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const firstLine = lines[0]
  if (!firstLine) return []
  const header = firstLine.toLowerCase().split(',')
  const nameIdx = header.findIndex(h => h === 'name')
  const latIdx = header.findIndex(h => h === 'lat' || h === 'latitude')
  const lonIdx = header.findIndex(h => h === 'lon' || h === 'lng' || h === 'longitude' || h === 'long')
  const elevIdx = header.findIndex(h => h === 'elevation' || h === 'elevation_m' || h === 'elev')
  const notesIdx = header.findIndex(h => h === 'notes' || h === 'description')
  const siteTypeIdx = header.findIndex(h => h === 'site_type' || h === 'sitetype')
  
  if (nameIdx < 0 || latIdx < 0 || lonIdx < 0) {
    throw new Error('CSV must have columns: name, lat, lon')
  }
  
  const sites: CandidateSite[] = []
  const seenNames = new Set<string>()
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const cols = line.split(",")
    const nameRaw = cols[nameIdx]
    const latRaw = cols[latIdx]
    const lonRaw = cols[lonIdx]
    if (nameRaw === undefined || latRaw === undefined || lonRaw === undefined) continue

    const name = nameRaw.trim()
    const lat = parseFloat(latRaw)
    const lon = parseFloat(lonRaw)

    if (!name || isNaN(lat) || isNaN(lon)) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue

    const uniqueName = seenNames.has(name) ? `${name} (${i})` : name
    seenNames.add(uniqueName)

    const elevRaw = elevIdx >= 0 ? cols[elevIdx] : undefined
    const notesRaw = notesIdx >= 0 ? cols[notesIdx] : undefined
    const siteTypeRaw = siteTypeIdx >= 0 ? cols[siteTypeIdx]?.trim().toLowerCase() : undefined
    const siteType: SiteType | undefined = SITE_TYPE_VALUES.includes(siteTypeRaw as SiteType)
      ? (siteTypeRaw as SiteType)
      : undefined

    sites.push({
      name: uniqueName,
      latitude: lat,
      longitude: lon,
      elevationM: elevRaw !== undefined ? parseFloat(elevRaw) || undefined : undefined,
      notes: notesRaw?.trim() || undefined,
      siteType,
    })
  }
  
  return sites
}

export function exportSitesCsv(sites: CandidateSite[]): string {
  const rows = [['name', 'latitude', 'longitude', 'elevation_m', 'notes', 'site_type']]
  for (const s of sites) {
    rows.push([s.name, String(s.latitude), String(s.longitude), s.elevationM !== undefined ? String(s.elevationM) : '', s.notes ?? '', s.siteType ?? ''])
  }
  return rows.map(r => r.join(',')).join('\n')
}
