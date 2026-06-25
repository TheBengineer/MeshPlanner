import { extractProfile } from "../lib/propagation/profile"
import { computePathLoss } from "../lib/propagation/itm"
import { calculateLinkBudget } from "../lib/math/link-budget"
import { destinationPoint } from "../lib/math/geodetic"
import type { LoraParams } from "../lib/types"

/* ── Message protocol ── */

interface CoverageWorkerInput {
  demData: Float32Array
  demWidth: number
  demHeight: number
  demAffine: { a: number; c: number; f: number; e: number }
  txLat: number
  txLon: number
  params: LoraParams
  radialStart: number
  radialCount: number
  maxRangeKm: number
  numRadials: number
}

interface ProgressMessage {
  type: "progress"
  radialsDone: number
  totalRadials: number
}

interface ResultMessage {
  type: "result"
  rssi: Float32Array
  width: number
  height: number
}

type OutboundMessage = ProgressMessage | ResultMessage

/* ── Worker entry point ── */

self.onmessage = (e: MessageEvent<CoverageWorkerInput>) => {
  const {
    demData,
    demWidth,
    demHeight,
    demAffine,
    txLat,
    txLon,
    params,
    radialStart,
    radialCount,
    maxRangeKm,
    numRadials,
  } = e.data

  const rssi = new Float32Array(demWidth * demHeight).fill(-Infinity)
  const stepKm = 0.2

  for (let ri = 0; ri < radialCount; ri++) {
    const globalRi = radialStart + ri
    const angle = (360 * globalRi) / numRadials

    for (let d = stepKm; d <= maxRangeKm; d += stepKm) {
      const [lat, lon] = destinationPoint(txLat, txLon, angle, d)
      const col = (lon - demAffine.c) / demAffine.a
      const row = (lat - demAffine.f) / demAffine.e
      const pixCol = Math.round(col)
      const pixRow = Math.round(row)
      if (pixCol < 0 || pixCol >= demWidth || pixRow < 0 || pixRow >= demHeight) continue

      const profile = extractProfile(
        demData,
        demWidth,
        demHeight,
        demAffine,
        txLat,
        txLon,
        lat,
        lon,
        100,
      )
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

    // Report progress every 5 radials or on completion
    if ((ri + 1) % 5 === 0 || ri === radialCount - 1) {
      const msg: ProgressMessage = {
        type: "progress",
        radialsDone: ri + 1,
        totalRadials: radialCount,
      }
      self.postMessage(msg)
    }
  }

  // Transfer the RSSI buffer back to main thread (zero-copy)
  const msg: ResultMessage = {
    type: "result",
    rssi,
    width: demWidth,
    height: demHeight,
  }
  self.postMessage(msg, { transfer: [rssi.buffer] })
}
