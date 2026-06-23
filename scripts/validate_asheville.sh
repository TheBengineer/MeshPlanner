#!/bin/bash
# Generate validation comparison for Asheville, NC test case.
#
# Prerequisites:
#   - MeshPlanner installed (pip install -e .)
#   - Reference coverage GeoTIFF (see scripts/fetch_reference.sh)
#   - Python 3.10+ with rasterio, numpy
#
# Usage:
#   bash scripts/validate_asheville.sh                         # Run full validation
#   bash scripts/validate_asheville.sh --skip-prediction       # Use existing prediction
#   bash scripts/validate_asheville.sh --dry-run               # Show commands only
#
# Steps:
#   1. Generate MeshPlanner coverage prediction for Asheville area
#   2. Load reference coverage from tests/fixtures/
#   3. Compute agreement metrics
#   4. Print validation report

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FIXTURES_DIR="$PROJECT_DIR/tests/fixtures"

DRY_RUN=false
SKIP_PREDICTION=false
PREDICTION_TIF="${FIXTURES_DIR}/asheville_predicted_rssi.tif"
REFERENCE_TIF="${FIXTURES_DIR}/reference_coverage_asheville.tif"
BOUNDS_WEST=-82.6
BOUNDS_SOUTH=35.5
BOUNDS_EAST=-82.4
BOUNDS_NORTH=35.7
TX_LAT=35.60
TX_LON=-82.50
THRESHOLD_DBM=-120.0
SITE_NAME="Asheville-TX01"

print_usage() {
    cat <<EOF
Usage: bash scripts/validate_asheville.sh [OPTION]

Options:
  --help               Show this message
  --dry-run            Show commands without running
  --skip-prediction    Use existing prediction raster (skip Step 1)

Environment variables:
  MESHPLANNER_ARGS     Extra args for coverage computation (e.g., "--num-radials 72")
EOF
}

log() {
    echo "[*] $*"
}

warn() {
    echo "[!] $*" >&2
}

# ── Parse args ────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            print_usage
            exit 0
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --skip-prediction)
            SKIP_PREDICTION=true
            shift
            ;;
        *)
            warn "Unknown option: $1"
            print_usage
            exit 1
            ;;
    esac
done

# ── Step 1: Generate MeshPlanner coverage prediction ─────────────

echo "=== Asheville Coverage Validation ==="
echo "Site: $SITE_NAME (lat=$TX_LAT, lon=$TX_LON)"
echo "Area: $BOUNDS_WEST/$BOUNDS_SOUTH to $BOUNDS_EAST/$BOUNDS_NORTH"
echo "Threshold: ${THRESHOLD_DBM} dBm"
echo ""

if [[ "$SKIP_PREDICTION" == "false" ]]; then
    log "Step 1: Generating MeshPlanner coverage prediction..."

    PREDICTION_CMD="python3 -c \"
from meshplanner.terrain.fetch import fetch_dem_raster
from meshplanner.propagation.coverage import compute_coverage_raster
from meshplanner import propagate

# Fetch DEM for Asheville area
dem, meta = fetch_dem_raster({
    'west': $BOUNDS_WEST,
    'south': $BOUNDS_SOUTH,
    'east': $BOUNDS_EAST,
    'north': $BOUNDS_NORTH,
}, resolution='30m')

# Compute coverage raster
rssi, cov_meta = compute_coverage_raster(
    dem, meta,
    tx_lat=$TX_LAT,
    tx_lon=$TX_LON,
    num_radials=360,
    step_km=0.3,
    max_range_km=30.0,
)

# Write prediction GeoTIFF
import rasterio
from rasterio.transform import from_bounds
profile = dict(
    driver='GTiff', height=rssi.shape[0], width=rssi.shape[1], count=1,
    dtype=rasterio.float32, crs='EPSG:4326',
    transform=from_bounds(
        $BOUNDS_WEST, $BOUNDS_SOUTH,
        $BOUNDS_EAST, $BOUNDS_NORTH,
        rssi.shape[1], rssi.shape[0]
    ),
)
with rasterio.open('$PREDICTION_TIF', 'w', **profile) as dst:
    dst.write(rssi, 1)

print(f'Prediction saved to $PREDICTION_TIF')
print(f'Shape: {rssi.shape}, min={rssi.min():.1f}, max={rssi.max():.1f}')
\""

    if [[ "$DRY_RUN" == "true" ]]; then
        echo "Would run: python3 <<SCRIPT"
        echo "$PREDICTION_CMD"
        echo "SCRIPT"
    else
        log "Running coverage prediction..."
        eval "$PREDICTION_CMD"
        log "Prediction raster saved to $PREDICTION_TIF"
    fi
else
    log "Skipping prediction step (--skip-prediction)"
    if [[ ! -f "$PREDICTION_TIF" ]]; then
        warn "Prediction raster not found at $PREDICTION_TIF"
        warn "Run without --skip-prediction first, or generate manually."
        exit 1
    fi
fi

# ── Step 2: Validate against reference ───────────────────────────

log "Step 2: Validating against reference coverage..."

if [[ ! -f "$REFERENCE_TIF" ]]; then
    warn "Reference coverage not found at $REFERENCE_TIF"
    warn ""
    warn "To generate reference data:"
    warn "  1. Use Radio Mobile Online (browser): https://www.ve2dbe.com/rmonline.html"
    warn "  2. Or install Splat! and run scripts/fetch_reference.sh --download"
    warn "  3. Or place a reference GeoTIFF at $REFERENCE_TIF"
    warn ""
    warn "Falling back to synthetic reference data for testing..."

    if [[ "$DRY_RUN" == "true" ]]; then
        echo "Would generate synthetic reference and run validation"
        exit 0
    fi

    # Generate synthetic reference for testing the validation pipeline
    python3 -c "
import numpy as np
import rasterio
from rasterio.transform import from_bounds

# Create a synthetic reference raster matching the predicted area
np.random.seed(42)
ref_rssi = np.full((200, 200), -130.0, dtype=np.float32)
# Simulate coverage pattern: circle from TX
ny, nx = ref_rssi.shape
cy, cx = 100, 100
Y, X = np.ogrid[:ny, :nx]
dist = np.sqrt((X - cx)**2 + (Y - cy)**2)
ref_rssi[dist < 60] = -80.0   # inner strong
ref_rssi[(dist >= 60) & (dist < 90)] = -110.0  # edge

profile = dict(
    driver='GTiff', height=200, width=200, count=1,
    dtype=rasterio.float32, crs='EPSG:4326',
    transform=from_bounds($BOUNDS_WEST, $BOUNDS_SOUTH, $BOUNDS_EAST, $BOUNDS_NORTH, 200, 200),
)
with rasterio.open('$REFERENCE_TIF', 'w', **profile) as dst:
    dst.write(ref_rssi, 1)
print(f'Synthetic reference saved to $REFERENCE_TIF')
"
fi

# ── Step 3: Compute metrics ──────────────────────────────────────

log "Step 3: Computing agreement metrics..."

VALIDATION_CMD="python3 -c \"
from meshplanner.validate import validate_coverage, generate_validation_report
import rasterio
import json

# Load prediction
with rasterio.open('$PREDICTION_TIF') as src:
    pred_rssi = src.read(1).astype(float)

# Run validation
result = validate_coverage(
    pred_rssi,
    '$REFERENCE_TIF',
    threshold_dbm=$THRESHOLD_DBM,
    site_name='$SITE_NAME',
)

# Generate report
report = generate_validation_report([result])
print(report)

# Also print JSON for programmatic consumption
print()
print('=== JSON Result ===')
print(json.dumps(result, indent=2))
\""

if [[ "$DRY_RUN" == "true" ]]; then
    echo "Would run:"
    echo "$VALIDATION_CMD"
else
    log "Running validation..."
    eval "$VALIDATION_CMD"
fi

# ── Summary ──────────────────────────────────────────────────────

echo ""
echo "=== Validation Complete ==="
if [[ "$DRY_RUN" == "false" ]]; then
    echo "Prediction: $PREDICTION_TIF"
    echo "Reference:  $REFERENCE_TIF"
    echo "Threshold:  ${THRESHOLD_DBM} dBm"
    echo "Pass threshold: Jaccard >= 0.70"
fi
