/* Ported from meshtastic-site-planner's WasmCoverageEngine.ts + core.ts.
 *
 * Uses the SPLAT! WASM module for ITM propagation:
 *   Scout (enumerate pages) → Terrain (load pages) → Compute (workers)
 *   → Merge first-touch → Finalize (convert to dBm)
 */

import createSplatModule from './generated/splat_driver.mjs'
import type { SplatModule } from './generated/splat_driver.d'
import type { CoverageEngine, CoverageProgress, CoverageResult, CoverageRunOptions } from './CoverageEngine'
import type { EngineRunParams } from './core'
import { mergeFirstTouch, sliceRadials, type WorkerRaster } from './merge'
import type { DoneMessage, FromWorker, ToWorker } from './protocol'

const RADIAL_CHUNK = 32
const TERRAIN_SPAN = 0.15
const COMPUTE_SPAN = 0.83
const HD_HEAP_BUDGET_MB = 800
const PAGE_MEMORY_BUDGET_MB = 768

/* ── PageRef: a 1°×1° elevation tile in SPLAT!'s convention ── */

interface PageRef {
  minNorth: number
  /** West-positive floor longitude (0-359). */
  minWest: number
}

/* ── Region info from SPLAT! ── */

interface RegionInfo {
  width: number; height: number
  north: number; south: number; east: number; west: number
  radials: number; pages: number
}

/* ── EngineContext: wraps splat_* C functions ── */

class EngineError extends Error {
  constructor(code: number, what: string) {
    const msgs: Record<number, string> = {
      [-1]: 'out of memory', [-2]: 'bad handle', [-3]: 'bad page',
      [-4]: 'coverage region too large', [-5]: 'invalid parameters',
    }
    super(`${what}: ${msgs[code] ?? `engine error ${code}`}`)
    this.name = 'EngineError'
  }
}

function check(rc: number, what: string): number {
  if (rc < 0) throw new EngineError(rc, what)
  return rc
}

class EngineContext {
  private constructor(
    private readonly m: SplatModule,
    private handle: number,
    readonly ippd: number,
  ) {}

  static create(m: SplatModule, p: EngineRunParams): EngineContext {
    const ippd = p.resolutionIppd ?? 1200
    const txAltFeet = p.txHeightM * 3.28084
    const rxAltFeet = p.rxHeightM * 3.28084
    const erpWatts = Math.pow(10, (p.txPowerDbm + p.txAntennaGainDbi - p.cableLossTxDb - 30) / 10)

    const h = m._splat_create(
      p.lat, p.lon,
      txAltFeet, rxAltFeet,
      p.frequencyMhz, erpWatts,
      p.groundPermittivity, p.groundConductivity,
      p.surfaceRefractivity,
      p.climate, p.polarization,
      p.conf ?? 0.5, p.rel ?? 0.5, p.clutterHeightM ?? 1.0,
      p.radiusKm,
      ippd,
    )
    check(h, 'splat_create')
    return new EngineContext(m, h, ippd)
  }

  pages(): PageRef[] {
    const count = check(this.m._splat_page_count(this.handle), 'splat_page_count')
    const out = this.m._splat_malloc(8)
    try {
      const refs: PageRef[] = []
      for (let i = 0; i < count; i++) {
        check(this.m._splat_page_info(this.handle, i, out), 'splat_page_info')
        const base = out >> 2
        refs.push({
          minNorth: this.m.HEAP32[base]!,
          minWest: this.m.HEAP32[base + 1]!,
        })
      }
      return refs
    } finally {
      this.m._splat_free(out)
    }
  }

  loadPage(index: number, data: Int16Array): void {
    const cells = this.ippd * this.ippd
    if (data.length !== cells)
      throw new Error(`page ${index}: expected ${cells} cells, got ${data.length}`)
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    const ptr = this.m._splat_malloc(bytes.length)
    if (!ptr) throw new Error('splat_malloc failed')
    try {
      this.m.HEAPU8.set(bytes, ptr)
      check(this.m._splat_load_page(this.handle, index, ptr), 'splat_load_page')
    } finally {
      this.m._splat_free(ptr)
    }
  }

  radialCount(): number {
    return check(this.m._splat_radial_count(this.handle), 'splat_radial_count')
  }

  runRadials(start: number, count: number): number {
    return check(this.m._splat_run_radials(this.handle, start, count), 'splat_run_radials')
  }

  rasterize(): void {
    check(this.m._splat_rasterize(this.handle), 'splat_rasterize')
  }

  region(): RegionInfo {
    const out = this.m._splat_malloc(8 * 8)
    try {
      check(this.m._splat_region_info(this.handle, out), 'splat_region_info')
      const base = out >> 3
      const v = this.m.HEAPF64
      return {
        width: v[base]!, height: v[base + 1]!,
        north: v[base + 2]!, south: v[base + 3]!,
        east: v[base + 4]!, west: v[base + 5]!,
        radials: v[base + 6]!, pages: v[base + 7]!,
      }
    } finally {
      this.m._splat_free(out)
    }
  }

  signal(width: number, height: number): Uint8Array {
    const ptr = this.m._splat_signal_ptr(this.handle)
    if (!ptr) throw new Error('signal ptr not available')
    return this.m.HEAPU8.slice(ptr, ptr + width * height)
  }

  mask(width: number, height: number): Uint8Array {
    const ptr = this.m._splat_mask_ptr(this.handle)
    if (!ptr) throw new Error('mask ptr not available')
    return this.m.HEAPU8.slice(ptr, ptr + width * height)
  }

  errnumCounts(): number[] {
    const out = this.m._splat_malloc(6 * 4)
    try {
      check(this.m._splat_errnum_counts(this.handle, out), 'splat_errnum_counts')
      const base = out >> 2
      return Array.from(this.m.HEAP32.subarray(base, base + 6))
    } finally {
      this.m._splat_free(out)
    }
  }

  destroy(): void {
    if (this.handle > 0) {
      this.m._splat_destroy(this.handle)
      this.handle = 0
    }
  }
}

/* ── Progress helper ── */

function projectedHeapMB(pageCount: number, regionCells: number, ippd: number): number {
  return (pageCount * ippd * ippd * 4 + regionCells * 2) / (1024 * 1024)
}

/* ── Terrain page provider: converts our DEM to SPLAT!'s Int16Array pages ── */

function buildPages(
  refs: PageRef[],
  demData: Float32Array,
  demWidth: number,
  demHeight: number,
  demAffine: { a: number; c: number; f: number; e: number },
  ippd: number,
): (Int16Array | null)[] {
  return refs.map((ref) => {
    const page = new Int16Array(ippd * ippd)
    const pageNorth = ref.minNorth + 1
    // SPLAT! uses west-positive longitude 0-359; convert to signed by negating
    // (all our pages are in the western hemisphere so west-positive <= 180).
    const pageWest = -(ref.minWest + 1) // west edge in signed degrees
    const pageEast = -ref.minWest       // east edge in signed degrees
    const latStep = 1 / ippd
    const lonStep = 1 / ippd

    for (let r = 0; r < ippd; r++) {
      for (let c = 0; c < ippd; c++) {
        const lat = pageNorth - (r + 0.5) * latStep
        const lon = pageWest + (c + 0.5) * lonStep
        let col = (lon - demAffine.c) / demAffine.a
        let row = (lat - demAffine.f) / demAffine.e
        // Clamp to DEM edges so we never sample outside (avoids 0-elevation
        // artifacts at page boundaries that would create artificial flat terrain).
        col = Math.max(0, Math.min(col, demWidth - 1))
        row = Math.max(0, Math.min(row, demHeight - 1))
        // Bilinear interpolation
        const col0 = Math.floor(col); const row0 = Math.floor(row)
        const col1 = Math.min(col0 + 1, demWidth - 1)
        const row1 = Math.min(row0 + 1, demHeight - 1)
        const fx = col - col0; const fy = row - row0
        const v00 = demData[row0 * demWidth + col0]
        const v10 = demData[row0 * demWidth + col1]
        const v01 = demData[row1 * demWidth + col0]
        const v11 = demData[row1 * demWidth + col1]
        // Guard against no-data values (SRTM uses -32768 for voids)
        const safe = (v: number | undefined) => (v !== undefined && Number.isFinite(v) && v > -10000) ? v : 0
        const a = safe(v00), b = safe(v10), c2 = safe(v01), d = safe(v11)
        const elev = a + (b - a) * fx + (c2 - a) * fy + (d - b - c2 + a) * fx * fy
        page[r * ippd + c] = Math.round(Number.isFinite(elev) ? Math.max(-500, Math.min(9000, elev)) : 0)
      }
    }
    return page
  })
}

/* ── West-positive floor longitude conversion ── */

function westPositiveFloor(lonSigned: number): number {
  let wp = lonSigned < 0 ? -lonSigned : 360 - lonSigned
  if (wp < 0) wp += 360
  return Math.floor(wp)
}

/* ── WasmCoverageEngine ── */

interface PoolWorker {
  worker: Worker
  handler: ((msg: FromWorker) => void) | null
}

function defaultPoolSize(): number {
  if (typeof navigator === 'undefined') return 2
  let n = Math.min(navigator.hardwareConcurrency || 4, 8)
  const mem = (navigator as { deviceMemory?: number }).deviceMemory
  if (mem !== undefined && mem <= 4) n = Math.min(n, 2)
  return Math.max(1, Math.min(n, 4))
}

export class WasmCoverageEngine implements CoverageEngine {
  readonly kind = 'wasm-workers' as const

  private modulePromise: Promise<SplatModule> | null = null
  private workers: PoolWorker[] = []
  private nextRunId = 1
  private busy = false
  private disposed = false
  private readonly poolSize: number

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
      const report = (p: CoverageProgress) => opts.onProgress?.(p)

      /* ── Scout: enumerate pages via SPLAT! (main thread, cheap) ── */
      const m = await this.getModule()
      const scout = EngineContext.create(m, params)
      let refs: PageRef[]
      let region: RegionInfo
      try {
        refs = scout.pages()
        region = scout.region()
      } finally {
        scout.destroy()
      }

      const ippd = params.resolutionIppd ?? 1200

      if (projectedHeapMB(refs.length, region.width * region.height, ippd) > HD_HEAP_BUDGET_MB) {
        throw new Error('Area too large for SPLAT! — reduce max range')
      }

      /* ── Terrain: build Int16Array pages from DEM ── */
      const pages = buildPages(refs, demData, demWidth, demHeight, demAffine, ippd)
      report({ phase: 'terrain', completed: refs.length, total: refs.length, fraction: TERRAIN_SPAN })

      // Debug: check ground elevation at transmitter from the built pages
      console.log(`[SPLAT] Pages: ${pages.length}, refs: ${refs.length}, TX: ${params.lat.toFixed(4)},${params.lon.toFixed(4)}`)
      for (let i = 0; i < refs.length; i++) {
        const ref = refs[i]!
        const pgWest = -(ref.minWest + 1)  // west edge in signed degrees
        const pgEast = -ref.minWest         // east edge
        console.log(`[SPLAT] Page ${i}: N=${ref.minNorth} W=${ref.minWest}, lon range: ${pgWest} to ${pgEast}`)
        if (params.lat >= ref.minNorth && params.lat < ref.minNorth + 1 && params.lon >= pgWest && params.lon < pgEast) {
          const pg = pages[i]
          console.log(`[SPLAT] Found matching page ${i}, has data: ${!!pg}`)
          if (pg) {
            const pc = Math.round((params.lon - pgWest) * ippd)
            const pr = Math.round((ref.minNorth + 1 - params.lat) * ippd)
            console.log(`[SPLAT] Page pixel: ${pc},${pr} (ippd=${ippd})`)
            if (pc >= 0 && pc < ippd && pr >= 0 && pr < ippd) {
              const groundM = pg[pr * ippd + pc]
              console.log(`[SPLAT] Raw page value: ${groundM}`)
              if (groundM !== undefined && groundM > -500) {
                const aglM = params.txHeightM
                console.log(`[SPLAT] TX ground: ${groundM}m, AGL: ${aglM}m, Total ASL: ${groundM + aglM}m`)
              }
            }
          }
          break
        }
      }
      opts.signal?.throwIfAborted()

      /* ── Compute: main-thread SPLAT! using EngineContext (no workers) ── */
      const ctx = EngineContext.create(m, params)
      try {
        for (let i = 0; i < refs.length; i++) {
          const data = pages[i]
          if (data) ctx.loadPage(i, data)
        }

        const totalRadials = ctx.radialCount()
        const chunk = 32

        for (let at = 0; at < totalRadials; ) {
          opts.signal?.throwIfAborted()
          const ran = ctx.runRadials(at, Math.min(chunk, totalRadials - at))
          at += ran
          report({ phase: 'compute', completed: at, total: totalRadials, fraction: TERRAIN_SPAN + (at / totalRadials) * COMPUTE_SPAN })
        }

        ctx.rasterize()
        const reg = ctx.region()
        const signal = ctx.signal(reg.width, reg.height)
        const mask = ctx.mask(reg.width, reg.height)

        report({ phase: 'finalize', completed: 0, total: 1, fraction: TERRAIN_SPAN + COMPUTE_SPAN })
        const cells = reg.width * reg.height
        const dbm = new Float32Array(cells)
        for (let i = 0; i < cells; i++) {
          dbm[i] = (mask[i]! & 248) !== 0 ? signal[i]! - 200 : NaN
        }

        // Log signal range for debugging
        let minDbm = Infinity, maxDbm = -Infinity, sumDbm = 0, countDbm = 0
        for (let i = 0; i < cells; i++) {
          const v = dbm[i]!
          if (Number.isFinite(v)) {
            if (v < minDbm) minDbm = v
            if (v > maxDbm) maxDbm = v
            sumDbm += v; countDbm++
          }
        }
        console.log(`[SPLAT-MT] Signal: ${minDbm.toFixed(1)} to ${maxDbm.toFixed(1)} dBm, avg: ${countDbm > 0 ? (sumDbm / countDbm).toFixed(1) : 'N/A'}, cells: ${countDbm}`)

        const itmWarnings = ctx.errnumCounts()
        report({ phase: 'finalize', completed: 1, total: 1, fraction: 1 })

        return {
          dbm, width: reg.width, height: reg.height,
          bounds: { north: reg.north, south: reg.south, east: reg.east, west: reg.west },
          pixelDegrees: 1 / ippd,
          stats: {
            radials: totalRadials,
            pages: refs.length,
            pagesWithData: pages.filter((p) => p !== null).length,
            itmWarnings,
            elapsedMs: performance.now() - started,
            workers: 1,
          },
        }
      } finally {
        ctx.destroy()
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

  private getModule(): Promise<SplatModule> {
    if (!this.modulePromise) {
      this.modulePromise = createSplatModule({
        locateFile: (path: string) => new URL(`./generated/${path}`, import.meta.url).href,
      }) as Promise<SplatModule>
    }
    return this.modulePromise
  }

  private ensureWorkers(count: number): PoolWorker[] {
    while (this.workers.length < count) {
      const worker = new Worker(new URL('../workers/splat.worker.ts', import.meta.url), {
        type: 'module',
        name: `splat-${this.workers.length}`,
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
