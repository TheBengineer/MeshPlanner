import { extractProfile } from "./profile"
import { computePathLoss } from "./itm"
import { calculateLinkBudget } from "../math/link-budget"
import { destinationPoint, haversineDistance, bearing } from "../math/geodetic"
import { Affine } from "../math/affine"
import type { CoverageRaster, LoraParams } from "../types"

export { combineCoverage } from "../combine/union"

export function computeCoverageRaster(
  demData: Float32Array,
  demWidth: number,
  demHeight: number,
  demAffine: { a: number; c: number; f: number; e: number },
  txLat: number, txLon: number,
  params: LoraParams,
  maxRangeKm: number = 30,
  numRadials: number = 360,
): CoverageRaster {
  const rssi = new Float32Array(demWidth * demHeight).fill(-Infinity)
  const stepKm = 0.2

  for (let ri = 0; ri < numRadials; ri++) {
    const angle = (360 * ri) / numRadials
    for (let d = stepKm; d <= maxRangeKm; d += stepKm) {
      const [lat, lon] = destinationPoint(txLat, txLon, angle, d)
      const col = (lon - demAffine.c) / demAffine.a
      const row = (lat - demAffine.f) / demAffine.e
      const pixCol = Math.round(col)
      const pixRow = Math.round(row)
      if (pixCol < 0 || pixCol >= demWidth || pixRow < 0 || pixRow >= demHeight) continue
      const profile = extractProfile(demData, demWidth, demHeight, demAffine, txLat, txLon, lat, lon, 100)
      const plResult = computePathLoss(profile, {
        frequencyMhz: params.frequencyMhz,
        txHeightM: params.txHeightM,
        rxHeightM: params.rxHeightM,
        climate: params.climate,
        polarization: params.polarization,
        groundPermittivity: params.groundPermittivity,
        groundConductivity: params.groundConductivity,
        surfaceRefractivity: params.surfaceRefractivity,
      })
      const budget = calculateLinkBudget(params, plResult.pathLossDb)
      const idx = pixRow * demWidth + pixCol
      const existing = rssi[idx] ?? -Infinity
      rssi[idx] = Math.max(existing, budget.rxPowerDbm)
    }
  }

  for (let row = 0; row < demHeight; row++) {
    for (let col = 0; col < demWidth; col++) {
      const idx = row * demWidth + col
      if ((rssi[idx] ?? -Infinity) > -Infinity) continue
      const lon = demAffine.c + col * demAffine.a
      const lat = demAffine.f + row * demAffine.e
      const dist = haversineDistance(txLat, txLon, lat, lon)
      if (dist > maxRangeKm || dist < 0.1) continue
      const bear = bearing(txLat, txLon, lat, lon)
      const anglePerRadial = 360 / numRadials
      const radialIdx = Math.floor(bear / anglePerRadial) % numRadials
      const leftAngle = radialIdx * anglePerRadial
      const rightAngle = ((radialIdx + 1) % numRadials) * anglePerRadial

      const [leftLat, leftLon] = destinationPoint(txLat, txLon, leftAngle, dist)
      const [rightLat, rightLon] = destinationPoint(txLat, txLon, rightAngle, dist)

      const leftCol = Math.round((leftLon - demAffine.c) / demAffine.a)
      const leftRow = Math.round((leftLat - demAffine.f) / demAffine.e)
      const rightCol = Math.round((rightLon - demAffine.c) / demAffine.a)
      const rightRow = Math.round((rightLat - demAffine.f) / demAffine.e)

      let leftRssi = -Infinity
      let rightRssi = -Infinity
      if (leftCol >= 0 && leftCol < demWidth && leftRow >= 0 && leftRow < demHeight) leftRssi = rssi[leftRow * demWidth + leftCol] ?? -Infinity
      if (rightCol >= 0 && rightCol < demWidth && rightRow >= 0 && rightRow < demHeight) rightRssi = rssi[rightRow * demWidth + rightCol] ?? -Infinity

      if (leftRssi > -Infinity && rightRssi > -Infinity) {
        const weight = (bear - leftAngle) / (rightAngle - leftAngle + 360)
        rssi[idx] = leftRssi + weight * (rightRssi - leftRssi)
      } else if (leftRssi > -Infinity) {
        rssi[idx] = leftRssi
      } else if (rightRssi > -Infinity) {
        rssi[idx] = rightRssi
      }
    }
  }

  return {
    rssi, width: demWidth, height: demHeight,
    affine: new Affine(demAffine.a, 0, demAffine.c, 0, demAffine.e, demAffine.f), txLat, txLon, params,
    maxRangeKm, numRadials,
  }
}
