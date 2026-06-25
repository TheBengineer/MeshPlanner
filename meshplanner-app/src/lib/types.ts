export interface Bbox {
  west: number; south: number; east: number; north: number
}

export interface LoraParams {
  frequencyMhz: number
  spreadingFactor: number
  txPowerDbm: number
  txHeightM: number
  rxHeightM: number
  txAntennaGainDbi: number
  rxAntennaGainDbi: number
  rxSensitivityDbm: number
  bandwidthHz: number
  requiredMarginDb: number
  cableLossTxDb: number
  cableLossRxDb: number

  /* ITM propagation model parameters */
  climate?: number          /* 1-Equatorial … 7-Maritime Temperate (sea); default 5 */
  polarization?: number     /* 0=horizontal, 1=vertical; default 1 */
  groundPermittivity?: number  /* relative permittivity ε; default 15.0 */
  groundConductivity?: number  /* σ in S/m; default 0.005 */
  surfaceRefractivity?: number /* Nₛ in N-units; default 314 */
}

export interface LinkBudget {
  txEirpDbm: number
  pathLossDb: number
  rxPowerDbm: number
  rxSensitivityDbm: number
  marginDb: number
  isFeasible: boolean
}

export interface CandidateSite {
  name: string
  latitude: number
  longitude: number
  elevationM?: number
  notes?: string
}

export interface TerrainProfile {
  elevations: Float64Array
  distancesKm: Float64Array
  totalDistanceKm: number
  maxElevation: number
  minElevation: number
  avgElevation: number
  latlons: [number, number][]
}

export interface DemMetadata {
  affine: import("./math/affine").Affine
  crs: string
  bounds: Bbox
  resolution: string
}

export interface CoverageRaster {
  rssi: Float32Array
  width: number
  height: number
  affine: import("./math/affine").Affine
  txLat: number
  txLon: number
  params: LoraParams
  maxRangeKm: number
  numRadials: number
}

export interface CoverageMatrix {
  rowPtr: Uint32Array
  colIndices: Uint32Array
  nSites: number
  nCells: number
}

export interface OptimizationResult {
  selectedSites: string[]
  coveredFraction: number
  objectiveValue?: number
  solveTimeS: number
  status: string
  source: string
}
