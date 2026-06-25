import { Affine } from "../lib/math/affine"
import { destinationPoint, haversineDistance, bearing } from "../lib/math/geodetic"
import { angularInterpolate } from "../lib/math/interpolation"
import type { CoverageRaster, LoraParams } from "../lib/types"
import { useStore } from "../store"

/* ── Fallback: main-thread computation when Workers are unavailable ── */

import { computeCoverageRaster as computeMainThread } from "../lib/propagation/coverage"

/* ── Internal helpers ── */

/**
 * Merge several partial RSSI rasters by taking the element-wise maximum.
 * Each worker's partial raster only has non-Infinity values where its
 * assigned radials hit; the rest remain -Infinity. Merging with max picks
 * the strongest signal at each pixel across all radials.
 */
function mergeRasters(partials: Float32Array[], pixelCount: number): Float32Array {
  const merged = new Float32Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    merged[i] = -Infinity
  }

  for (const partial of partials) {
    for (let i = 0; i < pixelCount; i++) {
      const v = partial[i]
      if (v !== undefined && v > (merged[i] ?? -Infinity)) {
        merged[i] = v
      }
    }
  }
  return merged
}

/**
 * Fill pixels between radials via angular interpolation.
 *
 * For every pixel that lies within range but wasn't directly hit by a
 * radial sample, interpolate the RSSI from the two nearest radials on
 * either side of the bearing from the transmitter.
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

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col
      if (idx >= pixelCount) continue
      if ((rssi[idx] ?? -Infinity) > -Infinity) continue

      const lon = demAffine.c + col * demAffine.a
      const lat = demAffine.f + row * demAffine.e
      const dist = haversineDistance(txLat, txLon, lat, lon)
      if (dist > maxRangeKm || dist < 0.1) continue

      const bear = bearing(txLat, txLon, lat, lon)

      const radialIdx = Math.floor(bear / anglePerRadial) % numRadials
      const leftAngle = radialIdx * anglePerRadial
      const rightAngle = ((radialIdx + 1) % numRadials) * anglePerRadial

      const [leftLat, leftLon] = destinationPoint(txLat, txLon, leftAngle, dist)
      const [rightLat, rightLon] = destinationPoint(txLat, txLon, rightAngle, dist)

      const leftCol = Math.round((leftLon - demAffine.c) / demAffine.a)
      const leftRow = Math.round((leftLat - demAffine.f) / demAffine.e)
      const rightCol = Math.round((rightLon - demAffine.c) / demAffine.a)
      const rightRow = Math.round((rightLat - demAffine.f) / demAffine.e)

      let leftRssi = -Infinity
      let rightRssi = -Infinity
      if (leftCol >= 0 && leftCol < width && leftRow >= 0 && leftRow < height) {
        leftRssi = rssi[leftRow * width + leftCol] ?? -Infinity
      }
      if (rightCol >= 0 && rightCol < width && rightRow >= 0 && rightRow < height) {
        rightRssi = rssi[rightRow * width + rightCol] ?? -Infinity
      }

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
 * Splits the 360 radials across `navigator.hardwareConcurrency` workers,
 * merges the partial results, fills coverage gaps via angular interpolation,
 * and reports progress to the Zustand store.
 *
 * Falls back to the existing main-thread `computeCoverageRaster` if the
 * Worker API is unavailable or any worker fails.
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

  // ---- Determine worker count and distribution --------------------------
  const numWorkers = Math.min(navigator.hardwareConcurrency || 4, numRadials)
  const radialsPerWorker = Math.ceil(numRadials / numWorkers)

  setProgress({
    current: 0,
    total: numRadials,
    label: `Starting ${numWorkers} workers…`,
  })

  const workers: Worker[] = []
  const workerPromises: Promise<Float32Array>[] = []
  const workerProgressMap = new Map<Worker, number>()
  let globalProgress = 0

  // ---- Spawn workers ---------------------------------------------------
  for (let wi = 0; wi < numWorkers; wi++) {
    const start = wi * radialsPerWorker
    const count = Math.min(radialsPerWorker, numRadials - start)
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
    workerProgressMap.set(worker, 0)

    const promise = new Promise<Float32Array>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        const data = e.data
        if (data.type === "progress") {
          const prev = workerProgressMap.get(worker) ?? 0
          const delta = (data.radialsDone as number) - prev
          workerProgressMap.set(worker, data.radialsDone as number)
          globalProgress += delta
          setProgress({
            current: Math.min(globalProgress, numRadials),
            total: numRadials,
            label: `Computing coverage… ${Math.min(globalProgress, numRadials)}/${numRadials} radials`,
          })
        } else if (data.type === "result") {
          resolve(data.rssi as Float32Array)
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

    // Transfer a fresh copy of the DEM data to each worker (zero-copy
    // via Transferable). We copy because the original must remain on
    // the main thread for multiple workers.
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
  let partialRasters: Float32Array[]
  try {
    partialRasters = await Promise.all(workerPromises)
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
  } finally {
    // Workers are terminated after all complete or on error in the catch
  }

  // ---- Merge results ----------------------------------------------------
  const pixelCount = demWidth * demHeight
  setProgress({
    current: numRadials,
    total: numRadials,
    label: "Merging worker results…",
  })
  const merged = mergeRasters(partialRasters, pixelCount)

  // ---- Fill gap pixels between radials ----------------------------------
  setProgress({
    current: numRadials,
    total: numRadials,
    label: "Filling coverage gaps…",
  })
  fillCoverageGaps(
    merged,
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
    rssi: merged,
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
