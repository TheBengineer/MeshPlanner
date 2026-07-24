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
  /** Signal values: dBm+200, 0-255 range. Only valid where mask byte has upper bits set. */
  signal: Float32Array
  /** Mask byte: upper 5 bits set = pixel has data. Lower 3 bits = which radial wrote it (0-7). */
  mask: Uint8Array
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

  const pixelCount = demWidth * demHeight
  const signal = new Float32Array(pixelCount).fill(-Infinity)
  const mask = new Uint8Array(pixelCount)
  const stepKm = 0.2

  // Compute transmitter pixel explicitly so the center is never empty
  const txCol = Math.round((txLon - demAffine.c) / demAffine.a)
  const txRow = Math.round((txLat - demAffine.f) / demAffine.e)
  if (txCol >= 0 && txCol < demWidth && txRow >= 0 && txRow < demHeight) {
    const txIdx = txRow * demWidth + txCol
    signal[txIdx] = params.txPowerDbm + (params.txAntennaGainDbi ?? 0) - (params.cableLossTxDb ?? 0)
    mask[txIdx] = 248 // all upper bits set = has data
  }

  for (let ri = 0; ri < radialCount; ri++) {
    const globalRi = radialStart + ri
    const angle = (360 * globalRi) / numRadials
    const radialBit = (globalRi % 8) // lower 3 bits track which radial wrote this pixel

    for (let d = stepKm; d <= maxRangeKm; d += stepKm) {
      const [lat, lon] = destinationPoint(txLat, txLon, angle, d)
      const col = (lon - demAffine.c) / demAffine.a
      const row = (lat - demAffine.f) / demAffine.e
      const pixCol = Math.round(col)
      const pixRow = Math.round(row)
      if (pixCol < 0 || pixCol >= demWidth || pixRow < 0 || pixRow >= demHeight) continue

      const idx = pixRow * demWidth + pixCol
      // First-touch: skip if this pixel already has data (mask upper bits set)
      if ((mask[idx]! & 248) !== 0) continue

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
      signal[idx] = budget.rxPowerDbm
      // Store as dBm+200 in the mask's upper bits, radial index in lower 3
      mask[idx] = (1 << 3) | (radialBit & 7)
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

  // Transfer both buffers back to main thread (zero-copy)
  const msg: ResultMessage = {
    type: "result",
    signal,
    mask,
    width: demWidth,
    height: demHeight,
  }
  self.postMessage(msg, { transfer: [signal.buffer, mask.buffer] })
}
