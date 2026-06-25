import { haversineDistance, intermediatePoint } from '../math/geodetic'
import { bilinearInterpolate } from '../math/interpolation'
import type { TerrainProfile } from '../types'

export function extractProfile(
  demData: Float32Array,
  demWidth: number,
  demHeight: number,
  demAffine: { a: number; c: number; f: number; e: number },
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  numPoints: number = 500,
): TerrainProfile {
  const totalDist = haversineDistance(lat1, lon1, lat2, lon2)
  const elevations = new Float64Array(numPoints)
  const distances = new Float64Array(numPoints)
  const latlons: [number, number][] = []
  let maxElev = -Infinity
  let minElev = Infinity
  let sumElev = 0
  let validCount = 0

  for (let i = 0; i < numPoints; i++) {
    const frac = numPoints > 1 ? i / (numPoints - 1) : 0
    const [lat, lon] = intermediatePoint(lat1, lon1, lat2, lon2, frac)
    latlons.push([lat, lon])
    distances[i] = totalDist * frac
    const col = (lon - demAffine.c) / demAffine.a
    const row = (lat - demAffine.f) / demAffine.e
    const elev = bilinearInterpolate(demData, demWidth, demHeight, col, row)
    elevations[i] = elev ?? 0
    if (elev !== null) {
      validCount++
      sumElev += elev
      if (elev > maxElev) maxElev = elev
      if (elev < minElev) minElev = elev
    }
  }

  return {
    elevations,
    distancesKm: distances,
    totalDistanceKm: totalDist,
    maxElevation: maxElev === -Infinity ? 0 : maxElev,
    minElevation: minElev === Infinity ? 0 : minElev,
    avgElevation: validCount > 0 ? sumElev / validCount : 0,
    latlons,
  }
}
