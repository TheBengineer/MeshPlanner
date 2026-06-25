/** Vitest setup – jsdom polyfills for maplibre-gl compatibility. */

// Guard: only run in jsdom / browser environments (not node)
if (typeof window !== 'undefined') {
  // maplibre-gl calls URL.createObjectURL at module import time
  if (typeof window.URL.createObjectURL !== 'function') {
    window.URL.createObjectURL = () => ''
  }
}
