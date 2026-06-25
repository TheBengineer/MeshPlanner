import type { LoraParams, LinkBudget } from '../types'

export const SF_SENSITIVITY: Record<number, number> = {
  7: -123, 8: -126, 9: -129, 10: -132, 11: -134, 12: -137,
} as const

export const BAND_CENTERS: Record<string, number> = {
  US915: 915, EU868: 868, AU915: 915, AS923: 923,
  CN470: 470, IN865: 865, KR920: 920,
} as const

export function calculateLinkBudget(params: LoraParams, pathLossDb: number): LinkBudget {
  const txEirp = params.txPowerDbm + params.txAntennaGainDbi - params.cableLossTxDb
  const rxPower = txEirp - pathLossDb + params.rxAntennaGainDbi - params.cableLossRxDb
  const rxSensitivity = params.rxSensitivityDbm ?? SF_SENSITIVITY[params.spreadingFactor] ?? -130
  const margin = rxPower - rxSensitivity
  return { txEirpDbm: Math.round(txEirp * 10) / 10, pathLossDb: Math.round(pathLossDb * 10) / 10, rxPowerDbm: Math.round(rxPower * 10) / 10, rxSensitivityDbm: rxSensitivity, marginDb: Math.round(margin * 10) / 10, isFeasible: margin >= params.requiredMarginDb }
}

export function estimateRangeKm(params: LoraParams, freeSpace: boolean = false): number {
  const pl0 = 32.45 + 20 * Math.log10(params.frequencyMhz)
  const n = freeSpace ? 2.0 : 2.5
  const rxSensitivity = params.rxSensitivityDbm ?? SF_SENSITIVITY[params.spreadingFactor] ?? -130
  const availablePl = params.txPowerDbm - params.cableLossTxDb - rxSensitivity - params.requiredMarginDb - params.cableLossRxDb
  if (availablePl <= pl0) return 0.0
  return Math.round((10 ** ((availablePl - pl0) / (10 * n))) * 100) / 100
}
