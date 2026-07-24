/* SPLAT! WASM worker — runs a radial slice in its own WASM context.
 * Each worker loads the splat_driver WASM module independently.
 * Message protocol matches meshtastic-site-planner's coverage.worker.ts. */

import createSplatModule from '../engine/generated/splat_driver.mjs'
import type { EngineRunParams } from '../engine/core'

/* ── Types matching engine/protocol.ts ── */

interface RunRequest {
  type: 'run'
  runId: number
  params: EngineRunParams
  pages: (Int16Array | null)[]
  start: number
  end: number
  chunk: number
}

interface CancelRequest {
  type: 'cancel'
  runId: number
}

type ToWorker = RunRequest | CancelRequest

interface ProgressMessage {
  type: 'progress'
  runId: number
  radialsDone: number
}

interface DoneMessage {
  type: 'done'
  runId: number
  signal: Uint8Array
  mask: Uint8Array
  region: { width: number; height: number; north: number; south: number; east: number; west: number; radials: number }
  itmWarnings: number[]
}

interface ErrorMessage {
  type: 'error'
  runId: number
  code: string
  message: string
}

type FromWorker = ProgressMessage | DoneMessage | ErrorMessage

/* ── Helpers ── */

function check(rc: number, what: string): number {
  if (rc < 0) {
    const msgs: Record<number, string> = {
      [-1]: 'out of memory', [-2]: 'bad handle', [-3]: 'bad page',
      [-4]: 'coverage region too large', [-5]: 'invalid parameters',
    }
    throw new Error(`${what}: ${msgs[rc] ?? `engine error ${rc}`}`)
  }
  return rc
}

/* ── Cancellation tracking ── */

const cancelled = new Set<number>()

/* ── Worker entry point ── */

let modulePromise: Promise<any> | null = null

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data

  if (msg.type === 'cancel') {
    cancelled.add(msg.runId)
    return
  }
  if (msg.type !== 'run') return

  const { runId, params, pages, start, end, chunk } = msg

  try {
    // Load WASM module (shared across runs in this worker)
    if (!modulePromise) {
      modulePromise = createSplatModule({
        locateFile: (path: string) => {
          // Workers need absolute URL; derive from worker script location
          try { return new URL(`../engine/generated/${path}`, import.meta.url).href }
          catch { return path }
        },
      })
    }
    const m = await modulePromise

    // Convert params to SPLAT! units
    const txAltFeet = params.txHeightM * 3.28084
    const rxAltFeet = params.rxHeightM * 3.28084
    const erpWatts = Math.pow(10, (params.txPowerDbm + params.txAntennaGainDbi - params.cableLossTxDb - 30) / 10)

    // Create SPLAT! context
    const handle = check(m._splat_create(
      params.lat, params.lon,
      txAltFeet, rxAltFeet,
      params.frequencyMhz, erpWatts,
      params.groundPermittivity, params.groundConductivity,
      params.surfaceRefractivity,
      params.climate, params.polarization,
      params.conf ?? 0.95, params.rel ?? 0.95, params.clutterHeightM ?? 1.0,
      params.radiusKm,
      params.resolutionIppd ?? 1200,
    ), 'splat_create')

    try {
      const ippd = params.resolutionIppd ?? 1200
      // Load terrain pages
      for (let i = 0; i < pages.length; i++) {
        const data = pages[i]
        if (!data) continue
        const cells = ippd * ippd
        if (data.length !== cells) continue
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        const ptr = m._splat_malloc(bytes.length)
        if (!ptr) throw new Error('splat_malloc failed')
        m.HEAPU8.set(bytes, ptr)
        check(m._splat_load_page(handle, i, ptr), 'splat_load_page')
        m._splat_free(ptr)
      }

      // Run radials in chunks
      const totalRadials = end - start
      const radialCount = check(m._splat_radial_count(handle), 'splat_radial_count')

      for (let at = start; at < end; ) {
        if (cancelled.has(runId)) {
          throw new DOMException('aborted', 'AbortError')
        }
        const ran = check(m._splat_run_radials(handle, at, Math.min(chunk, end - at)), 'splat_run_radials')
        at += ran
        // Report progress
        const progressMsg: ProgressMessage = { type: 'progress', runId, radialsDone: at - start }
        self.postMessage(progressMsg)
        // Yield to event loop so cancel messages can be processed
        if (at < end) await new Promise((r) => setTimeout(r, 0))
      }

      // Rasterize
      check(m._splat_rasterize(handle), 'splat_rasterize')

      // Get region info
      const out = m._splat_malloc(8 * 8)
      let region: { width: number; height: number; north: number; south: number; east: number; west: number; radials: number }
      try {
        check(m._splat_region_info(handle, out), 'splat_region_info')
        const base = out >> 3
        const v = m.HEAPF64
        region = {
          width: v[base], height: v[base + 1],
          north: v[base + 2], south: v[base + 3],
          east: v[base + 4], west: v[base + 5],
          radials: v[base + 6],
        }
      } finally {
        m._splat_free(out)
      }

      // Copy signal and mask out of WASM heap
      const signalPtr = m._splat_signal_ptr(handle)
      const maskPtr = m._splat_mask_ptr(handle)
      const cells = region.width * region.height
      const signal = new Uint8Array(m.HEAPU8.slice(signalPtr, signalPtr + cells))
      const mask = new Uint8Array(m.HEAPU8.slice(maskPtr, maskPtr + cells))

      // ITM warnings
      const warnOut = m._splat_malloc(6 * 4)
      let itmWarnings: number[]
      try {
        check(m._splat_errnum_counts(handle, warnOut), 'splat_errnum_counts')
        const base = warnOut >> 2
        itmWarnings = Array.from(m.HEAP32.subarray(base, base + 6))
      } finally {
        m._splat_free(warnOut)
      }

      // Send result
      const doneMsg: DoneMessage = { type: 'done', runId, signal, mask, region, itmWarnings }
      self.postMessage(doneMsg, { transfer: [signal.buffer, mask.buffer] })
    } finally {
      m._splat_destroy(handle)
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      self.postMessage({ type: 'error', runId, code: 'aborted', message: 'cancelled' } as ErrorMessage)
    } else {
      self.postMessage({ type: 'error', runId, code: 'internal', message: err instanceof Error ? err.message : String(err) } as ErrorMessage)
    }
  }
}

// Signal ready
self.postMessage({ type: 'ready' } as any)
