"""Command-line interface for MeshPlanner."""
from __future__ import annotations

import time
from pathlib import Path

import click
import numpy as np
import rasterio

from meshplanner.batch import process_sites
from meshplanner.propagation.params import LoraParams
from meshplanner.sites.candidate import (
    CandidateSite,
    read_sites_csv,
    read_sites_geojson,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_sites(path: str) -> list[CandidateSite]:
    """Load candidate sites from a CSV or GeoJSON file."""
    p = Path(path)
    if p.suffix.lower() in (".csv",):
        return read_sites_csv(str(p))
    if p.suffix.lower() in (".geojson", ".json"):
        return read_sites_geojson(str(p))
    raise click.BadParameter(
        f"Unrecognised file extension '{p.suffix}'. Use .csv or .geojson.",
        param_hint="--sites",
    )


def _load_dem(path: str) -> tuple[np.ndarray, dict]:
    """Load DEM array and metadata from a GeoTIFF file.

    Returns:
        Tuple of (elevation_array, metadata_dict).
        Metadata includes ``affine`` (rasterio Affine) and ``crs``.
    """
    with rasterio.open(path) as src:
        array = src.read(1).astype(np.float32)
        metadata = {
            "affine": src.transform,
            "crs": src.crs.to_string() if src.crs else "EPSG:4326",
            "bounds": {
                "west": src.bounds.left,
                "south": src.bounds.bottom,
                "east": src.bounds.right,
                "north": src.bounds.top,
            },
            "resolution": abs(src.res[0]),
        }
    return array, metadata


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.group()
def cli():
    """LoRa Network Site Planner for Disaster Recovery."""
    pass


@cli.command()
@click.option("--west", type=float, required=True, help="West longitude of bounding box")
@click.option("--south", type=float, required=True, help="South latitude of bounding box")
@click.option("--east", type=float, required=True, help="East longitude of bounding box")
@click.option("--north", type=float, required=True, help="North latitude of bounding box")
def coverage(west, south, east, north):
    """Simulate coverage for a bounding box area."""
    click.echo(f"Coverage simulation for bbox: {west},{south},{east},{north}")


@cli.command()
@click.option("--sites", type=click.Path(exists=True), required=True, help="Candidate sites file (CSV/GeoJSON)")
@click.option("--target", type=float, default=0.95, help="Coverage target fraction (default: 0.95)")
def optimize(sites, target):
    """Run site selection optimization."""
    click.echo(f"Optimizing {sites} for {target*100:.0f}% coverage target")


@cli.command()
@click.option("--sites", type=click.Path(exists=True), required=True,
              help="Candidate sites file (CSV/GeoJSON)")
@click.option("--dem", type=click.Path(exists=True), required=True,
              help="DEM raster file (GeoTIFF, EPSG:4326)")
@click.option("--band", default="US915",
              help="LoRa frequency band (default: US915)")
@click.option("--sf", default=10, type=int,
              help="Spreading factor 7-12 (default: 10)")
@click.option("--tx-power", default=20.0, type=float,
              help="Transmitter power in dBm (default: 20)")
@click.option("--max-range", default=30.0, type=float,
              help="Maximum analysis range in km (default: 30)")
@click.option("--num-radials", default=360, type=int,
              help="Number of radials (default: 360 for 1° spacing)")
@click.option("--workers", default=4, type=int,
              help="Parallel workers for site processing (default: 4)")
@click.option("--no-progress", is_flag=True,
              help="Disable progress bars")
def batch(sites, dem, band, sf, tx_power, max_range, num_radials, workers, no_progress):
    """Batch-process coverage rasters for all candidate sites.

    Loads a set of candidate sites and a DEM, then computes an RSSI coverage
    raster for every site in parallel.  Failed sites are skipped with a
    warning; surviving sites are printed with their elapsed time.
    """
    # ── Load inputs ────────────────────────────────────────────────────
    click.echo(f"Loading sites from: {sites}")
    site_list = _load_sites(sites)
    click.echo(f"  Found {len(site_list)} candidate site(s)")

    click.echo(f"Loading DEM from: {dem}")
    dem_array, dem_metadata = _load_dem(dem)
    click.echo(
        f"  DEM shape: {dem_array.shape}, "
        f"resolution: {dem_metadata['resolution']:.2f}°"
    )

    params = LoraParams(
        frequency_mhz=float(band) if band.replace(".", "", 1).isdigit()
        else LoraParams.from_band(band).frequency_mhz,
        spreading_factor=sf,
        tx_power_dbm=tx_power,
    )

    # ── Run batch processing ───────────────────────────────────────────
    click.echo("")
    start = time.time()

    results = process_sites(
        dem_array=dem_array,
        dem_metadata=dem_metadata,
        sites=site_list,
        params=params,
        max_range_km=max_range,
        num_radials=num_radials,
        step_km=0.1,
        num_workers=workers,
        show_progress=not no_progress,
    )

    elapsed = time.time() - start

    # ── Summary ────────────────────────────────────────────────────────
    click.echo("")
    click.echo("=" * 50)
    if results:
        click.echo(f"Processed {len(results)}/{len(site_list)} sites "
                   f"successfully ({elapsed:.1f}s total)")
        for name, (rssi, meta) in sorted(results.items()):
            n_valid = int(np.sum(np.isfinite(rssi)))
            coverage_pct = 100.0 * n_valid / rssi.size if rssi.size else 0.0
            click.echo(
                f"  {name:<30s}"
                f"  {meta.get('elapsed_s', 0):>6.1f}s"
                f"  {coverage_pct:>5.1f}% valid pixels"
            )
    else:
        click.echo("All sites failed — no coverage rasters produced.")
    click.echo("=" * 50)
