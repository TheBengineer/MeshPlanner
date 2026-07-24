import { getTileRange } from './tile-coords'
import { getFromCache, storeInCache } from './cache'
import type { Bbox } from '../types'

interface DemTile {
  data: Float32Array
  width: number
  height: number
  /** Affine in Web Mercator meters (EPSG:3857) */
  affine: {
    a: number  // pixel width (m)
    b: number
    c: number  // top-left x (Web Mercator)
    d: number
    e: number  // pixel height (m, negative)
    f: number  // top-left y (Web Mercator)
  }
}

const HALF_CIRCUMFERENCE = 20037508.34

/**
 * Compute TMS tile bounds in Web Mercator meters.
 * Standard TMS: 2^z × 2^z tiles covering the full Web Mercator extent.
 */
function tmsTileBounds(zoom: number, x: number, y: number): { west: number; north: number; east: number; south: number } {
  const numTiles = Math.pow(2, zoom)
  const worldMeters = HALF_CIRCUMFERENCE * 2
  const west = (x / numTiles) * worldMeters - HALF_CIRCUMFERENCE
  const north = HALF_CIRCUMFERENCE - (y / numTiles) * worldMeters
  const east = ((x + 1) / numTiles) * worldMeters - HALF_CIRCUMFERENCE
  const south = HALF_CIRCUMFERENCE - ((y + 1) / numTiles) * worldMeters
  return { west, north, east, south }
}

async function fetchTile(url: string, zoom: number, x: number, y: number): Promise<DemTile> {
  const resp = await fetch(url)
  if (!resp.ok) {
    throw new Error(`Failed to fetch DEM tile: ${resp.status}`)
  }
  const buf = await resp.arrayBuffer()
  const { fromArrayBuffer } = await import('geotiff')
  const tiff = await fromArrayBuffer(buf)
  const image = await tiff.getImage()
  const rasters = (await image.readRasters()) as Float32Array[]
  const data = rasters[0] as Float32Array
  const width = image.getWidth()
  const height = image.getHeight()

  // Compute the tile's affine from TMS coordinates rather than GeoTIFF
  // metadata, which can be unreliable (tiepoints may be incomplete).
  const bounds = tmsTileBounds(zoom, x, y)
  const pixelSizeX = (bounds.east - bounds.west) / width
  const pixelSizeY = (bounds.north - bounds.south) / height

  return {
    data,
    width,
    height,
    affine: {
      a: pixelSizeX,
      b: 0,
      c: bounds.west,
      d: 0,
      e: -pixelSizeY,
      f: bounds.north,
    },
  }
}

function sampleTileIntoArray(
  demArray: Float32Array,
  demWidth: number,
  demHeight: number,
  demAffine: { a: number; c: number; f: number; e: number },
  tile: DemTile,
): void {
  // The tile is in Web Mercator (EPSG:3857) with meters-per-pixel affine.
  // Our DEM is in geographic coordinates (EPSG:4326). Convert lat/lon to
  // Web Mercator before looking up tile pixels.
  const tileLonMin = tile.affine.c
  const tileLatMax = tile.affine.f
  const tileLonMax = tileLonMin + tile.width * tile.affine.a
  const tileLatMin = tileLatMax + tile.height * tile.affine.e

  // Web Mercator forward projection: lat/lon → meters
  const HALF_CIRCUMFERENCE = 20037508.34 // half the Earth's circumference in meters

  for (let row = 0; row < demHeight; row++) {
    for (let col = 0; col < demWidth; col++) {
      const lon = demAffine.c + col * demAffine.a
      const lat = demAffine.f + row * demAffine.e

      // Convert lat/lon to Web Mercator meters
      const mx = lon * HALF_CIRCUMFERENCE / 180
      const my = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * HALF_CIRCUMFERENCE / Math.PI

      // Check if this point falls within the tile bounds (in Web Mercator space)
      if (
        mx >= tileLonMin &&
        mx < tileLonMax &&
        my <= tileLatMax &&  // tileLatMax is the top (north) in Web Mercator
        my > tileLatMin     // tileLatMin is the bottom (south)
      ) {
        const tileCol = Math.floor((mx - tileLonMin) / tile.affine.a)
        const tileRow = Math.floor((tileLatMax - my) / Math.abs(tile.affine.e))
        if (
          tileCol >= 0 &&
          tileCol < tile.width &&
          tileRow >= 0 &&
          tileRow < tile.height
        ) {
          demArray[row * demWidth + col] =
            tile.data[tileRow * tile.width + tileCol]!
        }
      }
    }
  }
}

export async function fetchDemRaster(
  bbox: Bbox,
  onProgress?: (pct: number) => void,
  zoom: number = 12,
): Promise<{
  data: Float32Array
  width: number
  height: number
  affine: { a: number; c: number; f: number; e: number }
}> {
  const { xMin, xMax, yMin, yMax } = getTileRange(
    bbox.west,
    bbox.south,
    bbox.east,
    bbox.north,
    zoom,
  )
  const nTiles = (xMax - xMin + 1) * (Math.abs(yMax - yMin) + 1)

  // Square-degree pixels — MapLibre handles Mercator projection naturally
  const kmPerDeg = 111.32
  const pixelDeg = (30 / 1000 / kmPerDeg) * (12 / zoom)

  const width = Math.max(1, Math.ceil((bbox.east - bbox.west) / pixelDeg))
  const height = Math.max(1, Math.ceil((bbox.north - bbox.south) / pixelDeg))

  const demArray = new Float32Array(width * height).fill(-32768)
  const demAffine = {
    a: pixelDeg,
    c: bbox.west,
    f: bbox.north,
    e: -pixelDeg,
  }

  let completed = 0
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMax; y <= yMin; y++) { // TMS y increases southward
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/geotiff/${zoom}/${x}/${y}.tif`
      const cacheKey = `${zoom}/${x}/${y}`

      try {
        const cached = await getFromCache(cacheKey)
        let tile: DemTile | null = null
        if (cached) {
          const parsed = JSON.parse(cached)
          // Recompute affine from TMS coords — old cached tiles have wrong
          // GeoTIFF tiepoints. Keep the raw elevation data only.
          const bounds = tmsTileBounds(zoom, x, y)
          const w = parsed.width as number
          const h = parsed.height as number
          tile = {
            data: parsed.data,
            width: w, height: h,
            affine: { a: (bounds.east - bounds.west) / w, b: 0, c: bounds.west, d: 0, e: -(bounds.north - bounds.south) / h, f: bounds.north },
          }
        } else {
          tile = await fetchTile(url, zoom, x, y)
          // Store raw elevation data only (affine is computed from TMS)
          const { data, width, height } = tile
          await storeInCache(cacheKey, JSON.stringify({ data, width, height }))
        }
        sampleTileIntoArray(demArray, width, height, demAffine, tile)
      } catch (err) {
        console.warn(`Failed to load tile ${cacheKey}:`, err)
      }

      completed++
      onProgress?.(Math.round((completed / nTiles) * 100))
    }
  }

  return { data: demArray, width, height, affine: demAffine }
}
