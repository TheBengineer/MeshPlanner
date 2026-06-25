/**
 * Generate regular grids of candidate sites within a bounding box or polygon.
 *
 * Converts km spacing to lat/lon step sizes using the haversine approximation:
 *   - 1 degree latitude  ≈ 111.32 km (constant)
 *   - 1 degree longitude ≈ 111.32 * cos(lat) km (depends on latitude)
 *
 * Ported from Python's src/meshplanner/sites/grid.py.
 */

import type { CandidateSite, Bbox } from '../types'

const KM_PER_DEG_LAT = 111.32

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Convert a km spacing to lat/lon degree steps at a given reference latitude.
 */
function kmToDegSteps(
  spacingKm: number,
  latitude: number,
): { latStep: number; lonStep: number } {
  const latStep = spacingKm / KM_PER_DEG_LAT
  const lonStep = spacingKm / (KM_PER_DEG_LAT * Math.cos(degToRad(latitude)))
  return { latStep, lonStep }
}

/**
 * Ray-casting point-in-polygon test.
 *
 * Returns `true` when the point (lon, lat) lies inside the polygon defined by
 * `polygon` — an array of `[longitude, latitude]` pairs (matching the
 * convention used by the Python shapely code).
 */
function pointInPolygon(
  lon: number,
  lat: number,
  polygon: [number, number][],
): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i]!
    const [xj, yj] = polygon[j]!
    if (yi > lat !== yj > lat &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Generate a regular grid of candidate sites within a bounding box.
 *
 * @param bbox        Bounding box with keys `west`, `south`, `east`, `north`.
 * @param spacingKm   Target spacing between adjacent sites in kilometres
 *                    (default 1.0).
 * @param namePrefix  Prefix for site names (default "Grid").
 * @returns           List of CandidateSite objects named
 *                    `"{prefix}-{row}-{col}"`.
 */
export function generateGrid(
  bbox: Bbox,
  spacingKm: number = 1.0,
  namePrefix: string = 'Grid',
): CandidateSite[] {
  const { west, south, east, north } = bbox

  // Guard against degenerate bounding boxes
  if (spacingKm <= 0 || north <= south || east <= west) {
    return []
  }

  // Use the midpoint latitude for longitude step calculation
  const midLat = (south + north) / 2.0
  const { latStep, lonStep } = kmToDegSteps(spacingKm, midLat)

  if (latStep <= 0 || lonStep <= 0) {
    return []
  }

  const sites: CandidateSite[] = []

  // Generate rows from south to north, columns from west to east
  let lat = south
  let row = 0
  while (lat <= north + 1e-12) {
    let lon = west
    let col = 0
    while (lon <= east + 1e-12) {
      sites.push({
        name: `${namePrefix}-${row}-${col}`,
        latitude: lat,
        longitude: lon,
      })
      lon += lonStep
      col++
    }
    lat += latStep
    row++
  }

  return sites
}

/**
 * Generate a regular grid of candidate sites within an arbitrary polygon.
 *
 * A bounding-box grid is created first, then sites that fall outside the
 * polygon are filtered out via a ray-casting point-in-polygon test.
 *
 * @param polygonCoords  Array of `[longitude, latitude]` pairs defining the
 *                       polygon boundary (clockwise or counter-clockwise).
 * @param spacingKm      Target spacing between adjacent sites in kilometres
 *                       (default 1.0).
 * @returns              List of CandidateSite objects that lie inside the
 *                       polygon.
 */
export function generateGridWithinPolygon(
  polygonCoords: [number, number][],
  spacingKm: number = 1.0,
): CandidateSite[] {
  if (polygonCoords.length < 3) {
    return []
  }

  // Compute bounding box of the polygon
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  for (const [lon, lat] of polygonCoords) {
    if (lon < west) west = lon
    if (lat < south) south = lat
    if (lon > east) east = lon
    if (lat > north) north = lat
  }

  const bbox: Bbox = { west, south, east, north }

  // Generate full grid within the bbox, then filter
  const allSites = generateGrid(bbox, spacingKm, 'Grid')
  return allSites.filter(site =>
    pointInPolygon(site.longitude, site.latitude, polygonCoords),
  )
}
