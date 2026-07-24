import { Affine } from "../lib/math/affine"
import { destinationPoint, haversineDistance, bearing } from "../lib/math/geodetic"
import { angularInterpolate } from "../lib/math/interpolation"
import type { CoverageRaster, LoraParams } from "../lib/types"
import { useStore } from "../store"

/* ── Fallback: main-thread computation when Workers are unavailable ── */

import { computeCoverageRaster as computeMainThread } from "../lib/propagation/coverage"

/* ── Ported from meshtastic-site-planner: contiguous radial slices ── */

function sliceRadials(total: number, workers: number): { start: number; end: number }[] {
  const n = Math.max(1, Math.min(workers, total))
  const per = Math.ceil(total / n)
  const slices: { start: number; end: number }[] = []
  for (let start = 0; start < total; start += per)
    slices.push({ start, end: Math.min(start + per, total) })
  return slices
}

interface WorkerRaster {
  signal: Float32Array
  mask: Uint8Array
}

/**
 * Ported from meshtastic-site-planner's merge.ts.
 * First-touch merge: workers process contiguous radial slices, and
 * merging in ascending slice order with "first set wins" reproduces the
 * single-threaded result — any pixel a later slice computed that an
 * earlier slice also computed is overridden by the earlier slice's value.
 */
function mergeFirstTouch(parts: WorkerRaster[], cells: number): { signal: Float32Array; mask: Uint8Array } {
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

/**
 * Fill pixels between radials via angular interpolation, searching nearby
 * distance steps to handle the 0.2 km quantization of the radial sweep.
 */
function fillCoverageGaps(
  rssi: Float32Array,
  width: number,
  height: number,
  demAffine: { a: number; c: number; f: number; e: number },
  txLat: number,
  txLon: number,
  maxRangeKm: number,
  numRadials: number,
): void {
  const pixelCount = width * height
  const anglePerRadial = 360 / numRadials
  const stepKm = 0.2

  const sampleRadial = (angle: number, dist: number): number => {
    const searchDeltas = [0, stepKm, -stepKm, 2 * stepKm, -2 * stepKm, 3 * stepKm, -3 * stepKm]
    for (const delta of searchDeltas) {
      const d = dist + delta
      if (d < stepKm || d > maxRangeKm) continue
      const [slat, slon] = destinationPoint(txLat, txLon, angle, d)
      const sc = Math.round((slon - demAffine.c) / demAffine.a)
      const sr = Math.round((slat - demAffine.f) / demAffine.e)
      if (sc >= 0 && sc < width && sr >= 0 && sr < height) {
        const v = rssi[sr * width + sc]
        if (v !== undefined && v > -Infinity) return v
      }
    }
    return -Infinity
  }

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col
      if (idx >= pixelCount) continue
      if ((rssi[idx] ?? -Infinity) > -Infinity) continue

      const lon = demAffine.c + col * demAffine.a
      const lat = demAffine.f + row * demAffine.e
      const dist = haversineDistance(txLat, txLon, lat, lon)
      if (dist > maxRangeKm || dist < 0.001) continue

      const bear = bearing(txLat, txLon, lat, lon)
      const radialIdx = Math.floor(bear / anglePerRadial) % numRadials
      const leftAngle = radialIdx * anglePerRadial
      const rightAngle = ((radialIdx + 1) % numRadials) * anglePerRadial

      const leftRssi = sampleRadial(leftAngle, dist)
      const rightRssi = sampleRadial(rightAngle, dist)

      if (leftRssi > -Infinity && rightRssi > -Infinity) {
        rssi[idx] = angularInterpolate(leftRssi, rightRssi, leftAngle, rightAngle, bear)
      } else if (leftRssi > -Infinity) {
        rssi[idx] = leftRssi
      } else if (rightRssi > -Infinity) {
        rssi[idx] = rightRssi
      }
    }
  }
}

/* ── Public API ── */

/**
 * Compute a coverage RSSI raster for a single transmitter using Web Workers.
 *
 * Splits radials into contiguous slices across workers (ported from
 * meshtastic-site-planner), merges via first-touch (earlier slices win),
 * then fills coverage gaps via angular interpolation.
 */
export async function computeCoverageWithWorkers(
  demData: Float32Array,
  demWidth: number,
  demHeight: number,
  demAffine: { a: number; c: number; f: number; e: number },
  txLat: number,
  txLon: number,
  params: LoraParams,
  maxRangeKm: number = 30,
  numRadials: number = 360,
): Promise<CoverageRaster> {
  const setProgress = useStore.getState().setProgress

  // ---- Fallback: Worker API unavailable --------------------------------
  if (typeof Worker === "undefined") {
    setProgress({ current: 0, total: 1, label: "Workers unavailable, using main thread…" })
    const raster = computeMainThread(
      demData,
      demWidth,
      demHeight,
      demAffine,
      txLat,
      txLon,
      params,
      maxRangeKm,
      numRadials,
    )
    setProgress(null)
    return raster
  }

  // ---- Determine worker count and distribution (sliced, ported from meshtastic) ---
  const numWorkers = Math.min(navigator.hardwareConcurrency || 4, numRadials)
  const slices = sliceRadials(numRadials, numWorkers)

  setProgress({
    current: 0,
    total: numRadials,
    label: `Starting ${slices.length} workers…`,
  })

  const workers: Worker[] = []
  const workerPromises: Promise<WorkerRaster>[] = []
  const workerProgressMap = new Map<number, number>()
  let globalProgress = 0

  // ---- Spawn workers ---------------------------------------------------
  for (let wi = 0; wi < slices.length; wi++) {
    const { start, end } = slices[wi]!
    const count = end - start
    if (count <= 0) break

    let worker: Worker
    try {
      worker = new Worker(new URL("./coverage.worker.ts", import.meta.url), {
        type: "module",
      })
    } catch (err) {
      console.warn("Worker creation failed, falling back to main thread:", err)
      for (const w of workers) w.terminate()
      setProgress({ current: 0, total: 1, label: "Falling back to main thread…" })
      const raster = computeMainThread(
        demData,
        demWidth,
        demHeight,
        demAffine,
        txLat,
        txLon,
        params,
        maxRangeKm,
        numRadials,
      )
      setProgress(null)
      return raster
    }

    workers.push(worker)
    workerProgressMap.set(wi, 0)

    const promise = new Promise<WorkerRaster>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        const data = e.data
        if (data.type === "progress") {
          const prev = workerProgressMap.get(wi) ?? 0
          const delta = (data.radialsDone as number) - prev
          workerProgressMap.set(wi, data.radialsDone as number)
          globalProgress += delta
          setProgress({
            current: Math.min(globalProgress, numRadials),
            total: numRadials,
            label: `Computing coverage… ${Math.min(globalProgress, numRadials)}/${numRadials} radials`,
          })
        } else if (data.type === "result") {
          resolve({ signal: data.signal as Float32Array, mask: data.mask as Uint8Array })
        }
      }

      worker.onerror = (ev: Event | string) => {
        const msg =
          typeof ev === "string"
            ? ev
            : (ev as ErrorEvent).message ?? "Unknown worker error"
        reject(new Error(`Worker error: ${msg}`))
      }

      worker.onmessageerror = (ev: MessageEvent) => {
        reject(new Error(`Worker deserialization error: ${ev.data}`))
      }
    })

    workerPromises.push(promise)

    const demCopy = new Float32Array(demData)
    worker.postMessage(
      {
        demData: demCopy,
        demWidth,
        demHeight,
        demAffine,
        txLat,
        txLon,
        params,
        radialStart: start,
        radialCount: count,
        maxRangeKm,
        numRadials,
      },
      [demCopy.buffer],
    )
  }

  // ---- Wait for all workers to complete ---------------------------------
  let partials: WorkerRaster[]
  try {
    partials = await Promise.all(workerPromises)
  } catch (err) {
    console.warn("Worker computation failed, falling back to main thread:", err)
    for (const w of workers) w.terminate()
    setProgress({ current: 0, total: 1, label: "Falling back to main thread…" })
    const raster = computeMainThread(
      demData,
      demWidth,
      demHeight,
      demAffine,
      txLat,
      txLon,
      params,
      maxRangeKm,
      numRadials,
    )
    setProgress(null)
    return raster
  }

  // ---- First-touch merge (ported from meshtastic) -----------------------
  const pixelCount = demWidth * demHeight
  setProgress({
    current: numRadials,
    total: numRadials,
    label: "Merging worker results…",
  })
  const merged = mergeFirstTouch(partials, pixelCount)

  const rssi = new Float32Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    rssi[i] = (merged.mask[i]! & 248) !== 0 ? merged.signal[i]! : -Infinity
  }

  // ---- Fill gap pixels between radials ----------------------------------
  setProgress({
    current: numRadials,
    total: numRadials,
    label: "Filling coverage gaps…",
  })
  fillCoverageGaps(
    rssi,
    demWidth,
    demHeight,
    demAffine,
    txLat,
    txLon,
    maxRangeKm,
    numRadials,
  )

  // ---- Cleanup ----------------------------------------------------------
  for (const w of workers) w.terminate()
  setProgress(null)

  return {
    rssi,
    width: demWidth,
    height: demHeight,
    affine: new Affine(demAffine.a, 0, demAffine.c, 0, demAffine.e, demAffine.f),
    txLat,
    txLon,
    params,
    maxRangeKm,
    numRadials,
  }
}
