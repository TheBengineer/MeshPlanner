export function lonToTileX(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom))
}

export function latToTileY(lat: number, zoom: number): number {
  return Math.floor(
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180),
      ) /
        Math.PI) /
      2) *
      Math.pow(2, zoom),
  )
}

export function getTileRange(
  west: number,
  south: number,
  east: number,
  north: number,
  zoom: number,
): { xMin: number; xMax: number; yMin: number; yMax: number } {
  return {
    xMin: lonToTileX(west, zoom),
    xMax: lonToTileX(east, zoom),
    yMin: latToTileY(south, zoom),
    yMax: latToTileY(north, zoom),
  }
}

export function tileToLon(x: number, zoom: number): number {
  return (x / Math.pow(2, zoom)) * 360 - 180
}

export function tileToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom)
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}
