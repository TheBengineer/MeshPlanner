/**
 * Pyodide WASM ITM propagation module.
 *
 * Lazy-loads Pyodide (Python compiled to WASM ~12 MB) on first use,
 * installs ``itmlogic`` via micropip, and provides
 * ``computePathLossWasm()`` — a drop-in replacement for the simplified
 * ``computePathLoss()`` that produces bit-exact results matching the
 * Python reference (src/meshplanner/propagation/itm.py).
 *
 * Usage
 * -----
 * ```typescript
 * import { computePathLossWasm, getWasmRuntimeInfo } from './itmPyodide'
 *
 * // Check / preload the runtime
 * const info = getWasmRuntimeInfo()  // { status: 'uninitialized' }
 * await initWasmRuntime()            // explicit preload (optional)
 *
 * // Compute (auto-initialises on first call)
 * const result = await computePathLossWasm({
 *   elevations: [0, 0, 0, ...],
 *   totalDistanceKm: 10,
 *   frequencyMhz: 915,
 * })
 * console.log(result.pathLossDb)  // 138.2
 * ```
 *
 * Architecture
 * ------------
 * - Singleton Pyodide instance cached after first load.
 * - ``runner.py`` (fetched from ``/itmlogic/runner.py``) defines the Python
 *   ``compute_path_loss_py()`` function that mirrors the reference.
 * - All Python ↔ JS conversion is handled automatically by the Pyodide bridge.
 * - Falls back to a stub error if the browser does not support WASM.
 *
 * @module
 */

import type {
  WasmPathLossInput,
  WasmPathLossResult,
  WasmRuntimeInfo,
  WasmRuntimeStatus,
} from "./itmTypes"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pyodide CDN URL — pinned to a stable release. */
const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs"

/** Path to the Python runner script (served from the app's public dir). */
const RUNNER_SCRIPT = "/itmlogic/runner.py"

/** itmlogic package on PyPI (pure Python, no binary deps beyond numpy). */
const ITMLOGIC_PACKAGE = "itmlogic"

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

type PyodideRuntime = {
  // biome-ignore lint/suspicious/noExplicitAny: Pyodide has no published TS types
  pyodide: any
  loadTimeMs: number
  pyodideVersion: string
}

let _runtime: PyodideRuntime | null = null
let _status: WasmRuntimeStatus = "uninitialized"
let _error: string | undefined
let _initPromise: Promise<PyodideRuntime> | null = null

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.document !== "undefined"
}

function _supportsWasm(): boolean {
  return typeof WebAssembly !== "undefined" && typeof WebAssembly.compile === "function"
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Initialise the Pyodide WASM runtime.
 *
 * Safe to call multiple times — returns the cached instance after the
 * first successful init. Call explicitly to preload before the first
 * ``computePathLossWasm()`` call (e.g. during app bootstrap).
 *
 * @returns A promise that resolves when Pyodide is ready.
 * @throws If WASM is not supported or Pyodide fails to load.
 */
export async function initWasmRuntime(): Promise<void> {
  if (_runtime) return

  if (!_isBrowser()) {
    _status = "unsupported"
    _error = "Pyodide requires a browser environment (not Node.js)"
    throw new Error(_error)
  }

  if (!_supportsWasm()) {
    _status = "unsupported"
    _error = "This browser does not support WebAssembly"
    throw new Error(_error)
  }

  if (_initPromise) {
    // Already initialising — wait for it
    await _initPromise
    return
  }

  _status = "loading"
  _error = undefined

  _initPromise = _doInit()

  try {
    await _initPromise
  } catch (e) {
    _status = "error"
    _error = e instanceof Error ? e.message : String(e)
    _initPromise = null
    throw e
  }
}

async function _doInit(): Promise<PyodideRuntime> {
  const t0 = performance.now()

  // 1. Dynamically import Pyodide from CDN
  const pyodideModule = await import(/* @vite-ignore */ PYODIDE_CDN)

  const indexURL = new URL(".", PYODIDE_CDN).href

  const pyodide = await pyodideModule.loadPyodide({
    indexURL,
  })

  // 2. Install itmlogic via micropip (pure Python, installs quickly)
  await pyodide.loadPackage("micropip")
  const micropip = pyodide.pyimport("micropip")
  await micropip.install(ITMLOGIC_PACKAGE)

  // 3. Load and execute the runner script
  const runnerResponse = await fetch(RUNNER_SCRIPT)
  if (!runnerResponse.ok) {
    throw new Error(`Failed to fetch ${RUNNER_SCRIPT}: ${runnerResponse.status}`)
  }
  const runnerCode = await runnerResponse.text()
  await pyodide.runPythonAsync(runnerCode)

  const t1 = performance.now()

  _runtime = {
    pyodide,
    loadTimeMs: Math.round(t1 - t0),
    pyodideVersion: pyodide.version ?? "unknown",
  }
  _status = "ready"

  return _runtime
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get information about the WASM runtime status.
 *
 * Use this to check whether the runtime is ready, still loading, or
 * encountered an error.
 */
export function getWasmRuntimeInfo(): WasmRuntimeInfo {
  const info: WasmRuntimeInfo = {
    status: _status,
    error: _error,
  }
  if (_runtime) {
    info.loadTimeMs = _runtime.loadTimeMs
    info.pyodideVersion = _runtime.pyodideVersion
  }
  return info
}

/**
 * Compute ITM path loss using the full Longley-Rice model running via
 * Pyodide WASM.
 *
 * On the first call (if ``initWasmRuntime()`` has not been called
 * explicitly), this lazily loads Pyodide (~12 MB from CDN), installs
 * itmlogic, and caches the environment for subsequent calls.
 *
 * @param input - Propagation parameters (see ``WasmPathLossInput``).
 * @returns The path loss result matching the Python reference.
 *
 * @example
 * ```typescript
 * const result = await computePathLossWasm({
 *   elevations: [0, 0, 0, 0],
 *   totalDistanceKm: 10,
 * })
 * ```
 */
export async function computePathLossWasm(input: WasmPathLossInput): Promise<WasmPathLossResult> {
  // Ensure runtime is initialised
  if (!_runtime) {
    if (_status === "error") {
      throw new Error(`Pyodide WASM runtime is in error state: ${_error}`)
    }
    if (_status === "unsupported") {
      throw new Error("Pyodide WASM runtime is not available in this environment")
    }
    await initWasmRuntime()
  }

  // Runtime should now be available
  if (!_runtime) {
    throw new Error("Pyodide WASM runtime failed to initialise (unknown error)")
  }

  // Build the params dict matching compute_path_loss_py() signature
  const params: Record<string, unknown> = {
    elevations: input.elevations,
    total_distance_km: input.totalDistanceKm,
    frequency_mhz: input.frequencyMhz ?? 915.0,
    tx_height_m: input.txHeightM ?? 10.0,
    rx_height_m: input.rxHeightM ?? 1.5,
    polarization: input.polarization ?? 1,
    climate: input.climate ?? 5,
    ground_permittivity: input.groundPermittivity ?? 15.0,
    ground_conductivity: input.groundConductivity ?? 0.005,
    surface_refractivity: input.surfaceRefractivity ?? 314.0,
    time_availability: input.timeAvailability ?? 0.5,
    location_availability: input.locationAvailability ?? 0.5,
    confidence: input.confidence ?? 0.5,
  }

  // Call the Python function via the Pyodide bridge.
  // Pyodide auto-converts JS objects ↔ Python dicts,
  // and Python dicts ↔ JS objects.
  const result: Record<string, number> =
    _runtime.pyodide.globals.get("compute_path_loss_py")(params)

  return {
    pathLossDb: Number(result.path_loss_db),
    freeSpaceLossDb: Number(result.free_space_loss_db),
    excessLossDb: Number(result.excess_loss_db),
    frequencyMhz: Number(result.frequency_mhz),
    distanceKm: Number(result.distance_km),
    txHeightM: Number(result.tx_height_m),
    rxHeightM: Number(result.rx_height_m),
    climate: Number(result.climate),
    polarization: Number(result.polarization),
  }
}

/**
 * Reset the WASM runtime singleton (for testing).
 *
 * Destroys the cached Pyodide instance so the next call to
 * ``computePathLossWasm()`` or ``initWasmRuntime()`` will re-load
 * everything from scratch.
 */
export function resetWasmRuntime(): void {
  _runtime = null
  _status = "uninitialized"
  _error = undefined
  _initPromise = null
}
