"""Batch coverage page for the MeshPlanner Web UI.

Computes coverage rasters for all candidate sites in parallel and
displays a summary table with per-site elapsed time + export options.
"""

from __future__ import annotations

import csv
import io
import json
import time

import folium
import numpy as np
import pandas as pd
import rasterio
import streamlit as st
from streamlit_folium import st_folium

from meshplanner.batch import process_sites
from meshplanner.combine.union import combine_coverage, compute_redundancy
from meshplanner.propagation.coverage import compute_coverage_at_threshold
from meshplanner.web.map_utils import add_color_legend, add_coverage_overlay, add_site_pins, build_base_map
from meshplanner.web.params import build_params, get_coverage_kwargs, get_threshold
from meshplanner.web.state import get_dem, get_sites


def render_batch_page() -> None:
    """Render the batch coverage analysis page."""
    dem_array, dem_metadata = get_dem()
    sites = get_sites()

    if dem_array is None:
        st.info("Upload a DEM GeoTIFF to begin.")
        return

    if not sites:
        st.info("Upload candidate sites to begin.")
        return

    params = build_params()
    threshold = get_threshold()
    cov_kwargs = get_coverage_kwargs()

    st.write(f"**{len(sites)} sites** to process &middot; SF{params.spreading_factor} &middot; {params.frequency_mhz} MHz")

    # ── Batch form ─────────────────────────────────────────────────────────
    with st.form("batch_form", clear_on_submit=False):
        st.caption("Parameters are locked until the form is submitted")
        submitted = st.form_submit_button("Run batch coverage", type="primary")

    if submitted:
        st.session_state.pop("_batch_rasters", None)
        st.session_state.pop("_batch_times", None)
        st.session_state.pop("_batch_elapsed", None)

    has_batch = st.session_state.get("_batch_rasters") is not None

    if submitted or has_batch:
        if submitted:
            _run_batch(dem_array, dem_metadata, sites, params, cov_kwargs)

        rasters = st.session_state.get("_batch_rasters", {})
        site_times = st.session_state.get("_batch_times", {})
        total_elapsed = st.session_state.get("_batch_elapsed", 0)

        if not rasters:
            st.error("All sites failed during coverage computation.")
            return

        _display_batch_results(rasters, site_times, total_elapsed, dem_metadata, threshold, sites)
        _display_batch_map(rasters, site_times, dem_metadata, threshold, sites)
        _display_batch_export(rasters, site_times, dem_metadata, threshold)
    else:
        st.info("Configure parameters above and click **Run batch coverage**.")


def _run_batch(dem_array, dem_metadata, sites, params, cov_kwargs) -> None:
    """Run batch processing with a Streamlit progress bar."""
    n = len(sites)
    progress_bar = st.progress(0, text="Initialising …")

    try:
        start_total = time.time()

        # We'll call process_sites with show_progress=False and manually
        # report progress since process_sites only supports tqdm.
        # For accurate per-site progress, we process sequentially here.
        # In practise the ThreadPoolExecutor handles parallelism inside
        # process_sites; we just show a simple progress text.
        rasters = process_sites(
            dem_array=dem_array,
            dem_metadata=dem_metadata,
            sites=sites,
            params=params,
            show_progress=False,
            **cov_kwargs,
        )

        total_elapsed = time.time() - start_total
        progress_bar.progress(100, text=f"Done — {len(rasters)}/{n} sites in {total_elapsed:.1f}s")

        # Extract per-site times from metadata
        site_times = {}
        for name, (_rssi, meta) in rasters.items():
            site_times[name] = meta.get("elapsed_s", 0)

        st.session_state["_batch_rasters"] = rasters
        st.session_state["_batch_times"] = site_times
        st.session_state["_batch_elapsed"] = total_elapsed

    except Exception as exc:
        st.error(f"Batch processing failed: {exc}")


def _display_batch_results(
    rasters: dict, site_times: dict, total_elapsed: float,
    dem_metadata: dict, threshold: float, sites: list,
) -> None:
    """Show a results table with per-site metrics."""
    st.markdown("### Per-Site Results")

    # Compute coverage stats per site
    rows = []
    for i, (name, (rssi, meta)) in enumerate(sorted(rasters.items()), 1):
        mask = compute_coverage_at_threshold(rssi, threshold)
        n_covered = int(np.sum(mask))
        total = mask.size
        coverage_pct = round(100.0 * n_covered / total, 2)
        elapsed_s = meta.get("elapsed_s", 0)

        rows.append({
            "#": i,
            "Site": name,
            "Covered cells": f"{n_covered:,} / {total:,}",
            "Coverage %": coverage_pct,
            "Time (s)": round(elapsed_s, 1),
        })

    df = pd.DataFrame(rows)
    st.dataframe(df, use_container_width=True, hide_index=True)

    # Summary metrics
    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("Sites processed", f"{len(rasters)} / {len(sites)}")
    with col2:
        # Combined coverage across all sites
        rssi_list = [r[0] for r in rasters.values()]
        if rssi_list:
            combined = combine_coverage(rssi_list, method="best")
            combined_mask = compute_coverage_at_threshold(combined, threshold)
            combined_pct = 100.0 * np.sum(combined_mask) / combined_mask.size
            st.metric("Combined coverage", f"{combined_pct:.1f}%")
    with col3:
        st.metric("Total time", f"{total_elapsed:.1f}s")


def _display_batch_map(
    rasters: dict, site_times: dict,
    dem_metadata: dict, threshold: float, sites: list,
) -> None:
    """Show a combined coverage heatmap for all sites."""
    st.markdown("### Combined Coverage Map")

    try:
        rssi_list = [r[0] for r in rasters.values()]
        if not rssi_list:
            return

        combined = combine_coverage(rssi_list, method="best")

        # Centre on mean of all sites
        if sites:
            center_lat = sum(s.latitude for s in sites) / len(sites)
            center_lon = sum(s.longitude for s in sites) / len(sites)
        else:
            bounds = dem_metadata.get("bounds", {})
            center_lat = (bounds.get("north", 35.6) + bounds.get("south", 35.5)) / 2
            center_lon = (bounds.get("east", -82.4) + bounds.get("west", -82.6)) / 2

        cov_meta = {"bounds": dem_metadata.get("bounds", {})}

        m = build_base_map(center_lat, center_lon, zoom_start=11)
        add_site_pins(m, sites)
        add_coverage_overlay(m, combined, cov_meta, threshold)
        add_color_legend(m, threshold)
        folium.LayerControl().add_to(m)
        st_folium(m, height=500, width=None)

    except Exception as exc:
        st.error(f"Failed to render combined map: {exc}")


def _display_batch_export(
    rasters: dict, site_times: dict, dem_metadata: dict, threshold: float,
) -> None:
    """Render download buttons for batch results."""
    if not rasters:
        return

    st.markdown("### Export")

    # Combined GeoTIFF
    rssi_list = [r[0] for r in rasters.values()]
    combined = combine_coverage(rssi_list, method="best") if rssi_list else None

    exp_col1, exp_col2, exp_col3 = st.columns(3)

    with exp_col1:
        if combined is not None:
            tiff_bytes = _batch_export_geotiff(combined, dem_metadata)
            st.download_button(
                label="Download GeoTIFF (combined)",
                data=tiff_bytes,
                file_name="batch_combined_coverage.tif",
                mime="image/tiff",
                key="batch_export_tiff",
            )

    with exp_col2:
        csv_bytes = _batch_export_csv(rasters, threshold)
        st.download_button(
            label="Download CSV (summary)",
            data=csv_bytes,
            file_name="batch_results.csv",
            mime="text/csv",
            key="batch_export_csv",
        )

    with exp_col3:
        if combined is not None:
            mask = compute_coverage_at_threshold(combined, threshold)
            geojson_bytes = _batch_export_geojson(
                rasters, combined, mask, dem_metadata, threshold,
            )
            st.download_button(
                label="Download GeoJSON",
                data=geojson_bytes,
                file_name="batch_coverage.geojson",
                mime="application/geo+json",
                key="batch_export_geojson",
            )


def _batch_export_geotiff(rssi_raster: np.ndarray, dem_metadata: dict) -> bytes:
    """Write a combined RSSI raster to an in-memory GeoTIFF."""
    affine = dem_metadata.get("affine")
    profile = {
        "driver": "GTiff",
        "height": rssi_raster.shape[0],
        "width": rssi_raster.shape[1],
        "count": 1,
        "dtype": rasterio.float32,
        "crs": "EPSG:4326",
        "transform": affine,
        "compress": "deflate",
    }

    buf = io.BytesIO()
    with rasterio.open(buf, "w", **profile) as dst:
        dst.write(rssi_raster.astype(np.float32), 1)
    return buf.getvalue()


def _batch_export_csv(rasters: dict, threshold: float) -> bytes:
    """Build a CSV summary of per-site batch results."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["site", "elapsed_s", "covered_cells", "total_cells", "coverage_pct"])

    for name, (rssi, meta) in sorted(rasters.items()):
        mask = compute_coverage_at_threshold(rssi, threshold)
        n_covered = int(np.sum(mask))
        total = mask.size
        coverage_pct = round(100.0 * n_covered / total, 2)
        elapsed_s = round(meta.get("elapsed_s", 0), 2)
        writer.writerow([name, elapsed_s, n_covered, total, coverage_pct])

    return buf.getvalue().encode("utf-8")


def _batch_export_geojson(
    rasters: dict, combined: np.ndarray, mask: np.ndarray,
    dem_metadata: dict, threshold: float,
) -> bytes:
    """Build a GeoJSON MultiPoint of covered cells."""
    bounds = dem_metadata.get("bounds", {})
    west, south = bounds.get("west", 0), bounds.get("south", 0)
    east, north = bounds.get("east", 0), bounds.get("north", 0)

    rows, cols = np.where(mask)
    h, w = mask.shape
    lon_step = (east - west) / w
    lat_step = (north - south) / h

    # Sample at most 5000 points
    points = []
    step = max(1, len(rows) // 5000)
    for r, c in zip(rows[::step], cols[::step]):
        lon = west + (c + 0.5) * lon_step
        lat = south + (r + 0.5) * lat_step
        points.append([lon, lat])

    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "MultiPoint", "coordinates": points},
                "properties": {
                    "n_sites": len(rasters),
                    "threshold_dbm": threshold,
                    "covered_cells": int(np.sum(mask)),
                },
            }
        ],
        "properties": {"generated_by": "MeshPlanner", "mode": "batch"},
    }

    return json.dumps(collection, indent=2).encode("utf-8")
