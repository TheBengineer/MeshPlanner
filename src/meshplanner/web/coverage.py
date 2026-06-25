"""Single-site coverage page for the MeshPlanner Web UI."""

from __future__ import annotations

import csv
import io
import json
import time

import folium
import numpy as np
import rasterio
import streamlit as st
from streamlit_folium import st_folium

from meshplanner.propagation.coverage import (
    compute_coverage_area,
    compute_coverage_at_threshold,
    compute_coverage_raster,
)
from meshplanner.web.map_utils import (
    add_color_legend,
    add_coverage_overlay,
    add_site_pins,
    build_base_map,
)
from meshplanner.web.params import build_params, get_coverage_kwargs, get_threshold
from meshplanner.web.state import get_dem, get_sites


def render_coverage_page() -> None:
    """Render the single-site coverage analysis page."""
    dem_array, dem_metadata = get_dem()
    sites = get_sites()

    if dem_array is None:
        st.info("Upload a DEM GeoTIFF to begin.")
        return

    if not sites:
        st.info("Upload candidate sites to begin.")
        return

    # Site selector
    site_names = [s.name for s in sites]
    selected_name = st.selectbox("Select a transmitter site", options=site_names)
    selected_site = next(s for s in sites if s.name == selected_name)

    params = build_params()
    threshold = get_threshold()
    cov_kwargs = get_coverage_kwargs()

    # ── Compute form ──────────────────────────────────────────────────────
    with st.form("coverage_form", clear_on_submit=False):
        st.caption("Parameters locked in form — submit to compute")
        submitted = st.form_submit_button(
            f"Compute coverage for {selected_name}", type="primary"
        )

    # Check if we already have cached results for this site
    cached_site = st.session_state.get("_last_site")
    if submitted:
        st.session_state.pop("_last_rssi", None)
        st.session_state.pop("_last_meta", None)
        st.session_state.pop("_last_site", None)

    has_results = (
        st.session_state.get("_last_site") == selected_name
        and st.session_state.get("_last_rssi") is not None
    )

    if submitted or has_results:
        if submitted or not has_results:
            with st.spinner(f"Computing coverage for {selected_name}..."):
                start = time.time()

                rssi_raster, cov_metadata = compute_coverage_raster(
                    dem_array=dem_array,
                    dem_metadata=dem_metadata,
                    tx_lat=selected_site.latitude,
                    tx_lon=selected_site.longitude,
                    params=params,
                    **cov_kwargs,
                )
                elapsed = time.time() - start

            cov_metadata["bounds"] = dem_metadata.get("bounds", {})

            # Store in session state
            st.session_state["_last_rssi"] = rssi_raster
            st.session_state["_last_meta"] = cov_metadata
            st.session_state["_last_site"] = selected_name
        else:
            rssi_raster = st.session_state["_last_rssi"]
            cov_metadata = st.session_state["_last_meta"]
            elapsed = cov_metadata.get("elapsed_s", 0)

        # Stats
        mask = compute_coverage_at_threshold(rssi_raster, threshold)
        area_km2 = compute_coverage_area(mask, dem_metadata)
        n_covered = int(np.sum(mask))
        total = mask.size
        coverage_pct = 100.0 * n_covered / total

        col1, col2, col3 = st.columns(3)
        with col1:
            st.metric(
                "Covered cells",
                f"{n_covered:,} / {total:,}",
                f"{coverage_pct:.1f}%",
            )
        with col2:
            st.metric("Estimated area", f"{area_km2:.2f} km²")
        with col3:
            st.metric("Computation time", f"{elapsed:.1f}s")

        # Map with colour legend
        m = build_base_map(selected_site.latitude, selected_site.longitude, 12)
        add_site_pins(m, sites, [selected_name])
        add_coverage_overlay(m, rssi_raster, cov_metadata, threshold)
        add_color_legend(m, threshold)
        folium.LayerControl().add_to(m)

        st_folium(m, height=500, width=None)

        # ── Export section ────────────────────────────────────────────────
        st.markdown("### Export")
        exp_col1, exp_col2, exp_col3 = st.columns(3)

        with exp_col1:
            geojson_bytes = _coverage_to_geojson(
                selected_site, mask, dem_metadata, threshold
            )
            st.download_button(
                label="Download GeoJSON",
                data=geojson_bytes,
                file_name=f"{selected_name}_coverage.geojson",
                mime="application/geo+json",
                key="cov_export_geojson",
            )

        with exp_col2:
            csv_bytes = _coverage_to_csv(
                selected_site, mask, dem_metadata, threshold, n_covered, area_km2
            )
            st.download_button(
                label="Download CSV",
                data=csv_bytes,
                file_name=f"{selected_name}_coverage.csv",
                mime="text/csv",
                key="cov_export_csv",
            )

        with exp_col3:
            tiff_bytes = _coverage_to_geotiff(rssi_raster, dem_metadata)
            st.download_button(
                label="Download GeoTIFF",
                data=tiff_bytes,
                file_name=f"{selected_name}_rssi.tif",
                mime="image/tiff",
                key="cov_export_tiff",
            )

    else:
        # Show default map with pins
        m = build_base_map()
        add_site_pins(m, sites)
        st_folium(m, height=400, width=None)


# ── Export helpers ──────────────────────────────────────────────────────


def _coverage_to_geojson(
    site, mask: np.ndarray, dem_metadata: dict, threshold: float
) -> bytes:
    """Build a GeoJSON footprint of covered cells as a polygon.

    Returns:
        UTF-8 encoded GeoJSON bytes.
    """
    bounds = dem_metadata.get("bounds", {})
    west, south = bounds.get("west", 0), bounds.get("south", 0)
    east, north = bounds.get("east", 0), bounds.get("north", 0)

    # Count covered pixel positions for a simplified point cloud
    # or we can represent as a MultiPoint
    rows, cols = np.where(mask)
    if len(rows) == 0:
        features = []
    else:
        h, w = mask.shape
        lon_step = (east - west) / w
        lat_step = (north - south) / h

        points = []
        # Sample at most 5000 points for GeoJSON size
        step = max(1, len(rows) // 5000)
        for r, c in zip(rows[::step], cols[::step]):
            lon = west + (c + 0.5) * lon_step
            lat = south + (r + 0.5) * lat_step
            points.append([lon, lat])

        features = [
            {
                "type": "Feature",
                "geometry": {"type": "MultiPoint", "coordinates": points},
                "properties": {
                    "site": site.name,
                    "threshold_dbm": threshold,
                    "covered_cells": int(np.sum(mask)),
                },
            }
        ]

    collection = {
        "type": "FeatureCollection",
        "features": features,
        "properties": {
            "generated_by": "MeshPlanner",
            "site": site.name,
        },
    }

    return json.dumps(collection, indent=2).encode("utf-8")


def _coverage_to_csv(
    site, mask: np.ndarray, dem_metadata: dict,
    threshold: float, n_covered: int, area_km2: float,
) -> bytes:
    """Build a CSV summary of coverage statistics.

    Returns:
        UTF-8 encoded CSV bytes.
    """
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["metric", "value"])
    writer.writerow(["site_name", site.name])
    writer.writerow(["site_lat", site.latitude])
    writer.writerow(["site_lon", site.longitude])
    writer.writerow(["threshold_dbm", threshold])
    writer.writerow(["total_cells", mask.size])
    writer.writerow(["covered_cells", n_covered])
    writer.writerow(["coverage_pct", round(100.0 * n_covered / mask.size, 2)])
    writer.writerow(["area_km2", area_km2])
    return buf.getvalue().encode("utf-8")


def _coverage_to_geotiff(rssi_raster: np.ndarray, dem_metadata: dict) -> bytes:
    """Write an RSSI raster to an in-memory GeoTIFF.

    Returns:
        GeoTIFF as bytes.
    """
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
