/**
 * Serialize/deserialize app configuration state to/from a base64 URL parameter.
 *
 * Uses the store's flat `settings` key-value map so adding a new setting is
 * transparent — no need to update extract/restore code.
 */

import type { AppStore, AppMode } from '../store'
import type { Bbox, CandidateSite, HilltopScored, MeshPlanResult } from './types'

export interface PersistedState {
  v: 1
  s: CandidateSite[]
  sn: string[]
  m: AppMode
  b: Bbox | null
  /** Flat key-value map of all user-configurable settings. */
  kv: Record<string, any>
  c: string  // colormap
  vp: { lat: number; lon: number; zoom: number } | null
  cz?: [number, number][] | null  // coverage zone polygon
  hc?: HilltopScored[] | null     // hilltop candidates
  mpr?: MeshPlanResult | null     // mesh plan result
}

export function encodeState(state: PersistedState): string {
  const json = JSON.stringify(state)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeState(encoded: string): PersistedState | null {
  try {
    let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    while (base64.length % 4) base64 += '='
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const json = new TextDecoder().decode(bytes)
    return JSON.parse(json) as PersistedState
  } catch {
    return null
  }
}

export function extractState(store: {
  sites: CandidateSite[]
  selectedSiteNames: string[]
  mode: AppMode
  bbox: Bbox | null
  settings: Record<string, any>
  coverageZone?: [number, number][] | null
  hilltopCandidates?: HilltopScored[] | null
  meshPlanResult?: MeshPlanResult | null
}): PersistedState {
  return {
    v: 1,
    s: store.sites,
    sn: store.selectedSiteNames,
    m: store.mode,
    b: store.bbox,
    kv: store.settings,
    c: (store as any).colormap ?? 'plasma',
    vp: null,
    cz: store.coverageZone ?? null,
    hc: store.hilltopCandidates ?? null,
    mpr: store.meshPlanResult ?? null,
  }
}
