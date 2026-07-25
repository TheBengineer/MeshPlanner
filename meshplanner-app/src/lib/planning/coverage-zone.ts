/**
 * Generate required-coverage candidate sites from a coverage zone polygon.
 *
 * Computes a regular grid of sample points within the polygon's bounding box
 * at the given spacing, then filters to points that fall inside the polygon
 * via ray casting. Each point is returned as a CandidateSite with
 * `siteType: 'required-coverage'`.
 */

import type { CandidateSite } from '../types'

const KM_PER_DEG_LAT = 111.32

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Ray-casting point-in-polygon test.
 *
 * @returns `true` when the point (lon, lat) lies inside the polygon defined by
 * an array of [longitude, latitude] pairs.
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
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Generate required-coverage candidate sites from a coverage zone polygon.
 *
 * @param polygon    Array of [longitude, latitude] pairs defining the polygon
 *                   boundary (GeoJSON convention).
 * @param spacingKm  Target spacing between adjacent sample points in kilometres
 *                   (default 2.0).
 * @returns          List of CandidateSite objects inside the polygon with
 *                   `siteType: 'required-coverage'`.
 */
export function generateRequiredSitesFromZone(
  polygon: [number, number][],
  spacingKm: number = 2.0,
): CandidateSite[] {
  if (polygon.length < 3 || spacingKm <= 0) {
    return []
  }

  // Compute bounding box of the polygon
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  for (const [lon, lat] of polygon) {
    if (lon < west) west = lon
    if (lat < south) south = lat
    if (lon > east) east = lon
    if (lat > north) north = lat
  }

  // Guard against degenerate bounding box
  if (north <= south || east <= west) {
    return []
  }

  // Use midpoint latitude for longitude step calculation
  const midLat = (south + north) / 2.0
  const latStep = spacingKm / KM_PER_DEG_LAT
  const lonStep =
    spacingKm / (KM_PER_DEG_LAT * Math.cos(degToRad(midLat)))

  if (latStep <= 0 || lonStep <= 0) {
    return []
  }

  const sites: CandidateSite[] = []
  let index = 0

  // Generate grid within bbox, keep only points inside polygon
  let lat = south
  while (lat <= north + 1e-12) {
    let lon = west
    while (lon <= east + 1e-12) {
      if (pointInPolygon(lon, lat, polygon)) {
        index++
        sites.push({
          name: `Coverage Zone ${index}`,
          latitude: lat,
          longitude: lon,
          siteType: 'required-coverage',
        })
      }
      lon += lonStep
    }
    lat += latStep
  }

  return sites
}
