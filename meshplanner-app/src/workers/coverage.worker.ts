/* Worker: processes a radial slice, returns signal+mask rasters.
 * Message protocol matches meshtastic-site-planner's coverage.worker.ts. */

import { extractProfile } from "../lib/propagation/profile"
import { computePathLoss } from "../lib/propagation/itm"
import { calculateLinkBudget } from "../lib/math/link-budget"
import { destinationPoint } from "../lib/math/geodetic"
import type { FromWorker, ToWorker } from "../engine/protocol"

const stepKm = 0.2

const cancelled = new Set<number>()

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data

  if (msg.type === 'cancel') {
    cancelled.add(msg.runId)
    return
  }

  if (msg.type !== 'run') return
  const { runId, params, demData, demWidth, demHeight, demAffine, start, end } = msg

  const pixelCount = demWidth * demHeight
  const signal = new Float32Array(pixelCount).fill(-Infinity)
  const mask = new Uint8Array(pixelCount)

  // Transmitter pixel
  const txCol = Math.round((params.lon - demAffine.c) / demAffine.a)
  const txRow = Math.round((params.lat - demAffine.f) / demAffine.e)
  if (txCol >= 0 && txCol < demWidth && txRow >= 0 && txRow < demHeight) {
    const idx = txRow * demWidth + txCol
    signal[idx] = params.txPowerDbm + params.txAntennaGainDbi - params.cableLossTxDb
    mask[idx] = 248
  }

  for (let ri = start; ri < end; ri++) {
    if (cancelled.has(runId)) break
    const angle = (360 * ri) / params.numRadials

    for (let d = stepKm; d <= params.radiusKm; d += stepKm) {
      const [lat, lon] = destinationPoint(params.lat, params.lon, angle, d)
      const col = (lon - demAffine.c) / demAffine.a
      const row = (lat - demAffine.f) / demAffine.e
      const pc = Math.round(col)
      const pr = Math.round(row)
      if (pc < 0 || pc >= demWidth || pr < 0 || pr >= demHeight) continue
      const idx = pr * demWidth + pc
      if ((mask[idx]! & 248) !== 0) continue
      const profile = extractProfile(demData, demWidth, demHeight, demAffine, params.lat, params.lon, lat, lon, 100)
      const pl = computePathLoss(profile, {
        frequencyMhz: params.frequencyMhz,
        txHeightM: params.txHeightM,
        rxHeightM: params.rxHeightM,
        climate: params.climate,
        polarization: params.polarization,
        groundPermittivity: params.groundPermittivity,
        groundConductivity: params.groundConductivity,
        surfaceRefractivity: params.surfaceRefractivity,
      })
      const budget = calculateLinkBudget(
        {
          frequencyMhz: params.frequencyMhz,
          spreadingFactor: 10,
          txPowerDbm: params.txPowerDbm,
          txHeightM: params.txHeightM,
          rxHeightM: params.rxHeightM,
          txAntennaGainDbi: params.txAntennaGainDbi,
          rxAntennaGainDbi: params.rxAntennaGainDbi,
          rxSensitivityDbm: params.rxSensitivityDbm,
          bandwidthHz: params.bandwidthHz,
          requiredMarginDb: params.requiredMarginDb,
          cableLossTxDb: params.cableLossTxDb,
          cableLossRxDb: params.cableLossRxDb,
          climate: params.climate,
          polarization: params.polarization,
          groundPermittivity: params.groundPermittivity,
          groundConductivity: params.groundConductivity,
          surfaceRefractivity: params.surfaceRefractivity,
        },
        pl.pathLossDb,
      )
      signal[idx] = budget.rxPowerDbm
      mask[idx] = 248
    }

    // Progress every 8 radials (matches meshtastic's chunk yield pattern)
    if ((ri - start + 1) % 8 === 0 || ri === end - 1) {
      const progressMsg: FromWorker = {
        type: 'progress',
        runId,
        radialsDone: ri - start + 1,
      }
      self.postMessage(progressMsg)
    }
  }

  const itmWarnings = [0, 0, 0, 0, 0, 0]
  const region = {
    width: demWidth,
    height: demHeight,
    north: demAffine.f,
    south: demAffine.f + demHeight * demAffine.e,
    west: demAffine.c,
    east: demAffine.c + demWidth * demAffine.a,
    radials: end - start,
  }

  const doneMsg: FromWorker = {
    type: 'done',
    runId,
    signal,
    mask,
    region: region as any,
    itmWarnings,
  }
  self.postMessage(doneMsg, { transfer: [signal.buffer, mask.buffer] })
}

// Signal ready
self.postMessage({ type: 'ready' } as FromWorker)
