/* Ported from meshtastic-site-planner's protocol.ts.
 * Worker message types between JsCoverageEngine and coverage.worker.ts. */

import type { EngineRunParams, RegionInfo } from './core'

export interface RunRequest {
  type: 'run'
  runId: number
  params: EngineRunParams
  demData?: Float32Array
  demWidth?: number
  demHeight?: number
  demAffine?: { a: number; c: number; f: number; e: number }
  pages?: (Int16Array | null)[]  // SPLAT! worker terrain pages
  start: number
  end: number
  chunk: number
}

export interface CancelRequest {
  type: 'cancel'
  runId: number
}

export type ToWorker = RunRequest | CancelRequest

export interface ReadyMessage {
  type: 'ready'
}

export interface ProgressMessage {
  type: 'progress'
  runId: number
  radialsDone: number
}

export interface DoneMessage {
  type: 'done'
  runId: number
  signal: Float32Array
  mask: Uint8Array
  region: RegionInfo
  itmWarnings: number[]
}

export interface ErrorMessage {
  type: 'error'
  runId: number
  code: string
  message: string
}

export type FromWorker = ReadyMessage | ProgressMessage | DoneMessage | ErrorMessage
