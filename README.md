# LoRa Network Site Planner for Disaster Recovery

**MeshPlanner** is a Python CLI tool for planning LoRa mesh network deployments in disaster-affected areas. Given a terrain model and candidate gateway locations, it:

- Simulates RF coverage for each site using ITM/Longley-Rice propagation
- Runs **site-selection optimisation** (minimum sites for X% coverage, or maximum coverage with N sites) via greedy heuristic + ILP with warm-start
- Exports results as GeoTIFF rasters, GeoJSON, and CSV

The canonical test case is **Asheville, NC** after Hurricane Helene (September 2024) — mountainous terrain where rapid LoRa deployment can fill critical communications gaps.

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

- Python ≥ 3.10
- `numpy`, `scipy` — numerical + sparse matrix operations
- `rasterio` — GeoTIFF I/O
- `click` — CLI framework
- `tqdm` — progress bars
- `pulp` — ILP solver (CBC bundled)
- `requests` — DEM tile download

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
├── cli/              # Click CLI (app.py)
├── terrain/          # DEM fetch (SRTM from AWS Open Data), caching, profiles
├── propagation/      # ITM radial sweep, coverage rasters, LoRa params
├── optimize/         # Greedy + ILP (PuLP) solvers, warm-start heuristics
├── combine/          # Per-cell union/intersection/redundancy
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
