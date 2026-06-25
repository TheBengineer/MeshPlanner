# MeshPlanner

**LoRa Network Site Planner for Disaster Recovery** — a fully client-side web app for planning LoRa mesh network deployments.

Compute RF coverage, optimize gateway placement, and export results — all in your browser. No server needed.

## Quick Start

```bash
cd meshplanner-app
npm install
npm run dev
```

Open http://localhost:5173 — draw a bounding box on the map, add candidate sites, and run coverage.

### Build for production

```bash
npm run build
# Upload dist/ to any static host (CloudFlare Pages, S3, Netlify, GitHub Pages)
```

## Features

### Coverage Simulation
- **DEM fetch**: SRTM 30m tiles streamed from AWS Open Data — no files to upload
- **ITM Propagation**: Full Longley-Rice model (itmlogic) ported to TypeScript, accurate within ±0.5dB
- **Radial Sweep**: 360 radials with angular gap-filling, parallelized across Web Workers
- **Link Budget**: LoRa-specific (SF7–SF12, configurable bands US915/EU868/AU915/AS923)

### Site Selection Optimization
- **Greedy heuristic**: Instant results (sub-100ms) for minimum-sites or max-coverage
- **ILP solver**: hiGHS WASM upgrades greedy result to optimal in background (lazy-loaded ~200KB)
- **Warm-start**: Greedy → ILP chain — see results immediately, improvement arrives progressively

### Site Management
- Manual add/remove sites via click on map or coordinate entry
- CSV import (`name,lat,lon`)
- GeoJSON import (FeatureCollection of Points)
- OSM import — fetch fire stations, schools, hospitals, towers via Overpass API
- Grid generation — regular grids at configurable spacing
- Hilltop detection — find local elevation maxima from DEM data

### Map & Visualization
- MapLibre GL JS (WebGL, free, no API key)
- RSSI heatmap overlay with adjustable threshold
- Site markers with selected/optimized site highlighting
- Bounding box selection (Shift+drag or long-press on mobile)

### Export
- GeoJSON — selected sites + coverage polygon
- CSV — per-site metrics table
- KML — for Google Earth / field GPS
- GeoTIFF — coverage raster with threshold masking
- Summary report — plain-text with parameters, timing, results

### Analysis
- Sensitivity analysis — re-run optimizer across nominal/optimistic/pessimistic scenarios
- Coverage validation — agreement metrics (accuracy, precision, recall, F1, Jaccard)

### Offline
- Service Worker caches app shell on first load
- IndexedDB caches DEM tiles (~500MB LRU) — previously viewed areas work offline
- All computation is local — no server round-trip needed

## Usage

### Single-site coverage

1. Draw bounding box on the map (or enter coordinates)
2. Wait for DEM tiles to load (progress shown)
3. Click on map to place transmitter, or upload candidate sites
4. Configure LoRa parameters (band, SF, TX power, range)
5. Click "Compute Coverage"
6. View RSSI heatmap overlay + coverage statistics
7. Export GeoJSON/GeoTIFF/CSV

### Site selection optimization

1. Load DEM + add candidate sites (manual, CSV, GeoJSON, OSM, or grid)
2. Select optimization mode: Min Sites or Max Coverage
3. Click "Optimize"
4. Greedy result appears instantly on the map
5. Greedy is automatically upgraded with ILP solution (background)
6. Export selected sites and combined coverage

## Architecture

```
meshplanner-app/
├── src/
│   ├── lib/
│   │   ├── propagation/   — ITM engine (itmlogic TS port), radial sweep, profiles
│   │   ├── optimize/      — Greedy, hiGHS WASM ILP, warm-start, sensitivity
│   │   ├── dem/           — SRTM tile fetch from AWS, IndexedDB cache, tile math
│   │   ├── math/          — Haversine, bilinear interpolation, FSPL, link budget, qerfi
│   │   ├── combine/       — Multi-raster union/intersection
│   │   ├── export/        — GeoJSON, CSV, GeoTIFF writers
│   │   ├── sites/         — CSV/GeoJSON/OSM parsers, grid gen, hilltop detection
│   │   └── validate.ts    — Coverage agreement metrics
│   ├── components/        — React UI: map, sidebar, workflow, export panels
│   ├── workers/           — Web Workers for parallel coverage computation
│   ├── store/             — Zustand state management
│   └── tests/             — 241 tests, 23 test files
├── vite.config.ts
└── package.json
```

## Dependencies

| Package | Size (gzip) | Purpose |
|---------|-------------|---------|
| `maplibre-gl` | ~150KB | WebGL map rendering |
| `react-map-gl/maplibre` | ~30KB | React map wrapper |
| `geotiff` | ~25KB | DEM tile parsing |
| `zustand` | ~2KB | State management |
| `highs` | ~200KB (lazy) | MILP solver (ILP optimization) |
| `idb` | ~2KB | IndexedDB wrapper |
| **Total (initial)** | **~180KB gzip** | |

The canonical test case is **Asheville, NC** after Hurricane Helene (2024).

## License

MIT
