/** Vitest setup – jsdom polyfills for React component testing. */

// Guard: only run in jsdom / browser environments (not node)
if (typeof window !== 'undefined') {
  // maplibre-gl calls URL.createObjectURL at module import time
  if (typeof window.URL.createObjectURL !== 'function') {
    window.URL.createObjectURL = () => ''
  }
}

// Tell React we are in a testing environment so act() works without warnings.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
