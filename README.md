# LoRa Network Site Planner for Disaster Recovery

**MeshPlanner** helps disaster-response teams decide **where to place LoRa gateways** for optimal coverage. Given a terrain model and candidate site locations, it:

- 📡 **Simulates RF coverage** for each site using ITM/Longley-Rice propagation
- 🎯 **Optimises site selection** — minimum sites for target coverage, or max coverage with a fixed number of gateways
- 🗺️ **Exports results** as GeoJSON site lists and CSV summaries
- 🌐 **Offline-first SPA** — runs entirely in the browser, no server needed

The canonical test case is **Asheville, NC** after Hurricane Helene (2024) — mountainous terrain where LoRa can fill critical communications gaps.

---

## Quick Start

```bash
cd meshplanner-app
npm install
npm run dev
```

Open http://localhost:5173.

---

## Features

- **MapLibre GL JS** interactive map (free, no API key)
- **DEM fetch** from AWS Open Data SRTM tiles (streamed in-browser)
- **Coverage computation** via ITM radial sweep with Web Workers
- **Site management** (CSV/GeoJSON import, manual add, click-to-place)
- **Greedy + ILP optimisation** (hiGHS WASM solver)
- **Mobile-responsive** layout (375px → desktop)
- **Offline-capable** (Service Worker + IndexedDB DEM cache)

---

## Run Locally

```bash
cd meshplanner-app
npm install
npm run dev        # Development server on localhost:5173
npm run build      # Production build to dist/
npm run preview    # Preview production build
```

## Run Tests

```bash
cd meshplanner-app
npx vitest run                           # Unit tests
npx playwright test                      # E2E tests
npx vitest run src/tests/cross_validation/  # Cross-validation
```

## Deploy

```bash
cd meshplanner-app
npm run build
# Upload dist/ to any static host — no server needed
# Works with CloudFlare Pages, S3, Netlify, GitHub Pages
```

---

## Architecture

```
meshplanner-app/
├── src/
│   ├── components/     # React UI components
│   ├── store/          # Zustand state management
│   ├── lib/            # Core logic
│   │   ├── propagation/  # ITM radial sweep, LoRa params
│   │   ├── terrain/      # DEM fetch, profile computation
│   │   ├── optimize/     # Greedy + ILP solvers
│   │   ├── sites/        # Site model, CSV/GeoJSON I/O
│   │   └── export/       # GeoJSON, CSV writers
│   ├── hooks/          # Custom React hooks
│   ├── workers/        # Web Workers for off-thread computation
│   └── tests/          # Test suite
├── public/
│   ├── itmlogic/       # ITM propagation WASM module
│   └── wasm/           # Compiled WebAssembly binaries
├── e2e/                # Playwright end-to-end tests
└── dist/               # Production build output
```

### Optimisation pipeline

```
Sites + DEM
    │
    ▼
Batch coverage rasters (parallel ITM radial sweep via Web Workers)
    │
    ▼
Sparse coverage matrix (site × cell)
    │
    ▼
Greedy heuristic (fast feasible solution)
    │
    ▼
ILP with warm-start (hiGHS WASM) → optimal/suboptimal solution
    │
    ▼
Export: GeoJSON, CSV
```

---

## Project Structure

```
meshplanner-app/     ← Browser-based SPA (the whole application)
.github/workflows/   ← CI workflows (JS-only)
```

---

## License

MIT — open for humanitarian, community, and commercial use.

---

## Background

*Hurricane Helene (2024) devastated Asheville, NC — mountainous terrain made cellular restoration slow and patchy. LoRa networks, with their long range, low power, and license-free bands, can fill critical gaps when traditional infrastructure fails. MeshPlanner helps disaster-response teams decide where to put gateways.*
