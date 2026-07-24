/**
 * Coverage heatmap image overlay for MapLibre.
 *
 * Takes a CoverageRaster (equirectangular dBm grid) and renders it as a
 * PNG data URL corrected for Web Mercator distortion, ready to add as a
 * MapLibre `image` source + `raster` layer.
 *
 * Ported approach from meshtastic-site-planner: colorize via matplotlib LUTs,
 * row-sample to Mercator Y-space, render to canvas.
 */

import type { CoverageRaster } from '../types'
import { colormapLut } from './colormaps'

export type ColormapName = 'plasma' | 'viridis' | 'turbo' | 'jet'

export interface CoverageImageOptions {
  colormap: string
  minDbm: number
  maxDbm: number
  /** 0-1 opacity */
  opacity: number
  /** dBm threshold below which cells are transparent */
  sensitivityDbm: number
}

export interface CoverageImageResult {
  /** PNG data URL */
  url: string
  /** Image-source corners: [[w,n],[e,n],[e,s],[w,s]] in lng/lat */
  coordinates: [[number, number], [number, number], [number, number], [number, number]]
}

function mercatorY(latDeg: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360))
}

function latFromMercatorY(y: number): number {
  return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI
}

/**
 * Render a coverage raster into a Mercator-corrected PNG image overlay.
 */
export function coverageImage(
  raster: CoverageRaster,
  options: CoverageImageOptions,
): CoverageImageResult {
  const { rssi, width, height, affine } = raster
  const lut = colormapLut(options.colormap)
  const { minDbm, maxDbm, sensitivityDbm, opacity } = options
  const span = maxDbm > minDbm ? maxDbm - minDbm : 1
  const alpha = Math.round(255 * opacity)

  // Pixel-geometry from affine
  const pixelDeg = Math.abs(affine.a) // degrees per pixel (lon)
  const north = affine.f
  const west = affine.c
  const south = affine.f + height * affine.e // affine.e is negative
  const east = affine.c + width * affine.a

  // Step 1: colorize each source pixel into RGBA
  const srcRGBA = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const v = rssi[i]!
    if (Number.isNaN(v) || v < sensitivityDbm) continue // transparent
    let t = (v - minDbm) / span
    if (t < 0) t = 0
    if (t > 1) t = 1
    const c = Math.round(t * 255) * 3
    const o = i * 4
    srcRGBA[o] = lut[c]!
    srcRGBA[o + 1] = lut[c + 1]!
    srcRGBA[o + 2] = lut[c + 2]!
    srcRGBA[o + 3] = alpha
  }

  // Step 2: reproject rows from equirectangular to Web Mercator
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

  // Step 3: render to canvas → PNG data URL
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
