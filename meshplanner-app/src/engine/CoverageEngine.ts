/* Ported from meshtastic-site-planner's CoverageEngine.ts.
 * Public, backend-agnostic coverage engine interface. */

import type { EngineRunParams } from './core'

export type { EngineRunParams } from './core'

export interface CoverageProgress {
  phase: 'terrain' | 'compute' | 'finalize'
  completed: number
  total: number
  fraction: number
}

export interface CoverageResult {
  dbm: Float32Array
  width: number
  height: number
  bounds: { north: number; south: number; east: number; west: number }
  pixelDegrees: number
  stats: {
    radials: number
    pages: number
    pagesWithData: number
    itmWarnings: number[]
    elapsedMs: number
    workers: number
  }
}

export interface CoverageRunOptions {
  signal?: AbortSignal
  onProgress?: (p: CoverageProgress) => void
  /** Terrain data: pre-fetched DEM raster (equirectangular Float32Array). */
  demData: Float32Array
  demWidth: number
  demHeight: number
  demAffine: { a: number; c: number; f: number; e: number }
}

export interface CoverageEngine {
  readonly kind: 'js-workers'
  run(params: EngineRunParams, opts: CoverageRunOptions): Promise<CoverageResult>
  dispose(): void
}
