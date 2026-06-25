# LoRa Network Site Planner for Disaster Recovery

**MeshPlanner** helps disaster-response teams decide **where to place LoRa gateways** for optimal coverage. Given a terrain model and candidate site locations, it:

- 📡 **Simulates RF coverage** for each site using ITM/Longley-Rice propagation
- 🎯 **Optimises site selection** — minimum sites for target coverage, or max coverage with a fixed number of gateways
- 🗺️ **Exports results** as GeoTIFF rasters, GeoJSON site lists, and CSV summaries
- 🌐 **Web UI** with interactive map (Streamlit) and offline-first JavaScript SPA

The canonical test case is **Asheville, NC** after Hurricane Helene (2024) — mountainous terrain where LoRa can fill critical communications gaps.

---

## Quick Start (3 commands)

```bash
# 1. Download a DEM and compute coverage for one transmitter
meshplanner coverage --west -82.6 --south 35.5 --east -82.4 --north 35.7 --tx-lat 35.6 --tx-lon -82.5

# 2. Optimise: find minimum sites for 95% coverage
meshplanner optimize --sites tests/data/asheville_sites.csv --dem asheville_dem.tif --mode min-sites --target 0.95

# 3. Export selected sites as GeoJSON
meshplanner export --input ./output/optimize_results.json --format geojson
```

**See [CLI Commands](#cli-commands) below for all options.**

---

## Installation

```bash
pip install meshplanner
```

For development:

```bash
git clone https://github.com/your-org/meshplanner.git
cd meshplanner
pip install -e ".[dev]"
```

### Dependencies

**Required:**
- Python ≥ 3.10
- `numpy`, `scipy` — numerical + sparse matrix operations
- `rasterio` — GeoTIFF I/O
- `click` — CLI framework
- `tqdm` — progress bars
- `PuLP` — ILP solver (CBC bundled)
- `requests` — DEM tile download
- `shapely` — geospatial geometry

**Optional extras:**

| Install target | Extras |
|---|---|
| `pip install meshplanner[web]` | Streamlit web UI (`streamlit`, `folium`, `streamlit-folium`) |
| `pip install meshplanner[osm]` | OpenStreetMap data (`osmnx`) |
| `pip install meshplanner[dev]` | Development (`pytest`, `pytest-cov`, `ruff`) |

---

## Docker

### Quick start (Streamlit web UI)

```bash
docker compose up
```

Open http://localhost:8501 in your browser. The web UI lets you upload a DEM and candidate sites, configure LoRa parameters, and run coverage / optimisation from a graphical interface.

### Run CLI commands

```bash
# Single-transmitter coverage
docker compose run --rm cli coverage \
  --west -82.65 --south 35.50 \
  --east -82.45 --north 35.65 \
  --tx-lat 35.595 --tx-lon -82.555 \
  --output /app/output

# Site optimisation
docker compose run --rm cli optimize \
  --sites /app/tests/data/asheville_sites.csv \
  --dem /app/asheville_dem.tif \
  --mode min-sites --target 0.95 \
  --output /app/output
```

Inside the container, all output directories are under `/app/` (the container's working directory). Mount a local volume to persist results:

```bash
docker compose run --rm \
  -v "$(pwd)/output:/app/output" \
  cli coverage --west -82.65 --south 35.50 \
  --east -82.45 --north 35.65 \
  --tx-lat 35.595 --tx-lon -82.555 \
  --output /app/output
```

### Container entrypoint

The `entrypoint.py` router dispatches based on the first argument:

| Command | Behaviour |
|---|---|
| `docker run meshplanner` (no args) | Launch Streamlit web UI on port 8501 |
| `docker run meshplanner web` | Launch Streamlit web UI on port 8501 |
| `docker run meshplanner cli <args>` | Run the CLI with `<args>` |
| `docker run meshplanner coverage ...` | Shortcut — runs the CLI directly |

### Build the image manually

```bash
docker build -t meshplanner .
docker run --rm -p 8501:8501 meshplanner        # web UI
docker run --rm meshplanner cli --help           # CLI help
```

### Docker compose profiles

The `cli` service uses the `cli-only` profile and is excluded from `docker compose up`. Start both services explicitly:

```bash
docker compose --profile cli-only up
```

---

## Quick Start — Asheville, NC

```bash
# 1. Single-transmitter coverage for downtown Asheville
meshplanner coverage \
  --west -82.65 --south 35.50 \
  --east -82.45 --north 35.65 \
  --tx-lat 35.595 --tx-lon -82.555 \
  --output ./asheville

# 2. Batch-process a set of candidate sites
meshplanner batch \
  --sites tests/data/asheville_sites.csv \
  --dem asheville_dem.tif \
  --output ./asheville_batch

# 3. Optimise: find minimum sites for 95% coverage
meshplanner optimize \
  --sites tests/data/asheville_sites.csv \
  --dem asheville_dem.tif \
  --mode min-sites \
  --target 0.95 \
  --output ./asheville_opt

# 4. Export selected sites to GeoJSON
meshplanner export \
  --input ./asheville_opt/optimize_results.json \
  --format geojson \
  --output ./asheville_opt/selected_sites.geojson
```

### Step-by-step walkthrough

1. **Fetch a DEM** (or use a local GeoTIFF):
   ```python
   from meshplanner.terrain.fetch import fetch_dem_raster
   dem, meta = fetch_dem_raster({"west": -82.65, "south": 35.50,
                                  "east": -82.45, "north": 35.65})
   ```

2. **Create candidate sites** (CSV format):
   ```csv
   name,lat,lon,elevation,notes
   Site_A,35.595,-82.555,,Downtown
   Site_B,35.610,-82.580,,UNCA
   Site_C,35.570,-82.530,,Biltmore
   ```

3. **Run coverage for one site** via the CLI (see above) or Python:
   ```python
   from meshplanner.propagation.coverage import compute_coverage_raster
   from meshplanner.propagation.params import LoraParams
   params = LoraParams(frequency_mhz=915.0, spreading_factor=10, tx_power_dbm=20)
   rssi, meta = compute_coverage_raster(dem, meta, tx_lat=35.595, tx_lon=-82.555, params=params)
   ```

4. **Optimise** site selection (greedy → ILP warm-start):
   ```python
   from meshplanner.optimize.model import build_coverage_matrix
   from meshplanner.optimize.warmstart import warm_start_min_sites
   matrix, names, n_cells = build_coverage_matrix(rasters)
   result = warm_start_min_sites(matrix, names, target_coverage=0.95)
   print(result["final"])
   ```

---

## CLI Commands

### `meshplanner coverage`

Simulate coverage for a **single transmitter** by downloading a DEM from AWS Open Data (SRTM 30m) and computing an RSSI raster via ITM radial sweep.

```
Usage: meshplanner coverage [OPTIONS]

Options:
  --west FLOAT      West longitude  [required]
  --south FLOAT     South latitude  [required]
  --east FLOAT      East longitude  [required]
  --north FLOAT     North latitude  [required]
  --tx-lat FLOAT    Transmitter latitude  [required]
  --tx-lon FLOAT    Transmitter longitude  [required]
  --output TEXT     Output directory  [default: ./output]
  --band TEXT       Frequency band (e.g. US915, EU868) or MHz  [default: US915]
  --sf INTEGER      Spreading factor 7-12  [default: 10]
  --tx-power FLOAT  Transmitter power (dBm)  [default: 20.0]
  --max-range FLOAT Max range in km  [default: 30.0]
  --threshold FLOAT RSSI threshold (dBm)  [default: -120.0]

Output: GeoTIFFs — RSSI raster (*_rssi.tif) and binary coverage mask (*_mask.tif).
```

**Example:**
```bash
meshplanner coverage \
  --west -82.6 --south 35.5 --east -82.4 --north 35.7 \
  --tx-lat 35.6 --tx-lon -82.5 \
  --band US915 --sf 10 --tx-power 20 \
  --output ./asheville_coverage
```

### `meshplanner batch`

Batch-process coverage rasters for **all candidate sites** in parallel. Useful for producing the per-site rasters needed by the optimiser.

```
Usage: meshplanner batch [OPTIONS]

Options:
  --sites PATH      Candidate sites file (CSV/GeoJSON)  [required]
  --dem PATH        DEM raster file (GeoTIFF)  [required]
  --band TEXT       Frequency band  [default: US915]
  --sf INTEGER      Spreading factor 7-12  [default: 10]
  --tx-power FLOAT  Transmitter power (dBm)  [default: 20]
  --max-range FLOAT Max range in km  [default: 30]
  --num-radials INT Number of radials  [default: 360]
  --workers INT     Parallel workers  [default: 4]
  --no-progress     Disable progress bars

Output: Summary table with per-site elapsed time and coverage percentage.
```

### `meshplanner optimize`

Run **site-selection optimisation** — two modes:

- **`min-sites`**: find the smallest set of sites that covers at least `--target` fraction of the area (set-cover ILP with greedy warm-start).
- **`max-coverage`**: select exactly `--n-sites` sites to maximise coverage (max-coverage ILP with greedy warm-start).

```
Usage: meshplanner optimize [OPTIONS]

Options:
  --sites PATH      Candidate sites file (CSV/GeoJSON)  [required]
  --dem PATH        DEM raster file (GeoTIFF)  [required]
  --band TEXT       Frequency band  [default: US915]
  --sf INTEGER      Spreading factor 7-12  [default: 10]
  --tx-power FLOAT  Transmitter power (dBm)  [default: 20.0]
  --max-range FLOAT Max analysis range (km)  [default: 30]
  --num-radials INT Number of radials per site  [default: 360]
  --mode TEXT       Optimisation mode: min-sites | max-coverage  [default: min-sites]
  --target FLOAT    Coverage target fraction 0-1  [default: 0.95]
  --n-sites INT     Sites to select (max-coverage mode)
  --cell-size INT   Matrix cell downsampling factor  [default: 4]
  --time-limit INT  ILP solver time limit (s)  [default: 120]
  --workers INT     Parallel workers  [default: 4]
  --output TEXT     Output directory  [default: ./output]
  --no-progress     Disable progress bars

Output:
  - optimize_results.json — full solver result (greedy + ILP) with selected sites
  - rasters/ — per-site coverage GeoTIFFs for selected sites
```

**Examples:**

```bash
# Minimum sites for 95% coverage
meshplanner optimize \
  --sites candidate_sites.csv --dem terrain.tif \
  --mode min-sites --target 0.95 --output ./opt_min

# Maximum coverage with 5 sites
meshplanner optimize \
  --sites candidate_sites.csv --dem terrain.tif \
  --mode max-coverage --n-sites 5 --output ./opt_max
```

### `meshplanner export`

Export optimisation results to standard geospatial formats.

```
Usage: meshplanner export [OPTIONS]

Options:
  --input PATH      Results JSON from optimize command  [required]
  --format TEXT     Output format: geojson | csv | raster  [required]
  --output TEXT     Output path (file or directory)  [default: ./output]
  --threshold FLOAT RSSI threshold for raster export (dBm)  [default: -120.0]
```

**Examples:**

```bash
# Export selected sites as GeoJSON
meshplanner export \
  --input ./opt_min/optimize_results.json \
  --format geojson \
  --output ./opt_min/sites.geojson

# Export as CSV
meshplanner export \
  --input ./opt_min/optimize_results.json \
  --format csv \
  --output ./opt_min/sites.csv

# Export combined coverage raster (requires rasters/ from optimize run)
meshplanner export \
  --input ./opt_min/optimize_results.json \
  --format raster \
  --output ./opt_min/combined_coverage.tif
```

### Typical CLI workflows

**Full pipeline — Asheville, NC:**

```bash
# 1. Batch-process all candidate sites
meshplanner batch \
  --sites tests/data/asheville_sites.csv \
  --dem asheville_dem.tif \
  --band US915 --sf 10 --tx-power 20 \
  --workers 8 \
  --output ./pipeline/batch

# 2. Find the minimum sites for 95% coverage
meshplanner optimize \
  --sites tests/data/asheville_sites.csv \
  --dem asheville_dem.tif \
  --mode min-sites --target 0.95 \
  --cell-size 4 --time-limit 120 \
  --output ./pipeline/opt_min

# 3. Export the selected sites and combined raster
meshplanner export \
  --input ./pipeline/opt_min/optimize_results.json \
  --format geojson \
  --output ./pipeline/opt_min/sites.geojson

meshplanner export \
  --input ./pipeline/opt_min/optimize_results.json \
  --format csv \
  --output ./pipeline/opt_min/sites.csv

meshplanner export \
  --input ./pipeline/opt_min/optimize_results.json \
  --format raster \
  --output ./pipeline/opt_min/combined.tif
```

**Max-coverage with fixed budget:**

```bash
meshplanner optimize \
  --sites tests/data/asheville_sites.csv \
  --dem asheville_dem.tif \
  --mode max-coverage --n-sites 5 \
  --cell-size 4 --time-limit 60 \
  --workers 8 \
  --output ./pipeline/opt_max
```

**Custom band (EU 868 MHz):**

```bash
meshplanner coverage \
  --west -2.0 --south 48.0 --east -1.5 --north 48.5 \
  --tx-lat 48.2 --tx-lon -1.8 \
  --band EU868 --sf 12 --tx-power 14 \
  --max-range 15 --threshold -125 \
  --output ./europe_coverage
```

---

## Streamlit Web UI

MeshPlanner includes a browser-based graphical interface built with **Streamlit** and **Folium** for interactive map-based analysis.

**Features:**
- Upload DEM and candidate sites through the sidebar
- Configure LoRa parameters (band, SF, TX power, range, threshold)
- Three modes: single-transmitter coverage, batch processing, and site-selection optimisation
- Interactive results on a Folium map with per-site RSSI overlay
- Side-by-side comparison of greedy vs. ILP solver results
- Export results as CSV right from the browser

### Local deployment

```bash
# Install with web extras
pip install "meshplanner[web]"

# Launch the web UI
streamlit run src/meshplanner/web/app.py
```

Open http://localhost:8501.

### Docker deployment

```bash
# Start the web service (recommended)
docker compose up

# Or build and run manually
docker build -t meshplanner .
docker run --rm -p 8501:8501 meshplanner
```

The web UI is served on port 8501 with a health check endpoint at `/`.

### How it works

The Streamlit app is composed of page modules under `src/meshplanner/web/`:

| Module | Purpose |
|---|---|
| `app.py` | Main entry point, sidebar routing, top-level layout |
| `coverage.py` | Single-transmitter coverage page with Folium map |
| `batch.py` | Batch processing page with per-site status table |
| `optimize.py` | Optimisation page with greedy vs. ILP comparison |
| `upload.py` | DEM and sites file upload widget |
| `params.py` | LoRa parameter form and accessor helpers |
| `state.py` | Session state initialisation and management |
| `map_utils.py` | Folium map rendering helpers |
| `export.py` | Browser-side results export |

All computation runs on the server using the same `meshplanner` Python API that the CLI uses. The web UI is a thin presentation layer — no separate backend service is needed.

---

## JavaScript SPA (Browser-Only)

MeshPlanner includes an offline-first JavaScript SPA in `meshplanner-app/` that runs **entirely in the browser** — no server needed after initial load.

**Features:**
- MapLibre GL JS interactive map (free, no API key)
- DEM fetch from AWS Open Data SRTM tiles (streamed in-browser)
- Coverage computation via ITM radial sweep with Web Workers
- Site management (CSV/GeoJSON import, manual add, click-to-place)
- Greedy optimisation solver (hiGHS WASM for ILP when available)
- Mobile-responsive layout (375px → desktop)
- Offline-capable (Service Worker + IndexedDB DEM cache)

### Run locally

```bash
cd meshplanner-app
npm install
npm run dev        # Development server on localhost:5173
npm run build      # Production build to dist/
npm run preview    # Preview production build
```

### Deploy

```bash
# Static hosting (CloudFlare Pages, S3, Netlify)
npm run build
# Upload dist/ to any static host — no server needed
```

---

## Progress Reporting

Long-running commands (`batch`, `optimize`) report progress via **tqdm** progress bars:

- **Batch processing**: per-site progress bar showing site name and elapsed time.
- **Coverage computation**: per-site tqdm bar with live timing.
- Use `--no-progress` to disable bars in scripts/logs.

---

## Python API

```python
# -- Terrain --
from meshplanner.terrain.fetch import fetch_dem_raster
dem_array, meta = fetch_dem_raster(bbox, resolution="30m")

# -- Propagation --
from meshplanner.propagation.params import LoraParams
from meshplanner.propagation.coverage import compute_coverage_raster

params = LoraParams(frequency_mhz=915.0, spreading_factor=10, tx_power_dbm=20)
rssi, cov_meta = compute_coverage_raster(dem_array, meta, tx_lat, tx_lon, params)

# -- Batch processing --
from meshplanner.batch import process_sites
results = process_sites(dem_array, meta, sites, params, show_progress=True)

# -- Optimisation --
from meshplanner.optimize.model import build_coverage_matrix
from meshplanner.optimize.warmstart import warm_start_min_sites

matrix, names, n_cells = build_coverage_matrix({n: r for n, (r, _) in results.items()})
solution = warm_start_min_sites(matrix, names, target_coverage=0.95)

# -- Export --
from meshplanner.export.raster import export_both
paths = export_both(rssi, cov_meta, "output/coverage_stem")
```

---

## Architecture

```
meshplanner/
├── cli/              # Click CLI (4 commands: coverage, batch, optimize, export)
├── web/              # Streamlit web UI (app.py + 8 page/component modules)
├── terrain/          # DEM fetch (SRTM from AWS Open Data), caching, profiles
├── propagation/      # ITM radial sweep, coverage rasters, LoRa params
├── optimize/         # Greedy + ILP (PuLP) solvers, warm-start heuristics
├── combine/          # Per-cell union / best-RSSI merge
├── export/           # GeoTIFF, GeoJSON, CSV writers
├── sites/            # Candidate site model, CSV/GeoJSON I/O
├── batch.py          # Parallel multi-site processing
└── validate.py       # Cross-validation harness
```

### Optimisation pipeline

```
Sites + DEM
    │
    ▼
Batch coverage rasters (parallel ITM radial sweep)
    │
    ▼
Sparse coverage matrix (site × cell)
    │
    ▼
Greedy heuristic (fast feasible solution)
    │
    ▼
ILP with warm-start (PuLP + CBC) → optimal/suboptimal solution
    │
    ▼
Export: GeoJSON, CSV, GeoTIFF
```

---

## License

MIT — open for humanitarian, community, and commercial use.

---

## Background

For the full project specification, background research, and roadmap, see the [Planning Document](PLANNING.md) (or scroll below for the original README content).

---

*Hurricane Helene (2024) devastated Asheville, NC — mountainous terrain made cellular restoration slow and patchy. LoRa networks, with their long range, low power, and license-free bands, can fill critical gaps when traditional infrastructure fails. MeshPlanner helps disaster-response teams decide where to put gateways.*
