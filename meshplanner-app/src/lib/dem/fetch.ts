import { getTileRange } from './tile-coords'
import { getFromCache, storeInCache } from './cache'
import type { Bbox } from '../types'

interface DemTile {
  data: Float32Array
  width: number
  height: number
  affine: {
    a: number
    b: number
    c: number
    d: number
    e: number
    f: number
  }
}

async function fetchTile(url: string): Promise<DemTile> {
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
  const origin = image.getOrigin()
  const resolution = image.getResolution()
  return {
    data,
    width: image.getWidth(),
    height: image.getHeight(),
    affine: {
      a: resolution[0]!,
      b: 0,
      c: origin[0]!,
      d: 0,
      e: -resolution[1]!,
      f: origin[1]!,
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
  const tileLonMin = tile.affine.c
  const tileLatMax = tile.affine.f
  const tileLonMax = tileLonMin + tile.width * tile.affine.a
  const tileLatMin = tileLatMax + tile.height * tile.affine.e

  for (let row = 0; row < demHeight; row++) {
    for (let col = 0; col < demWidth; col++) {
      const lon = demAffine.c + col * demAffine.a
      const lat = demAffine.f + row * demAffine.e
      if (
        lon >= tileLonMin &&
        lon < tileLonMax &&
        lat >= tileLatMin &&
        lat < tileLatMax
      ) {
        // tile runs top-to-bottom, so row increases southward
        const tileCol = Math.floor((lon - tileLonMin) / tile.affine.a)
        const trueTileRow = Math.floor(
          (tileLatMax - lat) / Math.abs(tile.affine.e),
        )
        if (
          tileCol >= 0 &&
          tileCol < tile.width &&
          trueTileRow >= 0 &&
          trueTileRow < tile.height
        ) {
          demArray[row * demWidth + col] =
            tile.data[trueTileRow * tile.width + tileCol]!
        }
      }
    }
  }
}

export async function fetchDemRaster(
  bbox: Bbox,
  onProgress?: (pct: number) => void,
): Promise<{
  data: Float32Array
  width: number
  height: number
  affine: { a: number; c: number; f: number; e: number }
}> {
  const zoom = 12
  const { xMin, xMax, yMin, yMax } = getTileRange(
    bbox.west,
    bbox.south,
    bbox.east,
    bbox.north,
    zoom,
  )
  const nTiles = (xMax - xMin + 1) * (yMax - yMin + 1)

  // Calculate output dimensions from bbox at ~30m resolution
  const latRad =
    (((bbox.north + bbox.south) / 2) * Math.PI) / 180
  const kmPerDeg = 111.32
  const pixelSize = 30 / 1000 / kmPerDeg // ~30m in degrees at equator
  const lonPixelSize = pixelSize / Math.cos(latRad)

  const width = Math.ceil((bbox.east - bbox.west) / lonPixelSize)
  const height = Math.ceil((bbox.north - bbox.south) / pixelSize)

  const demArray = new Float32Array(width * height).fill(-32768)
  const demAffine = {
    a: lonPixelSize,
    c: bbox.west,
    f: bbox.north,
    e: -pixelSize,
  }

  let completed = 0
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/geotiff/${zoom}/${x}/${y}.tif`
      const cacheKey = `${zoom}/${x}/${y}`

      try {
        const cached = await getFromCache(cacheKey)
        const tile: DemTile = cached
          ? JSON.parse(cached)
          : await fetchTile(url)
        if (!cached) {
          await storeInCache(cacheKey, JSON.stringify(tile))
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
