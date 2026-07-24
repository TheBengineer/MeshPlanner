/* Ported from meshtastic-site-planner's core.ts.
 * Shared types and utilities for the coverage engine. */

export interface EngineRunParams {
  lat: number
  lon: number
  txHeightM: number
  rxHeightM: number
  frequencyMhz: number
  txPowerDbm: number
  txAntennaGainDbi: number
  rxAntennaGainDbi: number
  rxSensitivityDbm: number
  bandwidthHz: number
  requiredMarginDb: number
  cableLossTxDb: number
  cableLossRxDb: number
  climate: number
  polarization: number
  groundPermittivity: number
  groundConductivity: number
  surfaceRefractivity: number
  radiusKm: number
  numRadials: number
  conf?: number
  rel?: number
  clutterHeightM?: number
  resolutionIppd?: number
  /** When true, output terrain elevation instead of signal strength. */
  debugTerrain?: boolean
}

export interface RegionInfo {
  width: number
  height: number
  north: number
  south: number
  east: number
  west: number
  radials: number
}

/** Ported from meshtastic-site-planner's core.ts.
 * Fast macrotask yield via MessageChannel. */
export const yieldToEventLoop = (() => {
  if (typeof MessageChannel === 'undefined')
    return () => new Promise<void>((r) => setTimeout(r, 0))
  const channel = new MessageChannel()
  let pending: (() => void) | null = null
  channel.port1.onmessage = () => {
    const r = pending
    pending = null
    r?.()
  }
  return () =>
    new Promise<void>((resolve) => {
      pending = resolve
      channel.port2.postMessage(null)
    })
})()
