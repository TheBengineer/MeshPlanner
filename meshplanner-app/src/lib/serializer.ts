/**
 * Serialize/deserialize app configuration state to/from a base64 URL parameter.
 *
 * The user's full configuration (sites, params, bbox, viewport, mode, colormap)
 * is encoded into a compressed base64 string that can be stored as a URL hash
 * or query parameter. Everything but computation results is preserved.
 */

import type { AppStore, AppMode } from '../store'
import type { LoraParams, Bbox, CandidateSite } from './types'

/* ── Serializable state shape (excludes computation results) ── */

export interface PersistedState {
  v: 1  // schema version for forward compat
  s: CandidateSite[]          // sites
  sn: string[]                // selected site names
  m: AppMode                  // app mode
  b: Bbox | null              // bounding box
  p: Partial<LoraParams>      // transmitter/receiver/environment params
  cp: {                       // coverage params
    maxRangeKm: number
    numRadials: number
    threshold: number
    targetCoverage: number
    highRes?: boolean
    clutterHeightM?: number
    situationFraction?: number
    timeFraction?: number
  } | null
  c: string                   // colormap name
  vp: { lat: number; lon: number; zoom: number } | null  // map viewport
}

/* ── Encode state to a URL-safe base64 string ── */

export function encodeState(state: PersistedState): string {
  const json = JSON.stringify(state)
  // Compress via UTF-16 → base64 (URL-safe)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/* ── Decode a base64 string back to state ── */

export function decodeState(encoded: string): PersistedState | null {
  try {
    // Restore base64 chars
    let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    while (base64.length % 4) base64 += '='
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const json = new TextDecoder().decode(bytes)
    const state = JSON.parse(json) as PersistedState
    return state
  } catch {
    return null
  }
}

/* ── Extract persistable state from the store ── */

export function extractState(store: {
  sites: CandidateSite[]
  selectedSiteNames: string[]
  mode: AppMode
  bbox: Bbox | null
  params: LoraParams
  coverageParams: {
    maxRangeKm: number
    numRadials: number
    threshold: number
    targetCoverage: number
    highRes?: boolean
    clutterHeightM?: number
    situationFraction?: number
    timeFraction?: number
  }
  colormap: string
}): PersistedState {
  return {
    v: 1,
    s: store.sites,
    sn: store.selectedSiteNames,
    m: store.mode,
    b: store.bbox,
    p: {
      frequencyMhz: store.params.frequencyMhz,
      spreadingFactor: store.params.spreadingFactor,
      txPowerDbm: store.params.txPowerDbm,
      txHeightM: store.params.txHeightM,
      rxHeightM: store.params.rxHeightM,
      txAntennaGainDbi: store.params.txAntennaGainDbi,
      rxAntennaGainDbi: store.params.rxAntennaGainDbi,
      rxSensitivityDbm: store.params.rxSensitivityDbm,
      bandwidthHz: store.params.bandwidthHz,
      requiredMarginDb: store.params.requiredMarginDb,
      cableLossTxDb: store.params.cableLossTxDb,
      cableLossRxDb: store.params.cableLossRxDb,
      climate: store.params.climate,
      polarization: store.params.polarization,
      groundPermittivity: store.params.groundPermittivity,
      groundConductivity: store.params.groundConductivity,
      surfaceRefractivity: store.params.surfaceRefractivity,
    },
    cp: {
      maxRangeKm: store.coverageParams.maxRangeKm,
      numRadials: store.coverageParams.numRadials,
      threshold: store.coverageParams.threshold,
      targetCoverage: store.coverageParams.targetCoverage,
      highRes: store.coverageParams.highRes,
      clutterHeightM: store.coverageParams.clutterHeightM,
      situationFraction: store.coverageParams.situationFraction,
      timeFraction: store.coverageParams.timeFraction,
    },
    c: store.colormap,
    vp: null, // viewport will be added separately
  }
}
