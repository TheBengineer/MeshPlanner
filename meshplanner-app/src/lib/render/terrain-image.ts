/**
 * Render DEM elevation data as a color-mapped terrain image overlay.
 * Same canvas + PNG data URL approach as coverage-image, but showing
 * elevation in meters instead of dBm.
 */

import { colormapLut } from './colormaps'

export interface TerrainImageResult {
  url: string
  coordinates: [[number, number], [number, number], [number, number], [number, number]]
}

export function terrainImage(
  demData: Float32Array,
  width: number,
  height: number,
  affine: { a: number; c: number; f: number; e: number },
): TerrainImageResult {
  // Find elevation range from the DEM
  let minEl = Infinity, maxEl = -Infinity
  for (let i = 0; i < width * height; i++) {
    const v = demData[i]
    if (v !== undefined && Number.isFinite(v) && v > -10000) {
      if (v < minEl) minEl = v
      if (v > maxEl) maxEl = v
    }
  }
  const span = maxEl > minEl ? maxEl - minEl : 1
  const lut = colormapLut('viridis')

  const north = affine.f
  const west = affine.c
  const south = affine.f + height * affine.e
  const east = affine.c + width * affine.a
  const pixelDeg = Math.abs(affine.a)

  // Colorize
  const srcRGBA = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const v = demData[i]
    let t = 0
    if (v !== undefined && Number.isFinite(v) && v > -10000) {
      t = (v - minEl) / span
      if (t < 0) t = 0
      if (t > 1) t = 1
    }
    const c = Math.round(t * 255) * 3
    const o = i * 4
    srcRGBA[o] = lut[c]!
    srcRGBA[o + 1] = lut[c + 1]!
    srcRGBA[o + 2] = lut[c + 2]!
    srcRGBA[o + 3] = 200
  }

  // Mercator reprojection (same as coverage-image)
  const mercatorY = (latDeg: number) => Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360))
  const latFromMercatorY = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI

  const yN = mercatorY(north)
  const yS = mercatorY(south)
  const out = new Uint8ClampedArray(srcRGBA.length)
  const rowBytes = width * 4
  for (let r = 0; r < height; r++) {
    const y = yN + ((r + 0.5) / height) * (yS - yN)
    const lat = latFromMercatorY(y)
    let srcRow = Math.floor((north - lat) / pixelDeg)
    if (srcRow < 0) srcRow = 0
    if (srcRow >= height) srcRow = height - 1
    out.set(srcRGBA.subarray(srcRow * rowBytes, (srcRow + 1) * rowBytes), r * rowBytes)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(new ImageData(out, width, height), 0, 0)

  return {
    url: canvas.toDataURL('image/png'),
    coordinates: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
  }
}
