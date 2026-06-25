export const EARTH_RADIUS_KM = 6371.0

function toRad(deg: number): number { return (deg * Math.PI) / 180 }
function toDeg(rad: number): number { return (rad * 180) / Math.PI }

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))))
}

export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2))
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1))
  let b = toDeg(Math.atan2(y, x)); if (b < 0) b += 360; return b
}

export function intermediatePoint(lat1: number, lon1: number, lat2: number, lon2: number, fraction: number): [number, number] {
  const rLat1 = toRad(lat1), rLon1 = toRad(lon1), rLat2 = toRad(lat2), rLon2 = toRad(lon2)
  const d = haversineDistance(lat1, lon1, lat2, lon2) / EARTH_RADIUS_KM
  if (d < 1e-12) return [lat1, lon1]
  const a = Math.sin((1 - fraction) * d) / Math.sin(d), b = Math.sin(fraction * d) / Math.sin(d)
  const x = a * Math.cos(rLat1) * Math.cos(rLon1) + b * Math.cos(rLat2) * Math.cos(rLon2)
  const y = a * Math.cos(rLat1) * Math.sin(rLon1) + b * Math.cos(rLat2) * Math.sin(rLon2)
  const z = a * Math.sin(rLat1) + b * Math.sin(rLat2)
  return [toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]
}

export function destinationPoint(lat: number, lon: number, bearingDeg: number, distanceKm: number): [number, number] {
  const rLat = toRad(lat), rLon = toRad(lon), theta = toRad(bearingDeg), d = distanceKm / EARTH_RADIUS_KM
  const outLat = Math.asin(Math.sin(rLat) * Math.cos(d) + Math.cos(rLat) * Math.sin(d) * Math.cos(theta))
  const outLon = rLon + Math.atan2(Math.sin(theta) * Math.sin(d) * Math.cos(rLat), Math.cos(d) - Math.sin(rLat) * Math.sin(outLat))
  return [toDeg(outLat), toDeg(outLon)]
}
