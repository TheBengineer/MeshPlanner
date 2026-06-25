# MeshPlanner SPA

Browser-based LoRa network site planner. Offline-first, runs entirely in the browser.

## Quick Start

```bash
npm install
npm run dev        # localhost:5173
npm run build      # production to dist/
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development server with HMR |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npx vitest run` | Run unit tests |
| `npx vitest run --coverage` | Run tests with coverage |
| `npx vitest run src/tests/cross_validation/` | Cross-validation tests |
| `npx playwright test` | E2E tests |
| `npx tsc --noEmit` | Type check |
| `npx biome check src/` | Lint |

## Tech Stack

- React 19, TypeScript, Vite, Zustand
- MapLibre GL JS
- hiGHS WASM (ILP solver)
- Playwright (E2E tests), Vitest (unit tests)
- Biome (linting), Oxlint (extra rules)
- PWA (Service Worker via vite-plugin-pwa)
