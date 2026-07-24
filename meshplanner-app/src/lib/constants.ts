import { EARTH_RADIUS_KM } from './math/geodetic'
import { SF_SENSITIVITY, BAND_CENTERS } from './math/link-budget'
import type { LoraParams } from './types'

export { EARTH_RADIUS_KM, SF_SENSITIVITY, BAND_CENTERS }

export const DEFAULT_LORA_PARAMS: LoraParams = {frequencyMhz: 915, spreadingFactor: 10, txPowerDbm: 22, txHeightM: 2, rxHeightM: 1.5, txAntennaGainDbi: 3, rxAntennaGainDbi: 0, rxSensitivityDbm: -132, bandwidthHz: 125000, requiredMarginDb: 10, cableLossTxDb: 0.5, cableLossRxDb: 0.5, climate: 5, polarization: 1, groundPermittivity: 15.0, groundConductivity: 0.005, surfaceRefractivity: 314}
