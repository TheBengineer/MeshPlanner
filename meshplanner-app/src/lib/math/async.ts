/**
 * Ported from meshtastic-site-planner core.ts.
 * Fast macrotask yield using MessageChannel (beats setTimeout's 4ms clamping).
 * Between radial chunks, yielding to the event loop keeps the UI responsive
 * and allows cancellation signals to be processed.
 */
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
