# LoRa Network Site Planner for Disaster Recovery

> **Status:** Draft — initial project framing. Open questions and scope details to be filled in.

---

## 1. Problem Statement

When disasters strike (hurricanes, wildfires, earthquakes, floods), traditional communications infrastructure is often damaged or overloaded. Hurricane Helene's devastation of Asheville, NC in September 2024 is a stark recent example — mountainous terrain made cellular restoration slow and patchy, exactly the scenario where a rapidly-deployable LoRa network can fill critical gaps. LoRa (Long Range) is well-suited to disaster-recovery networks because:

- Low power → can run on batteries / solar / generators
- Long range (km-scale) → fewer sites needed
- License-free sub-GHz bands (US915, EU868, AU915, AS923)
- Off-grid: gateways + end devices form a self-contained mesh-ish network

The hard question is **where to put the gateways/repeaters**. Resources in a disaster are constrained (limited hardware, fuel, time, accessible sites). We need a tool that, given a target area and a set of constraints, recommends optimal placement.

### Two optimization problems (both needed)

1. **Minimum sites for full (or threshold) coverage** — set-cover style: given a candidate-site list, find the smallest subset whose combined coverage meets the target.
2. **Maximum coverage with a fixed number of repeaters** — knapsack/ILP style: with N gateways available, place them to cover the most area / people / critical sites.

---

## 2. Goals & Success Criteria

### Primary goals

- **G1.** Accurately simulate LoRa coverage at a candidate site, accounting for terrain (DEM), frequency band, spreading factor, TX power, and antenna height.
- **G2.** Solve the minimum-site / max-coverage optimization problems for a user-defined area.
- **G3.** Produce an interactive map showing candidate sites, per-site coverage rasters, and the recommended subset.
- **G4.** Run usefully on a laptop for a single county / region in < a few minutes.
- **G5.** Disaster-recovery-oriented UX: pre-loaded scenarios, fast iteration, exportable briefs (PDF/PNG/KML) that can be shared in the field.

### Non-goals (initial)

- Real-time mesh routing protocol design (assume point-to-gateway LoRaWAN-style traffic).
- Backhaul network design (cellular / satellite uplink from gateways is out of scope).
- Indoor / building penetration modeling (focus on outdoor coverage).
- Full RF propagation as a primary deliverable — we use a reasonable model and cross-check against established online tools.

### Success criteria

- [ ] Coverage predictions within ±3 dB of a reference online tool (e.g., Radio Mobile, CloudRF, Splat!) for a test area.
- [ ] Solver returns a provably optimal solution for ≤ 200 candidate sites; a heuristic for larger.
- [ ] End-to-end workflow (import area → simulate → optimize → export) takes < 5 min for a representative disaster scenario.
- [ ] Documented test case reproducing coverage predictions for the **Asheville, NC area** (post-Helene), validated against at least one reference RF tool and available post-disaster LoRa deployment reports.

---

## 3. Background & Reference Work

### Online signal-simulation tools (to learn from / cross-check)

- **Cloud RF** — commercial, web-based RF coverage mapping. Excellent reference for UI and propagation models.
- **Radio Mobile Online** — long-standing free tool, ITM/Longley-Rice model. Good offline-style use.
- **Splat!** — open-source RF propagation analysis using Longley-Rice / ITWOM. Linux-friendly. Good local model reference.
- **RFPM (ITM / ITWOM)** — the underlying propagation models used by the above.
- **LoraSim / LoRaPath** — LoRa-specific simulation work, often in research papers.
- **NS-3 with lorawan module** — packet-level simulation; useful for validating at smaller scales.

### Meshtastic Site Planner — ready-made coverage engine

> **Repository:** [github.com/meshtastic/meshtastic-site-planner](https://github.com/meshtastic/meshtastic-site-planner)
> **Live:** [site.meshtastic.org](https://site.meshtastic.org/)  \
> **License:** GPL-3.0  \
> **Stars:** ~100  \
> **Language:** TypeScript / Vue 3 / C++ (WASM)

The Meshtastic Site Planner is a **fully client-side** RF coverage prediction tool that solves the hardest parts of this project already:

- **Propagation engine:** SPLAT!'s ITM/Longley-Rice C++ code (`itwom3.0.cpp`), compiled **unmodified** to WebAssembly via Emscripten. Validated against golden outputs from the legacy server backend to ±1 dB.
- **Terrain data:** Streamed on-demand from AWS Open Data terrain tiles (NASA SRTM, 90m default / 30m HD). No local DEM storage, no large downloads — the browser caches processed pages in the Cache API.
- **Parallelism:** Web Worker pool (up to 8 workers) splitting the radial sweep. Bit-identical merge ensures N-worker results match single-threaded exactly.
- **Rendering:** GPU-accelerated MapLibre GL JS with two overlay styles — continuous heatmap or vector signal contours (GeoJSON, tappable).
- **PWA:** Installable, works offline (cached terrain), settings persist across reloads.
- **Exports:** GeoJSON, PNG+world file, KML — each per-site.
- **Multi-site:** Add several transmitters, toggle each independently, see combined coverage.
- **Find highpoint:** Snap a site to the highest ground within a search radius.
- **Link analysis:** Point-to-point terrain profile, Fresnel zone, link budget.

**What it already covers of our requirements:** ✅ F3 (LoRa params — device presets with SF, TX power, antenna gain, sensitivity)  \
✅ F5 (coverage simulation with ITM terrain-aware propagation)  \
✅ F7 (interactive map, GeoJSON/KML export)  \
✅ F8 (PWA offline mode)

**What we would need to build on top:**

| Gap                               | What we add                                                                                              |
|-----------------------------------|----------------------------------------------------------------------------------------------------------|
| **Optimization engine**           | Set-cover ILP (min sites for X% coverage), max-coverage for N sites, k-redundancy mode                   |
| **Weighted coverage**             | Population density (LandScan/WorldPop), critical-facility prioritization                                 |
| **Candidate site generation**     | OSM import (fire stations, schools, hospitals, towers, hilltops), grid generation, DEM hilltop detection |
| **Disaster templates**            | Pre-built scenarios (Asheville post-Helene, Florida Keys post-hurricane)                                 |
| **Batch optimization UI**         | Not per-site analysis but solver-driven site selection                                                   |
| **Field exports**                 | PDF one-pagers with coverage stats, KMZ for field GPS, coverage summaries                                |
| **Combined-coverage aggregation** | Union/intersection of multiple sites' coverage for optimizer input                                       |

**Strategic options:**

1. **Fork & extend** — Fork the Meshtastic Site Planner, add the optimization layer. Fastest path to a working product. GPL-3.0 compatible (fine for humanitarian tool).
2. **Embed as component** — Use the WASM engine + terrain pipeline as a library within our own app. The engine is MIT-compatible on its own.
3. **Reference architecture** — Study their approach (WASM ITM, AWS terrain tiles, MapLibre rendering) and reimplement in Python for a CLI-first tool.

**Recommended:** Option 1 (fork) for Phase 1–2 (coverage simulation), then add optimizer on top in Phase 3. The Meshtastic project has done exceptional validation work — golden test fixtures, ±1 dB tolerance, bit-identical parallelism — and their terrain pipeline is production-ready.

---

### LoRa link-budget basics (refresh)

- TX power (typically +14 to +20 dBm)
- Antenna gain (omni, 3–6 dBi typical for gateways, higher for sectoral)
- Path loss (ITM, Okumura-Hata, COST-231, or a custom log-distance model for LoRa)
- Receiver sensitivity (depends on spreading factor: SF7 ≈ -123 dBm, SF12 ≈ -137 dBm at 125 kHz BW)
- Link margin must be > 0; in disaster scenarios we may want a 10–15 dB margin for reliability.

### Hardware cost reference (for cost-aware optimization)

Knowing the bill-of-materials cost lets the optimizer weigh coverage against budget — critical when a disaster-response team has limited funds and needs to justify procurement.

| Item                                                                         | Unit Cost   | Notes                                                                               |
|------------------------------------------------------------------------------|-------------|-------------------------------------------------------------------------------------|
| **LoRa repeater / gateway** (DIY, ESP32 + LoRa SX126x + enclosure + battery) | **~$40**    | Can be solar-powered; runs days on a 5Ah battery. Omni antenna included.           |
| **Handheld unit** (chest-mount / pocket, requires smartphone via Bluetooth)  | **~$12**    | Battery lasts 8–12h. Relies on the user having a charged phone with Meshtastic app. |
| **Handheld unit with keyboard & screen** (standalone, no phone needed)       | **~$30–40** | Full autonomy for field teams. Screen shows messages, GPS, signal strength.         |

These prices make **N = 100repeaters** deployable for **~$4,000** — well within a small NGO or ham-radio club budget. The optimizer can accept a **total budget cap** (e.g., $2,000 → max 50 repeaters) or a **per-unit cost** and solve the max-coverage variant with a knapsack-style constraint.

---

### Optimization literature to review

- **Set cover / facility location** — classical ILP; PuLP/OR-Tools can solve hundreds of variables.
- **Maximum coverage problem** — ILP variant; k-coverage extension for redundancy.
- **Greedy heuristics** — quick and ~63% of optimal for unweighted set cover; good warm-start.
- **Metaheuristics** — simulated annealing, genetic algorithms for non-convex terrain-aware problems.

---

## 4. High-Level Architecture

```
┌──────────────────────────────────────────────────────┐
│  Web UI (FastAPI / Flask + Leaflet/MapLibre)         │
│  - draw area of interest                             │
│  - configure LoRa params                             │
│  - view coverage rasters & recommended sites         │
└──────────────────────────────────────────────────────┘
                       │
┌──────────────────────────────────────────────────────┐
│  Core engine (Python)                                │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Terrain      │  │ Propagation  │  │ Optimizer   │ │
│  │ (SRTM/ASTER) │→ │ (ITM/ITWOM   │→ │ (PuLP /     │ │
│  │ via rasterio │  │ + LoRa kcorr)│  │  greedy /   │ │
│  │              │  │              │  │  GA)        │ │
│  └──────────────┘  └──────────────┘  └─────────────┘ │
└──────────────────────────────────────────────────────┘
                       │
┌──────────────────────────────────────────────────────┐
│  Data sources                                        │
│  - DEM (SRTM 30m, ASTER 30m, 3DEP 10m for US)        │
│  - Land cover (NLCD, ESA WorldCover) for clutter     │
│  - Candidate site sources (OpenStreetMap towers,     │
│    schools, fire stations, hand-picked pins)         │
│  - Population (LandScan / WorldPop) for "people      │
│    covered" metric                                   │
└──────────────────────────────────────────────────────┘
```

---

## 5. Functional Requirements

### F1. Area input
- Bounding box, polygon, or named region (county, disaster-impact area).
- Predefined disaster-scenario templates (e.g., **"Asheville, NC — post-Helene, mountainous, 400 km²"**, "Florida Keys — post-hurricane, low-lying, 200 km²").

### F2. Terrain & clutter
- Auto-fetch DEM for the area; cache locally.
- Optional land-cover clutter loss adjustment.

### F3. LoRa parameter configuration
- Frequency band & channel
- Spreading factor (SF7–SF12) per site or per link
- TX power
- Antenna height & gain
- Receiver sensitivity / required link margin

### F4. Candidate site generation
- **Manual:** user drops pins on the map.
- **Imported:** load from CSV/GeoJSON / OSM query (towers, schools, fire stations, water tanks, hilltops).
- **Grid:** regular grid at user-defined spacing.
- **Hilltops:** auto-detect local maxima in DEM within the area.

### F5. Coverage simulation
- Per-candidate-site raster of received signal strength (RSSI) and SNR.
- Account for terrain via ITM/ITWOM along great-circle paths.
- User-selectable resolution (10 m, 30 m, 90 m).

### F6. Optimization
- **Mode A (Min sites for X% coverage):** user sets coverage target (e.g., 95% of area, or 95% of population).
- **Mode B (Max coverage with N sites):** user sets gateway count.
- **Mode C (k-redundant):** every covered point is within range of ≥ k gateways.
- Optional weighting: prioritize populated areas, critical facilities.

### F7. Outputs
- Interactive map with recommended sites, coverage overlay, excluded areas.
- PDF brief (one-pager for field teams).
- GeoJSON of selected sites + coverage polygon.
- CSV summary of per-site metrics (estimated devices supported, population covered, area covered).

### F8. Disaster-recovery specifics
- Save/load scenarios (so teams can compare "before / after" runs).
- Offline mode (cache DEM for target area in advance).
- Quick-export to KMZ for in-vehicle GPS / phones.

---

## 6. Non-Functional Requirements

- **Performance:** < 5 min end-to-end for ~100 candidate sites and 1000 km² area on a modern laptop.
- **Reproducibility:** deterministic results given fixed inputs and a seed.
- **Portability:** Linux-first, runs on modest hardware (no GPU required).
- **Open data:** default to free / open data sources (SRTM, OSM); paid APIs (paid DEM, paid commercial RF tools) as opt-in.
- **License:** choose a permissive license (MIT / Apache-2.0) to encourage adoption by humanitarian / community groups.

---

## 7. Tech Stack (proposed)

| Layer              | Choice                                                                  | Notes                                                                      |
|--------------------|-------------------------------------------------------------------------|----------------------------------------------------------------------------|
| Language           | TypeScript / Python (optimizer)                                         | See note below about Meshtastic Site Planner as base                       |
| Geo                | `MapLibre GL JS`, `Turf.js`, `geopandas`, `shapely`                     | Browser: MapLibre for interactive map; Python stack for offline optimizer  |
| Propagation        | **SPLAT! ITM/Longley-Rice → WebAssembly** (via Meshtastic Site Planner) | Already compiled to WASM, validated against golden outputs ±1 dB           |
| Terrain            | AWS Open Data terrain tiles (SRTM 90m / 30m HD)                         | Streamed on-demand, browser-cached — no local DEM storage needed           |
| Optimization       | `PuLP` (CBC) for ILP, greedy heuristics for large sets                  | Python-side; could also run WASM-based in future                           |
| Map UI             | `MapLibre GL JS` (GPU-accelerated) + Vue 3                              | Inherit from Meshtastic Site Planner's proven rendering pipeline           |
| Frontend framework | `Vue 3` + `TypeScript` + `Pinia`                                        | Aligns with Meshtastic Site Planner's architecture                         |
| Web framework      | `FastAPI` (optional, Python optimizer backend)                          | Core coverage engine is fully client-side; optimization may need a backend |
| Data sources       | SRTM via AWS Open Data terrain tiles, OSM via `osmnx` / Overpass API    | Terrain streaming already solved by Meshtastic; OSM candidate sites add-on |
| Packaging          | Static site (any host/CDN) + optional Docker for optimizer backend      |                                                                            |
| Tests              | Vitest + golden raster comparison (frontend), pytest (optimizer)        |                                                                            |

---

## 8. Phased Roadmap

### Phase 0 — Research & scoping (this document)
- Lock in scope, identify reference tools, decide on propagation model.
- Pick a single real disaster area to use as the canonical test case.

### Phase 1 — Coverage simulation MVP
- Fetch DEM for a small area.
- Place one candidate site.
- Render a coverage raster and compare against Cloud RF / Radio Mobile for the same inputs.
- **Exit:** pixel-wise coverage matches reference within agreed tolerance on the test case.

### Phase 2 — Multi-site & candidate generation
- Support manual + grid + OSM-imported candidate sites.
- Render per-site rasters and a combined-coverage layer.

### Phase 3 — Optimization
- Implement set-cover ILP for min-sites-for-coverage.
- Implement max-coverage-for-N-sites.
- Add k-redundancy mode.

### Phase 4 — Web UI
- Map-based area drawing, candidate pin dropping, parameter sliders.
- Display recommended subset on top of coverage heatmap.
- Export PDF/GeoJSON/KMZ.

### Phase 5 — Disaster-recovery polish
- Pre-built scenario templates.
- Offline DEM caching.
- Field-ready exports.
- Documentation targeted at volunteer / community groups.

### Phase 6 — Validation
- Compare to a known post-disaster LoRa deployment (literature / case study).
- Sensitivity analysis on model parameters.
- Performance benchmarking.

---

## 9. Open Questions

- [x] **Real disaster use case** — **Asheville, NC** (mountainous terrain, proven communications fragility post-Helene). 20×20 km area around the city.
- [ ] **Reference tool of choice** — Cloud RF (paid), Radio Mobile (free, local), or Splat! (FOSS) for cross-check?
- [ ] **Propagation model** — strict ITM, ITWOM, or a LoRa-tuned log-distance model? LoRa behaves a bit differently from narrowband at the same frequency.
- [ ] **DEM resolution** — SRTM 30 m global vs. 3DEP 10 m for US only? (Asheville has 3DEP coverage.)
- [ ] **Clutter** — include land-cover loss, or start terrain-only and add later?
- [ ] **Coverage metric** — area, population, or critical facilities (shelters, hospitals, fire stations)?
- [ ] **End-device model** — uniform distribution, or load real device density (e.g., per-census-block)?
- [ ] **Web vs. CLI** — start CLI + static-map outputs (faster), then add web UI, or web-first?
- [ ] **Hosting** — runs anywhere / self-hosted, or do we want a small public demo for community use during real events?
- [ ] **Existing online tool integration** — use one as a backend, or build standalone?

---

## 10. Risks

| Risk                                             | Likelihood | Impact | Mitigation                                                                               |
|--------------------------------------------------|------------|--------|------------------------------------------------------------------------------------------|
| Propagation model diverges from online tools     | Med        | High   | Validate Phase 1 against ≥2 reference tools; document deltas                             |
| DEM resolution too coarse for urban/rugged areas | Med        | Med    | Allow per-region DEM choice; fall back to 3DEP in US                                     |
| ILP doesn't scale to full state-scale problems   | Low        | Med    | Heuristic fallback (greedy + local search) already planned                               |
| Adoption by disaster-response orgs is slow       | Med        | Low    | Focus on documentation + pre-built scenarios; partner with ham-radio / ARRL-style groups |
| Frequency-band regulatory differences            | Low        | Low    | Make band configurable; document per-region limits                                       |

---

## 11. References (seed)

- Semtech LoRa Modem Designer's Guide
- ITU-R P.528 / P.1411 / Longley-Rice (ITS)
- Cloud RF, Radio Mobile Online, Splat! (online signal sims)
- Arash Habibi et al., "LoRa Network Planning and Optimization" literature
- Post-hurricane Maria / Harvey / Ian amateur-radio & LoRa deployment write-ups
- OSMnx for OpenStreetMap extraction

---

## 12. Next Steps

1. ✅ **Canonical test area decided: Asheville, NC** — 20×20 km area centered on the city. Mountainous terrain, 3DEP 10m available, post-Helene comms-failure well documented.
2. Pull SRTM 30m + 3DEP 10m tiles for the Asheville area.
3. Identify candidate sites in Asheville (OSM: fire stations, schools, hilltops in Blue Ridge).
4. Build a one-site coverage prototype and compare to reference tool.
5. Once matched, expand to candidate-set generation.
6. Revisit this document after Phase 1 to refine scope and Phase 3+ design.