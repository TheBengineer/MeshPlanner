"""Command-line interface for MeshPlanner."""
from __future__ import annotations

import json
import time
from pathlib import Path

import click
import numpy as np

from meshplanner.batch import process_sites
from meshplanner.export.raster import export_both, export_geotiff
from meshplanner.optimize.model import build_coverage_matrix
from meshplanner.optimize.warmstart import (
    warm_start_max_coverage,
    warm_start_min_sites,
)
from meshplanner.propagation.coverage import (
    compute_coverage_area,
    compute_coverage_at_threshold,
    compute_coverage_raster,
)
from meshplanner.propagation.params import LoraParams
from meshplanner.sites.candidate import (
    CandidateSite,
    read_sites_csv,
    read_sites_geojson,
)
from meshplanner.terrain.fetch import fetch_dem_raster

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
    import rasterio

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


def _make_params(band: str, sf: int, tx_power: float) -> LoraParams:
    """Create LoraParams from band name/frequency string, SF, and TX power."""
    try:
        freq = float(band)
    except ValueError:
        freq = LoraParams.from_band(band).frequency_mhz
    return LoraParams(
        frequency_mhz=freq,
        spreading_factor=sf,
        tx_power_dbm=tx_power,
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.group()
def cli():
    """LoRa Network Site Planner for Disaster Recovery.

    Simulate radio-frequency coverage, batch-process candidate sites, and
    run site-selection optimisation (greedy + ILP with warm-start).
    """
    pass


# -----------------------------------------------------------------------
# coverage
# -----------------------------------------------------------------------


@cli.command()
@click.option("--west", type=float, required=True, help="West longitude of bounding box")
@click.option("--south", type=float, required=True, help="South latitude of bounding box")
@click.option("--east", type=float, required=True, help="East longitude of bounding box")
@click.option("--north", type=float, required=True, help="North latitude of bounding box")
@click.option("--tx-lat", type=float, required=True, help="Transmitter latitude")
@click.option("--tx-lon", type=float, required=True, help="Transmitter longitude")
@click.option("--output", default="./output", help="Output directory for rasters")
@click.option("--band", default="US915", help="Frequency band (e.g. US915, EU868) or MHz")
@click.option("--sf", default=10, type=int, help="Spreading factor 7-12")
@click.option("--tx-power", default=20.0, type=float, help="Transmitter power (dBm)")
@click.option("--max-range", default=30.0, type=float, help="Max range in km")
@click.option("--threshold", default=-120.0, type=float, help="RSSI threshold (dBm)")
def coverage(
    west: float,
    south: float,
    east: float,
    north: float,
    tx_lat: float,
    tx_lon: float,
    output: str,
    band: str,
    sf: int,
    tx_power: float,
    max_range: float,
    threshold: float,
):
    """Simulate coverage for a single transmitter.

    Downloads a DEM for the bounding box from AWS Open Data (SRTM 30m),
    computes an RSSI raster via ITM radial sweep, and exports both the
    RSSI raster and a binary coverage mask as GeoTIFFs.
    """
    bbox: dict[str, float] = {
        "west": west,
        "south": south,
        "east": east,
        "north": north,
    }

    # -- Fetch DEM -----------------------------------------------------------
    click.echo(f"Fetching DEM for bbox: {west},{south},{east},{north} …")
    dem_array, dem_metadata = fetch_dem_raster(bbox, resolution="30m")
    click.echo(f"  DEM shape: {dem_array.shape[0]}×{dem_array.shape[1]}")

    # -- Compute coverage ----------------------------------------------------
    params = _make_params(band, sf, tx_power)
    click.echo(
        f"Computing coverage for TX ({tx_lat:.5f}, {tx_lon:.5f}) "
        f"— {params.frequency_mhz} MHz, SF{params.spreading_factor}, "
        f"{params.tx_power_dbm} dBm …"
    )

    start = time.time()
    rssi_raster, coverage_metadata = compute_coverage_raster(
        dem_array=dem_array,
        dem_metadata=dem_metadata,
        tx_lat=tx_lat,
        tx_lon=tx_lon,
        params=params,
        max_range_km=max_range,
    )
    elapsed = time.time() - start

    # -- Export rasters ------------------------------------------------------
    out_dir = Path(output)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = str(out_dir / "coverage")
    paths = export_both(rssi_raster, coverage_metadata, stem, threshold=threshold)

    # -- Summary stats -------------------------------------------------------
    mask = compute_coverage_at_threshold(rssi_raster, threshold_dbm=threshold)
    area_km2 = compute_coverage_area(mask, dem_metadata)
    n_covered = int(np.sum(mask))
    total = mask.size
    pct = 100.0 * n_covered / total if total else 0.0

    click.echo("")
    click.echo("Coverage summary:")
    click.echo(f"  Computation time:  {elapsed:.1f}s")
    click.echo(f"  Covered pixels:    {n_covered} / {total} ({pct:.1f}%)")
    click.echo(f"  Estimated area:    {area_km2:.2f} km²")
    click.echo(f"  RSSI threshold:    {threshold:.0f} dBm")
    click.echo("")
    click.echo("Outputs:")
    click.echo(f"  RSSI raster:  {paths['rssi_path']}")
    click.echo(f"  Mask raster:  {paths['mask_path']}")


# -----------------------------------------------------------------------
# optimize
# -----------------------------------------------------------------------


@cli.command()
@click.option("--sites", type=click.Path(exists=True), required=True, help="Candidate sites file (CSV/GeoJSON)")
@click.option("--dem", type=click.Path(exists=True), required=True, help="DEM raster file (GeoTIFF, EPSG:4326)")
@click.option("--band", default="US915", help="Frequency band (e.g. US915, EU868) or MHz")
@click.option("--sf", default=10, type=int, help="Spreading factor 7-12")
@click.option("--tx-power", default=20.0, type=float, help="Transmitter power (dBm)")
@click.option("--max-range", default=30.0, type=float, help="Max analysis range in km")
@click.option("--num-radials", default=360, type=int, help="Number of radials for each site")
@click.option("--mode", type=click.Choice(["min-sites", "max-coverage"]), default="min-sites",
              help="Optimisation mode")
@click.option("--target", type=float, default=0.95,
              help="Coverage target fraction (0-1) for min-sites mode")
@click.option("--n-sites", type=int, default=None,
              help="Number of sites to select for max-coverage mode")
@click.option("--cell-size", type=int, default=4,
              help="Downsample factor for coverage-matrix cells (1 = full resolution)")
@click.option("--time-limit", type=int, default=120,
              help="ILP solver time limit in seconds")
@click.option("--workers", default=4, type=int,
              help="Parallel workers for site processing")
@click.option("--output", default="./output", help="Output directory")
@click.option("--no-progress", is_flag=True, help="Disable progress bars")
def optimize(
    sites: str,
    dem: str,
    band: str,
    sf: int,
    tx_power: float,
    max_range: float,
    num_radials: int,
    mode: str,
    target: float,
    n_sites: int | None,
    cell_size: int,
    time_limit: int,
    workers: int,
    output: str,
    no_progress: bool,
):
    """Run site selection optimization (greedy → ILP with warm-start).

    Loads candidate sites and a DEM, computes per-site coverage rasters in
    parallel, builds a sparse coverage matrix, and runs the chosen solver.
    The ``min-sites`` mode finds the smallest set of sites that covers at
    least *target* fraction of the area; ``max-coverage`` mode selects
    exactly *n-sites* to maximise coverage.

    Results are saved as JSON and per-site coverage GeoTIFFs are written
    to an output directory.
    """
    out = Path(output)
    out.mkdir(parents=True, exist_ok=True)

    # -- Load inputs ---------------------------------------------------------
    click.echo(f"Loading sites from: {sites}")
    site_list = _load_sites(sites)
    click.echo(f"  Found {len(site_list)} candidate site(s)")

    click.echo(f"Loading DEM from: {dem}")
    dem_array, dem_metadata = _load_dem(dem)
    click.echo(f"  DEM shape: {dem_array.shape}")

    params = _make_params(band, sf, tx_power)

    # -- Batch-process coverage for all sites --------------------------------
    click.echo(f"\nComputing coverage for {len(site_list)} sites in parallel …")
    batch_start = time.time()
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
    click.echo(f"  Batch complete in {time.time() - batch_start:.1f}s "
               f"({len(results)}/{len(site_list)} sites succeeded)")

    if not results:
        click.echo("ERROR: No sites produced valid coverage rasters. Exiting.")
        return

    # -- Build coverage matrix -----------------------------------------------
    click.echo("Building coverage matrix …")
    rasters: dict[str, np.ndarray] = {
        name: rssi for name, (rssi, _) in results.items()
    }
    coverage_matrix, site_names, n_cells = build_coverage_matrix(
        rasters, threshold_dbm=-120.0, cell_size_px=cell_size,
    )
    click.echo(f"  Matrix: {len(site_names)} sites × {n_cells} cells")

    # -- Build site info lookup ----------------------------------------------
    site_info: dict[str, dict] = {
        site.name: {
            "latitude": site.latitude,
            "longitude": site.longitude,
            "elevation_m": site.elevation_m,
            "notes": site.notes,
        }
        for site in site_list
        if site.name in results
    }

    # -- Run solver ----------------------------------------------------------
    click.echo(f"Running {mode} solver …")

    if mode == "min-sites":
        solver_result = warm_start_min_sites(
            coverage_matrix,
            site_names,
            target_coverage=target,
            time_limit_seconds=time_limit,
        )
    else:
        n = n_sites if n_sites is not None else min(10, len(site_names))
        solver_result = warm_start_max_coverage(
            coverage_matrix,
            site_names,
            n_sites=n,
            time_limit_seconds=time_limit,
        )

    final = solver_result["final"]
    selected = final["selected_sites"]
    click.echo(f"  Selected {len(selected)} site(s), "
               f"coverage = {final['covered_fraction']:.4f}")

    # -- Build selected_sites_with_coords ------------------------------------
    selected_with_coords: list[dict] = [
        {
            "name": name,
            "latitude": site_info[name]["latitude"],
            "longitude": site_info[name]["longitude"],
            "elevation_m": site_info[name]["elevation_m"],
            "notes": site_info[name]["notes"],
        }
        for name in selected
        if name in site_info
    ]

    # -- Save results JSON ---------------------------------------------------
    output_data: dict = {
        "mode": mode,
        "parameters": {
            "band": band,
            "sf": sf,
            "tx_power_dbm": tx_power,
            "max_range_km": max_range,
            "num_radials": num_radials,
            "mode": mode,
            "target_coverage": target,
            "n_sites": n_sites,
            "cell_size_px": cell_size,
        },
        "dem_metadata": {
            "shape": list(dem_array.shape),
            "bounds": dem_metadata.get("bounds", {}),
            "resolution": dem_metadata.get("resolution", ""),
        },
        "n_candidates_processed": len(results),
        "n_cells": n_cells,
        "result": solver_result,
        "selected_sites_with_coords": selected_with_coords,
    }

    json_path = out / "optimize_results.json"
    with open(str(json_path), "w", encoding="utf-8") as fh:
        json.dump(output_data, fh, indent=2, default=str)
    click.echo(f"  Results saved:  {json_path}")

    # -- Export per-site rasters for selected sites --------------------------
    rasters_dir = out / "rasters"
    rasters_dir.mkdir(parents=True, exist_ok=True)
    n_exported = 0
    for name in selected:
        if name in results:
            rssi, meta = results[name]
            export_geotiff(rssi, meta, str(rasters_dir / f"{name}_rssi.tif"))
            n_exported += 1
    click.echo(f"  Site rasters:    {rasters_dir}/ ({n_exported} files)")

    # -- Print site table ----------------------------------------------------
    click.echo("")
    click.echo(f"Selected sites ({len(selected)}):")
    click.echo(f"  {'Name':<30s} {'Latitude':>12s} {'Longitude':>12s}")
    click.echo(f"  {'-'*30} {'-'*12} {'-'*12}")
    for name in selected:
        info = site_info.get(name, {})
        lat = info.get("latitude", 0.0)
        lon = info.get("longitude", 0.0)
        click.echo(f"  {name:<30s} {lat:>12.5f} {lon:>12.5f}")


# -----------------------------------------------------------------------
# batch
# -----------------------------------------------------------------------


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

    params = _make_params(band, sf, tx_power)

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


# -----------------------------------------------------------------------
# export
# -----------------------------------------------------------------------


@cli.command()
@click.option("--input", type=click.Path(exists=True), required=True,
              help="Results JSON from optimize command")
@click.option("--format", type=click.Choice(["geojson", "csv", "raster"]), required=True,
              help="Output format")
@click.option("--output", default="./output",
              help="Output directory or file path")
@click.option("--threshold", default=-120.0, type=float,
              help="RSSI threshold (dBm) for raster export")
def export(
    input: str,
    format: str,
    output: str,
    threshold: float,
):
    """Export optimisation results to various formats.

    Reads a results JSON file produced by ``meshplanner optimize`` and
    exports the selected sites as:

    \b
    \b
    \b
    \b
    \b
    * ``geojson`` — GeoJSON FeatureCollection of selected site locations.
    * ``csv``     — CSV table of selected sites with coordinates.
    * ``raster``  — Combined coverage GeoTIFF (requires ``rasters/``
                    directory next to the input JSON).
    """
    from meshplanner.export.csv import export_csv
    from meshplanner.export.geojson import export_geojson

    out_path = Path(output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    click.echo(f"Loading results from: {input}")
    with open(input, encoding="utf-8") as fh:
        data: dict = json.load(fh)

    selected: list[dict] = data.get("selected_sites_with_coords", [])
    coverage_info: dict = data.get("result", {}).get("final", {})

    if not selected:
        click.echo("No selected sites found in results file.")
        return

    click.echo(f"  {len(selected)} selected site(s) found")

    # ── Dispatch ─────────────────────────────────────────────────────────
    if format == "geojson":
        dest = export_geojson(selected, coverage_info, str(out_path))
        click.echo(f"  GeoJSON → {dest}")

    elif format == "csv":
        dest = export_csv(selected, coverage_info, str(out_path))
        click.echo(f"  CSV     → {dest}")

    elif format == "raster":
        import rasterio

        from meshplanner.combine.union import combine_coverage

        rasters_dir = Path(input).parent / "rasters"
        if not rasters_dir.is_dir():
            click.echo(
                "ERROR: No 'rasters/' directory found next to the input JSON. "
                "Run 'meshplanner optimize' first to produce per-site rasters."
            )
            return

        rssi_rasters: list[np.ndarray] = []
        affine = None
        for site in selected:
            name = site["name"]
            raster_path = rasters_dir / f"{name}_rssi.tif"
            if raster_path.is_file():
                with rasterio.open(str(raster_path)) as src:
                    rssi_rasters.append(src.read(1).astype(np.float32))
                    if affine is None:
                        affine = src.transform

        if not rssi_rasters:
            click.echo("ERROR: No per-site rasters found in rasters/ directory.")
            return

        combined = combine_coverage(rssi_rasters, method="best")
        combined_meta: dict = {
            "dem_affine": affine,
            "crs": "EPSG:4326",
            "type": "combined_rssi",
            "units": "dBm",
            "n_sites": len(rssi_rasters),
        }

        # If output is a directory, name the file
        dest_path = str(out_path)
        if out_path.suffix == "" or not out_path.suffix:
            dest_path = str(out_path / "combined_coverage.tif")

        dest = export_geotiff(combined, combined_meta, dest_path)
        click.echo(f"  Raster  → {dest}")


# -----------------------------------------------------------------------
# Main entry point
# -----------------------------------------------------------------------

if __name__ == "__main__":
    cli()
