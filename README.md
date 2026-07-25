# MeshPlanner

**LoRa Mesh Network Site Planner for Disaster Recovery**

A fully client-side web app for planning resilient LoRa mesh network deployments in the immediate aftermath of a natural disaster — hurricanes, earthquakes, floods, or wildfires. All computation is local in the browser. No server, no internet required after initial load.

## The Vision

When a disaster strikes, communication infrastructure is often destroyed. First responders need to rapidly deploy a mesh network to coordinate search, rescue, and relief efforts. MeshPlanner helps answer one question:

> **Where do we place the minimum number of LoRa radios to cover the affected area and keep all critical sites connected?**

### Intended Workflow

1. **Select the affected area** — draw a bounding box on the map around the disaster zone (e.g., a flood-impacted valley in western North Carolina).

2. **Mark existing sites** — place markers for locations already hosting LoRa nodes: fire station, police department, town hall, emergency shelter, hospital, EOC.

3. **Mark required coordination areas** — locations that need coverage but don't have a node yet (e.g., a church parking lot being used as a FEMA staging area, a school gym serving as a shelter).

4. **Scan terrain** — the system fetches SRTM 30m elevation tiles for the area and runs SPLAT! (ITWOM propagation model) to compute coverage from every significant hilltop. Topographic prominence analysis identifies the most valuable peaks.

5. **Auto-connect the mesh** — a minimum spanning tree algorithm connects all existing + required sites via LoRa links, automatically inserting hilltop relay sites where needed to bridge coverage gaps.

6. **Maximize coverage** — an automated scan finds the minimum number of additional radios needed to achieve 95%+ coverage of every structure and valley in the affected zone, using the ITM propagation model and connectivity-aware greedy optimization.

7. **(Future) Structure-aware planning** — satellite/aerial imagery of the affected area is processed to identify individual structures (houses with damaged roofs, marked with visible signs). The optimizer can then target 100% coverage of all identified structures.

### Real-World Scenario

**Asheville, NC — After Hurricane Helene (2024)**

The canonical test case. Flooding destroyed roads, bridges, and cell towers across a mountainous region. Emergency responders need to establish mesh communication between:

- Asheville Regional EOC
- Local fire stations cut off by landslides
- Temporary shelter locations in school gymnasiums
- A field hospital set up in a church parking lot

MeshPlanner scans the surrounding Blue Ridge peaks, identifies which hilltops provide line-of-sight to each site, computes coverage for every valley, and produces a deployment plan showing exactly where to place the minimum number of radios.

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
- **DEM fetch**: SRTM 30m tiles streamed from AWS Open Data — no files to upload. IndexedDB cache (~500MB LRU) means previously viewed areas load instantly offline.
- **SPLAT! ITWOM Propagation**: C-based Longley-Rice model compiled to WASM for browser-side propagation simulation with ITWOM v3.0 enhancements.
- **JS ITMLogic Engine**: Pure TypeScript Longley-Rice implementation as a fallback, matching SPLAT! output within ±0.5dB.
- **Link Budget**: LoRa-specific (SF7–SF12, configurable bands US915/EU868/AU915/AS923).

### Mesh Planning (WIP)
- **Terrain scout**: Detects topographic prominences from DEM data, ranks peaks by viewshed coverage area.
- **Connectivity-aware selection**: Greedy algorithm with connectivity bonus — prefers sites that can link to the existing mesh over isolated high-coverage positions.
- **Minimum spanning tree**: Kruskal's algorithm connects selected sites, with automatic bridging-candidate insertion when the mesh is disconnected.
- **Coverage zone polygon**: Define the target coverage area as a draggable polygon on the map. The optimizer targets this region.
- **Progressive evaluation**: Viewshed proxy (geometric LOS, sub-second per peak) → low-resolution coverage (600 ippd) → full-resolution SPLAT! (1200 ippd) only for final selected sites.

### Site Management
- Manual add/remove sites via click on map or coordinate entry
- CSV import (`name,lat,lon`)
- GeoJSON import (FeatureCollection of Points)
- OSM import — fetch fire stations, schools, hospitals, towers via Overpass API
- Grid generation — regular grids at configurable spacing
- Device profile quick-fill — preconfigure power/gain for common Meshtastic hardware
- Hilltop detection — find local elevation maxima from DEM data

### Map & Visualization
- MapLibre GL JS (WebGL, free, no API key)
- RSSI heatmap overlay with adjustable threshold and Mercator reprojection
- Terrain elevation overlay — toggle to see raw elevation data
- Coverage zone polygon with draggable vertices
- MST edge visualization — lines colored by link margin (green/yellow/red)
- Site markers with selected/optimized site highlighting
- Multiple basemap support (OpenTopoMap, satellite, streets)

### Optimization
- **Greedy heuristic**: Instant results (sub-100ms) for minimum-sites or max-coverage
- **Connectivity-aware greedy**: Augmented scoring with connectivity bonus for mesh deployment planning
- **ILP solver**: hiGHS WASM upgrades greedy result to optimal in background (lazy-loaded ~200KB)
- **Warm-start**: Greedy → ILP chain — see results immediately, improvement arrives progressively

### Export
- GeoJSON — selected sites + coverage polygon + MST edges
- CSV — per-site metrics table
- KML — for Google Earth / field GPS
- GeoTIFF — coverage raster with threshold masking
- Summary report — plain-text with parameters, timing, results

### Analysis
- Coverage gap analysis — visualize which areas within the target zone are not covered
- Sensitivity analysis — re-run optimizer across nominal/optimistic/pessimistic scenarios
- Coverage validation — agreement metrics (accuracy, precision, recall, F1, Jaccard)

### Offline
- Service Worker caches app shell on first load
- IndexedDB caches DEM tiles (~500MB LRU) — previously viewed areas work offline
- All computation is local — wasm, workers, and JS engines run without any server round-trip

## Architecture

```
meshplanner-app/
├── src/
│   ├── lib/
│   │   ├── propagation/   — ITM engine (itmlogic TS port), SPLAT! WASM driver
│   │   ├── optimize/      — Greedy, hiGHS WASM ILP, warm-start, sensitivity
│   │   ├── planning/      — Viewshed proxy, connectivity graph, scout, MST builder, selector
│   │   ├── dem/           — SRTM tile fetch from AWS, IndexedDB cache, tile math
│   │   ├── math/          — Haversine, bilinear interpolation, FSPL, link budget, qerfi
│   │   ├── combine/       — Multi-raster union/intersection
│   │   ├── export/        — GeoJSON, CSV, GeoTIFF writers
│   │   ├── sites/         — CSV/GeoJSON/OSM parsers, grid gen, hilltop detection
│   │   └── validate.ts    — Coverage agreement metrics
│   ├── engine/            — Coverage engine interface, WASM bindings, page builder
│   ├── components/        — React UI: map, sidebar, workflow, export panels
│   ├── workers/           — Web Workers for parallel coverage computation
│   ├── store/             — Zustand state management with key-value persistence
│   └── tests/             — 260+ tests across planning, propagation, optimization
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

## Roadmap

- [x] Single-site coverage with SPLAT! WASM
- [x] Multi-site greedy optimization
- [x] ILP solver background upgrade
- [x] Hilltop detection from DEM
- [x] Device profile quick-fill (Meshtastic radios)
- [x] Coverage zone polygon
- [x] Viewshed proxy for terrain scouting
- [x] Connectivity graph with ITM link budget
- [x] Connectivity-aware greedy selector
- [x] MST builder with bridging candidate search
- [x] Mesh plan visualization on map
- [ ] Full "Plan Mesh" automated pipeline
- [ ] OSM/fire-station/school import for existing sites
- [ ] Aerial imagery structure detection for 100% coverage targeting
- [ ] Field export format for radio programming

## License

MIT
