#!/bin/bash
# Generate/download reference coverage data for MeshPlanner validation.
#
# This script provides instructions and helper commands for obtaining
# reference coverage data from Radio Mobile Online or Splat!.
#
# Prerequisites:
#   - Radio Mobile Online (browser-based, no install needed)
#   - OR: Splat! installed (Linux) from https://github.com/qsnake/splat
#   - OR: SRTM DEM tiles for the target area
#
# Usage:
#   bash scripts/fetch_reference.sh --help      # Show this message
#   bash scripts/fetch_reference.sh --download   # Attempt Splat! path
#
# NOTE: Radio Mobile / Splat! are NOT installed in this development
# environment. This script documents the manual steps needed to produce
# reference data for real validation runs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FIXTURES_DIR="$PROJECT_DIR/tests/fixtures"

print_usage() {
    cat <<'EOF'
Usage: bash scripts/fetch_reference.sh [OPTION]

Options:
  --help         Show this message
  --download     Attempt to generate reference data with Splat!
  --instructions Print detailed instructions (default)
EOF
}

print_instructions() {
    cat <<'EOF'

=== How to Obtain Reference Coverage Data ===

You need a reference coverage GeoTIFF to validate MeshPlanner predictions
against. Two options:

──────────────────────────────────────────────────────────────────────
OPTION A: Radio Mobile Online (easiest, no install)
──────────────────────────────────────────────────────────────────────

1. Open https://www.ve2dbe.com/rmonline.html in a browser
2. Set up a link with these parameters:
   - Frequency: 915.0 MHz
   - TX power: 20 dBm
   - Antenna heights: 10m TX, 1.5m RX
   - Polarization: Vertical
3. Set location: Asheville, NC area (lat 35.6, lon -82.5)
4. Run coverage prediction at maximum resolution
5. Export as GeoTIFF
6. Save to: tests/fixtures/reference_coverage_asheville.tif

──────────────────────────────────────────────────────────────────────
OPTION B: Splat! (Linux, open source)
──────────────────────────────────────────────────────────────────────

1. Install Splat!:
   git clone https://github.com/qsnake/splat.git
   cd splat && make && sudo make install

2. Download SRTM DEM data for the area (e.g., via
   https://dds.cr.usgs.gov/srtm/version2_1/SRTM3/North_America/)

3. Create a transmitter file tx_site.qth:
   $ cat > tx_site.qth << 'TXEOF'
   MeshPlanner Test TX
   35.600
   -82.500
   10.0
   915.0
   20.0
   0.0
   0
   TXEOF

4. Run Splat!:
   splat -t tx_site.qth \\
        -o asheville_reference \\
        -d /path/to/srtm/ \\
        -L 5.0 \\
        -f 915.0 \\
        -er 1.5 \\
        -h 10.0 \\
        -R 30 \\
        -ngs

5. Convert output to GeoTIFF (Splat! produces SIGLOSS format;
   use gdal_translate or the sdr2cit conversion tools):
   gdal_translate asheville_reference.sdf tests/fixtures/reference_coverage_asheville.tif

──────────────────────────────────────────────────────────────────────
OPTION C: Synthetic test data (for CI / automated testing)
──────────────────────────────────────────────────────────────────────

Run the tests directly -- they create synthetic GeoTIFF files in a
temporary directory using rasterio. No real reference data needed.

  pytest tests/test_validation.py -v

EOF
}

attempt_download() {
    echo "=== Attempting reference data generation ==="
    echo ""
    echo "Splat! and Radio Mobile are not installed in this environment."
    echo "To generate reference data, follow the instructions above:"
    echo ""
    echo "  bash scripts/fetch_reference.sh --instructions"
    echo ""
    echo "For automated testing, synthetic data is used instead:"
    echo ""
    echo "  pytest tests/test_validation.py -v"
    echo ""
    exit 0
}

# ── Main ──────────────────────────────────────────────────────────

case "${1:---instructions}" in
    --help|-h)
        print_usage
        ;;
    --download)
        attempt_download
        ;;
    --instructions|*)
        print_instructions
        ;;
esac
