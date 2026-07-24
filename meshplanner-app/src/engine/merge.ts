/* Ported from meshtastic-site-planner's merge.ts.
 * First-touch merge and radial slicing. */

export interface WorkerRaster {
  signal: Float32Array
  mask: Uint8Array
}

export function mergeFirstTouch(parts: WorkerRaster[], cells: number): WorkerRaster {
  const signal = new Float32Array(cells)
  const mask = new Uint8Array(cells)
  for (let i = 0; i < cells; i++) signal[i] = -Infinity

  for (const part of parts) {
    if (part.signal.length !== cells || part.mask.length !== cells)
      throw new Error('worker raster size mismatch')
    for (let i = 0; i < cells; i++) {
      if ((mask[i]! & 248) === 0 && (part.mask[i]! & 248) !== 0) {
        mask[i] = part.mask[i]!
        signal[i] = part.signal[i]!
      }
    }
  }
  return { signal, mask }
}

export function sliceRadials(total: number, workers: number): { start: number; end: number }[] {
  const n = Math.max(1, Math.min(workers, total))
  const per = Math.ceil(total / n)
  const slices: { start: number; end: number }[] = []
  for (let start = 0; start < total; start += per)
    slices.push({ start, end: Math.min(start + per, total) })
  return slices
}
