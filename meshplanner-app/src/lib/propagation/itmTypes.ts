/**
 * Shared types for ITM propagation results.
 *
 * Both the simplified JS model (itm.ts), the Pyodide WASM model
 * (itmPyodide.ts), and any future native WASM port should produce
 * results conforming to this interface.
 */

export interface WasmPathLossInput {
  /** Evenly-spaced terrain elevation values (metres) along the great-circle path. */
  elevations: number[]
  /** Total path length in kilometres. */
  totalDistanceKm: number
  /** Centre frequency (MHz). Default 915.0. */
  frequencyMhz?: number
  /** Transmitter antenna height above ground (m). Default 10.0. */
  txHeightM?: number
  /** Receiver antenna height above ground (m). Default 1.5. */
  rxHeightM?: number
  /** Polarization: 0 = horizontal, 1 = vertical. Default 1. */
  polarization?: number
  /** ITM climate code (1-7). Default 5 (continental temperate). */
  climate?: number
  /** Ground relative permittivity. Default 15.0. */
  groundPermittivity?: number
  /** Ground conductivity (S/m). Default 0.005. */
  groundConductivity?: number
  /** Surface refractivity (N-units). Default 314.0. */
  surfaceRefractivity?: number
  /** Time availability quantile (0-1). Default 0.5 (median). */
  timeAvailability?: number
  /** Location availability quantile (0-1). Default 0.5 (median). */
  locationAvailability?: number
  /** Confidence quantile (0-1). Default 0.5 (median). */
  confidence?: number
}

export interface WasmPathLossResult {
  /** Total median path loss (dB). */
  pathLossDb: number
  /** Free-space path loss (dB). */
  freeSpaceLossDb: number
  /** ITM excess loss above free space (dB). */
  excessLossDb: number
  /** Frequency (MHz). */
  frequencyMhz: number
  /** Path distance (km). */
  distanceKm: number
  /** Transmitter height (m). */
  txHeightM: number
  /** Receiver height (m). */
  rxHeightM: number
  /** ITM climate code. */
  climate: number
  /** Polarization code. */
  polarization: number
}

/**
 * Status of the WASM runtime.
 */
export type WasmRuntimeStatus = "uninitialized" | "loading" | "ready" | "error" | "unsupported"

/**
 * Information about the WASM runtime state.
 */
export interface WasmRuntimeInfo {
  status: WasmRuntimeStatus
  error?: string
  loadTimeMs?: number
  pyodideVersion?: string
}
