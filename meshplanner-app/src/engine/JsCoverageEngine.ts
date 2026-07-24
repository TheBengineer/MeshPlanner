/* JS implementation of CoverageEngine, modeled directly on meshtastic's
 * WasmCoverageEngine architecture:
 *
 *   Scout → Compute (workers | main-thread) → Merge → Finalize
 *
 * The propagation math stays in JS (our ITM port), but the orchestrator,
 * worker protocol, merge strategy, and progress model match exactly.
 */

import { extractProfile } from '../lib/propagation/profile'
import { computePathLoss } from '../lib/propagation/itm'
import { calculateLinkBudget } from '../lib/math/link-budget'
import { destinationPoint, haversineDistance, bearing } from '../lib/math/geodetic'
import { angularInterpolate } from '../lib/math/interpolation'
import type { CoverageEngine, CoverageProgress, CoverageResult, CoverageRunOptions } from './CoverageEngine'
import type { EngineRunParams } from './core'
import { yieldToEventLoop } from './core'
import { mergeFirstTouch, sliceRadials, type WorkerRaster } from './merge'
import type { DoneMessage, FromWorker, ToWorker } from './protocol'

const RADIAL_CHUNK = 32
const TERRAIN_SPAN = 0.15
const COMPUTE_SPAN = 0.83

function isMobileOrLowMemory(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua)
  const deviceMemory = (navigator as any).deviceMemory
  return mobile || (deviceMemory !== undefined && deviceMemory < 4)
}

function defaultPoolSize(): number {
  if (typeof navigator === 'undefined') return 4
  let n = Math.min(navigator.hardwareConcurrency || 4, 8)
  const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory
  if (deviceMemory !== undefined && deviceMemory <= 4) n = Math.min(n, 2)
  return Math.max(1, n)
}

interface PoolWorker {
  worker: Worker
  handler: ((msg: FromWorker) => void) | null
}

/* ── Gap-filling: angular interpolation with distance-window search ── */

function fillGaps(
  rssi: Float32Array,
  width: number,
  height: number,
  affine: { a: number; c: number; f: number; e: number },
  txLat: number,
  txLon: number,
  radiusKm: number,
  numRadials: number,
): void {
  const anglePerRadial = 360 / numRadials
  const stepKm = 0.2

  const sampleRadial = (angle: number, dist: number): number => {
    const deltas = [0, stepKm, -stepKm, 2 * stepKm, -2 * stepKm, 3 * stepKm, -3 * stepKm]
    for (const delta of deltas) {
      const d = dist + delta
      if (d < stepKm || d > radiusKm) continue
      const [slat, slon] = destinationPoint(txLat, txLon, angle, d)
      const sc = Math.round((slon - affine.c) / affine.a)
      const sr = Math.round((slat - affine.f) / affine.e)
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
      if ((rssi[idx] ?? -Infinity) > -Infinity) continue
      const lon = affine.c + col * affine.a
      const lat = affine.f + row * affine.e
      const dist = haversineDistance(txLat, txLon, lat, lon)
      if (dist > radiusKm || dist < 0.001) continue
      const bear = bearing(txLat, txLon, lat, lon)
      const radialIdx = Math.floor(bear / anglePerRadial) % numRadials
      const leftAngle = radialIdx * anglePerRadial
      const rightAngle = ((radialIdx + 1) % numRadials) * anglePerRadial
      const l = sampleRadial(leftAngle, dist)
      const r = sampleRadial(rightAngle, dist)
      if (l > -Infinity && r > -Infinity) {
        const w = (bear - leftAngle) / (rightAngle - leftAngle + 360)
        rssi[idx] = l + w * (r - l)
      } else if (l > -Infinity) rssi[idx] = l
      else if (r > -Infinity) rssi[idx] = r
    }
  }
}

/* ── Main-thread radial slice computation ── */

function computeSlice(
  demData: Float32Array,
  demWidth: number,
  demHeight: number,
  demAffine: { a: number; c: number; f: number; e: number },
  txLat: number,
  txLon: number,
  params: EngineRunParams,
  start: number,
  end: number,
  onRadial?: (done: number, total: number) => void,
): WorkerRaster {
  const pixelCount = demWidth * demHeight
  const signal = new Float32Array(pixelCount).fill(-Infinity)
  const mask = new Uint8Array(pixelCount)
  const stepKm = 0.2

  const txCol = Math.round((txLon - demAffine.c) / demAffine.a)
  const txRow = Math.round((txLat - demAffine.f) / demAffine.e)
  if (txCol >= 0 && txCol < demWidth && txRow >= 0 && txRow < demHeight) {
    const idx = txRow * demWidth + txCol
    signal[idx] = params.txPowerDbm + params.txAntennaGainDbi - params.cableLossTxDb
    mask[idx] = 248
  }

  for (let ri = start; ri < end; ri++) {
    const angle = (360 * ri) / params.numRadials
    for (let d = stepKm; d <= params.radiusKm; d += stepKm) {
      const [lat, lon] = destinationPoint(txLat, txLon, angle, d)
      const col = (lon - demAffine.c) / demAffine.a
      const row = (lat - demAffine.f) / demAffine.e
      const pc = Math.round(col)
      const pr = Math.round(row)
      if (pc < 0 || pc >= demWidth || pr < 0 || pr >= demHeight) continue
      const idx = pr * demWidth + pc
      if ((mask[idx]! & 248) !== 0) continue
      const profile = extractProfile(demData, demWidth, demHeight, demAffine, txLat, txLon, lat, lon, 100)
      const pl = computePathLoss(profile, {
        frequencyMhz: params.frequencyMhz,
        txHeightM: params.txHeightM,
        rxHeightM: params.rxHeightM,
        climate: params.climate,
        polarization: params.polarization,
        groundPermittivity: params.groundPermittivity,
        groundConductivity: params.groundConductivity,
        surfaceRefractivity: params.surfaceRefractivity,
      })
      const budget = calculateLinkBudget(
        {
          frequencyMhz: params.frequencyMhz,
          spreadingFactor: 10,
          txPowerDbm: params.txPowerDbm,
          txHeightM: params.txHeightM,
          rxHeightM: params.rxHeightM,
          txAntennaGainDbi: params.txAntennaGainDbi,
          rxAntennaGainDbi: params.rxAntennaGainDbi,
          rxSensitivityDbm: params.rxSensitivityDbm,
          bandwidthHz: params.bandwidthHz,
          requiredMarginDb: params.requiredMarginDb,
          cableLossTxDb: params.cableLossTxDb,
          cableLossRxDb: params.cableLossRxDb,
          climate: params.climate,
          polarization: params.polarization,
          groundPermittivity: params.groundPermittivity,
          groundConductivity: params.groundConductivity,
          surfaceRefractivity: params.surfaceRefractivity,
        },
        pl.pathLossDb,
      )
      signal[idx] = budget.rxPowerDbm
      mask[idx] = 248
    }
    onRadial?.(ri - start + 1, end - start)
  }

  return { signal, mask }
}

/* ── JsCoverageEngine ── */

export class JsCoverageEngine implements CoverageEngine {
  readonly kind = 'js-workers' as const

  private readonly poolSize: number
  private workers: PoolWorker[] = []
  private nextRunId = 1
  private busy = false
  private disposed = false

  constructor(opts: { poolSize?: number } = {}) {
    this.poolSize = Math.max(1, opts.poolSize ?? defaultPoolSize())
  }

  async run(params: EngineRunParams, opts: CoverageRunOptions): Promise<CoverageResult> {
    if (this.disposed) throw new Error('engine disposed')
    if (this.busy) throw new Error('a simulation is already running')
    this.busy = true
    const started = performance.now()
    try {
      opts.signal?.throwIfAborted()

      const { demData, demWidth, demHeight, demAffine } = opts
      const totalRadials = params.numRadials
      const report = (p: CoverageProgress) => opts.onProgress?.(p)

      if (typeof Worker === 'undefined' || isMobileOrLowMemory()) {
        report({ phase: 'compute', completed: 0, total: totalRadials, fraction: TERRAIN_SPAN })
        const raster = await new Promise<WorkerRaster>((resolve, reject) => {
          let cancelled = false
          const onAbort = () => { cancelled = true }
          opts.signal?.addEventListener('abort', onAbort, { once: true })
          ;(async () => {
            const result = computeSlice(
              demData, demWidth, demHeight, demAffine,
              params.lat, params.lon, params,
              0, totalRadials,
              (done, total) => {
                if (cancelled) return
                report({ phase: 'compute', completed: done, total, fraction: TERRAIN_SPAN + (done / total) * COMPUTE_SPAN })
              },
            )
            if (!cancelled) resolve(result); else reject(new DOMException('aborted', 'AbortError'))
            opts.signal?.removeEventListener('abort', onAbort)
          })()
        })

        report({ phase: 'finalize', completed: 0, total: 1, fraction: TERRAIN_SPAN + COMPUTE_SPAN })
        fillGaps(raster.signal, demWidth, demHeight, demAffine, params.lat, params.lon, params.radiusKm, totalRadials)
        const dbm = raster.signal
        report({ phase: 'finalize', completed: 1, total: 1, fraction: 1 })

        return {
          dbm, width: demWidth, height: demHeight,
          bounds: {
            north: demAffine.f,
            south: demAffine.f + demHeight * demAffine.e,
            west: demAffine.c,
            east: demAffine.c + demWidth * demAffine.a,
          },
          pixelDegrees: Math.abs(demAffine.a),
          stats: { radials: totalRadials, pages: 0, pagesWithData: 0, itmWarnings: [0, 0, 0, 0, 0, 0], elapsedMs: performance.now() - started, workers: 1 },
        }
      }

      /* ── Worker pool ── */
      const poolCap = this.poolSize
      const slices = sliceRadials(totalRadials, poolCap)
      const runId = this.nextRunId++
      const pool = this.ensureWorkers(slices.length)

      const radialsDone = new Array<number>(slices.length).fill(0)
      const reportCompute = () => {
        const done = radialsDone.reduce((a, b) => a + b, 0)
        report({ phase: 'compute', completed: done, total: totalRadials, fraction: TERRAIN_SPAN + (done / totalRadials) * COMPUTE_SPAN })
      }

      const cancelAll = () => {
        for (const pw of pool) pw.worker.postMessage({ type: 'cancel', runId } satisfies ToWorker)
      }

      const results = await new Promise<DoneMessage[]>((resolve, reject) => {
        const done: (DoneMessage | undefined)[] = new Array(slices.length)
        let remaining = slices.length
        let settled = false

        const fail = (err: Error) => {
          if (settled) return
          settled = true
          cancelAll()
          cleanup()
          reject(err)
        }

        const onAbort = () => fail(new DOMException('aborted', 'AbortError'))
        opts.signal?.addEventListener('abort', onAbort, { once: true })

        const cleanup = () => {
          opts.signal?.removeEventListener('abort', onAbort)
          for (const pw of pool) pw.handler = null
        }

        slices.forEach((slice, i) => {
          const pw = pool[i]!
          pw.handler = (msg: FromWorker) => {
            if (msg.type === 'ready') return
            if (msg.runId !== runId) return
            if (msg.type === 'progress') {
              radialsDone[i] = msg.radialsDone
              reportCompute()
            } else if (msg.type === 'done') {
              done[i] = msg
              radialsDone[i] = slice.end - slice.start
              reportCompute()
              if (--remaining === 0 && !settled) {
                settled = true
                cleanup()
                resolve(done as DoneMessage[])
              }
            } else if (msg.type === 'error') {
              const err = msg.code === 'aborted'
                ? new DOMException('aborted', 'AbortError')
                : new Error(`worker failed (${msg.code}): ${msg.message}`)
              fail(err)
            }
          }

          const demCopy = new Float32Array(demData)
          pw.worker.postMessage({
            type: 'run',
            runId,
            params,
            demData: demCopy,
            demWidth, demHeight, demAffine,
            start: slice.start,
            end: slice.end,
            chunk: RADIAL_CHUNK,
          } satisfies ToWorker, [demCopy.buffer])
        })
      })

      /* ── Finalize: merge + convert to dBm ── */
      report({ phase: 'finalize', completed: 0, total: 1, fraction: TERRAIN_SPAN + COMPUTE_SPAN })
      const cells = demWidth * demHeight
      const merged = mergeFirstTouch(
        results.map((r): WorkerRaster => ({ signal: r.signal, mask: r.mask })),
        cells,
      )

      const dbm = new Float32Array(cells)
      for (let i = 0; i < cells; i++) {
        dbm[i] = (merged.mask[i]! & 248) !== 0 ? merged.signal[i]! : -Infinity
      }

      fillGaps(dbm, demWidth, demHeight, demAffine, params.lat, params.lon, params.radiusKm, totalRadials)

      const itmWarnings = [0, 0, 0, 0, 0, 0]
      for (const r of results) r.itmWarnings.forEach((v, i) => { itmWarnings[i] = (itmWarnings[i] ?? 0) + v })

      report({ phase: 'finalize', completed: 1, total: 1, fraction: 1 })

      return {
        dbm, width: demWidth, height: demHeight,
        bounds: {
          north: demAffine.f,
          south: demAffine.f + demHeight * demAffine.e,
          west: demAffine.c,
          east: demAffine.c + demWidth * demAffine.a,
        },
        pixelDegrees: Math.abs(demAffine.a),
        stats: { radials: totalRadials, pages: 0, pagesWithData: 0, itmWarnings, elapsedMs: performance.now() - started, workers: slices.length },
      }
    } finally {
      this.busy = false
    }
  }

  dispose(): void {
    this.disposed = true
    for (const pw of this.workers) pw.worker.terminate()
    this.workers = []
  }

  private ensureWorkers(count: number): PoolWorker[] {
    while (this.workers.length < count) {
      const worker = new Worker(new URL('../workers/coverage.worker.ts', import.meta.url), {
        type: 'module',
        name: `coverage-${this.workers.length}`,
      })
      const pw: PoolWorker = { worker, handler: null }
      worker.onmessage = (ev: MessageEvent<FromWorker>) => pw.handler?.(ev.data)
      worker.onerror = () =>
        pw.handler?.({
          type: 'error',
          runId: -1,
          code: 'worker',
          message: 'worker crashed',
        })
      this.workers.push(pw)
    }
    return this.workers.slice(0, count)
  }
}
