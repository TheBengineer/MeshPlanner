import { yieldToEventLoop } from "../math/async"
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
  onRadial?: (ri: number, total: number) => void,
): CoverageRaster {
  const rssi = new Float32Array(demWidth * demHeight).fill(-Infinity)
  const stepKm = 0.2

  // Compute transmitter pixel explicitly so the center is never empty
  const txCol = Math.round((txLon - demAffine.c) / demAffine.a)
  const txRow = Math.round((txLat - demAffine.f) / demAffine.e)
  if (txCol >= 0 && txCol < demWidth && txRow >= 0 && txRow < demHeight) {
    rssi[txRow * demWidth + txCol] = params.txPowerDbm + (params.txAntennaGainDbi ?? 0) - (params.cableLossTxDb ?? 0)
  }

  for (let ri = 0; ri < numRadials; ri++) {
    const angle = (360 * ri) / numRadials
    for (let d = stepKm; d <= maxRangeKm; d += stepKm) {
      const [lat, lon] = destinationPoint(txLat, txLon, angle, d)
      const col = (lon - demAffine.c) / demAffine.a
      const row = (lat - demAffine.f) / demAffine.e
      const pixCol = Math.round(col)
      const pixRow = Math.round(row)
      if (pixCol < 0 || pixCol >= demWidth || pixRow < 0 || pixRow >= demHeight) continue
      const idx = pixRow * demWidth + pixCol
      // First-touch: skip if this pixel was already computed by an earlier radial
      if ((rssi[idx] ?? -Infinity) > -Infinity) continue
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
      rssi[idx] = budget.rxPowerDbm
    }
    onRadial?.(ri, numRadials)
  }

  /* ── Gap-filling: interpolate between radials, searching nearby distances ── */

  for (let row = 0; row < demHeight; row++) {
    for (let col = 0; col < demWidth; col++) {
      const idx = row * demWidth + col
      if ((rssi[idx] ?? -Infinity) > -Infinity) continue
      const lon = demAffine.c + col * demAffine.a
      const lat = demAffine.f + row * demAffine.e
      const dist = haversineDistance(txLat, txLon, lat, lon)
      if (dist > maxRangeKm || dist < 0.001) continue
      const bear = bearing(txLat, txLon, lat, lon)
      const anglePerRadial = 360 / numRadials
      const radialIdx = Math.floor(bear / anglePerRadial) % numRadials
      const leftAngle = radialIdx * anglePerRadial
      const rightAngle = ((radialIdx + 1) % numRadials) * anglePerRadial

      /**
       * Sample the RSSI at a given bearing and approximate distance,
       * searching a window of ±3 distance steps to handle the
       * 0.2 km quantization of the radial sweep. This eliminates
       * concentric ring artifacts by finding the nearest actual
       * computation point instead of requiring an exact distance match.
       */
      const sampleRadial = (angle: number): number => {
        const searchDeltas = [0, stepKm, -stepKm, 2 * stepKm, -2 * stepKm, 3 * stepKm, -3 * stepKm]
        for (const delta of searchDeltas) {
          const d = dist + delta
          if (d < stepKm || d > maxRangeKm) continue
          const [slat, slon] = destinationPoint(txLat, txLon, angle, d)
          const sc = Math.round((slon - demAffine.c) / demAffine.a)
          const sr = Math.round((slat - demAffine.f) / demAffine.e)
          if (sc >= 0 && sc < demWidth && sr >= 0 && sr < demHeight) {
            const v = rssi[sr * demWidth + sc]
            if (v !== undefined && v > -Infinity) return v
          }
        }
        return -Infinity
      }

      const leftRssi = sampleRadial(leftAngle)
      const rightRssi = sampleRadial(rightAngle)

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
