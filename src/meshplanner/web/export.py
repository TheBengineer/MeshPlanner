"""In-memory export handlers for the MeshPlanner Web UI."""

from __future__ import annotations

import csv
import io
import json
from typing import Optional

import numpy as np
import rasterio
import streamlit as st

from meshplanner.web.state import (
    get_dem,
    get_optimization_result,
    get_rasters,
    get_sites,
)


def render_export_section() -> None:
    """Render download buttons for optimisation results.

    Disabled until results are ready.
    """
    results_ready = st.session_state.get("results_ready", False)
    rasters = get_rasters()
    opt_result = get_optimization_result()
    sites = get_sites()

    st.sidebar.markdown("### Export")

    if not results_ready or not opt_result:
        st.sidebar.button("Download GeoJSON", disabled=True)
        st.sidebar.button("Download CSV", disabled=True)
        st.sidebar.button("Download GeoTIFF", disabled=True)
        return

    selected_names = opt_result.get("final", {}).get("selected_sites", [])

    # GeoJSON
    geojson_bytes = _export_sites_geojson(sites, selected_names)
    st.sidebar.download_button(
        label="Download GeoJSON",
        data=geojson_bytes,
        file_name="selected_sites.geojson",
        mime="application/geo+json",
        key="export_geojson",
    )

    # CSV
    csv_bytes = _export_sites_csv(sites, selected_names)
    st.sidebar.download_button(
        label="Download CSV",
        data=csv_bytes,
        file_name="selected_sites.csv",
        mime="text/csv",
        key="export_csv",
    )

    # GeoTIFF (combined coverage)
    if rasters and selected_names:
        # Build combined raster from selected sites
        rssi_list = []
        for name in selected_names:
            if name in rasters:
                rssi_list.append(rasters[name][0])

        if rssi_list:
            from meshplanner.combine.union import combine_coverage

            combined = combine_coverage(rssi_list, method="best")

            tiff_bytes = _export_coverage_geotiff(combined)
            st.sidebar.download_button(
                label="Download GeoTIFF",
                data=tiff_bytes,
                file_name="combined_coverage.tif",
                mime="image/tiff",
                key="export_tiff",
            )


def _export_sites_geojson(sites: list, selected_names: list[str]) -> bytes:
    """Build a GeoJSON FeatureCollection of selected sites.

    Returns:
        UTF-8 encoded GeoJSON bytes.
    """
    name_map = {s.name: s for s in sites}

    features = []
    for name in selected_names:
        site = name_map.get(name)
        if site is None:
            continue
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [site.longitude, site.latitude],
            },
            "properties": {
                "name": site.name,
                "elevation_m": site.elevation_m,
            },
        })

    collection = {
        "type": "FeatureCollection",
        "features": features,
        "properties": {
            "generated_by": "MeshPlanner",
            "n_sites": len(selected_names),
        },
    }

    return json.dumps(collection, indent=2).encode("utf-8")


def _export_sites_csv(sites: list, selected_names: list[str]) -> bytes:
    """Build a CSV of selected sites.

    Returns:
        UTF-8 encoded CSV bytes.
    """
    name_map = {s.name: s for s in sites}

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["name", "latitude", "longitude", "elevation_m"])

    for name in selected_names:
        site = name_map.get(name)
        if site is None:
            continue
        writer.writerow([
            site.name,
            site.latitude,
            site.longitude,
            site.elevation_m or "",
        ])

    return buf.getvalue().encode("utf-8")


def _export_coverage_geotiff(
    rssi_raster: np.ndarray,
    metadata: Optional[dict] = None,
) -> bytes:
    """Write a coverage raster to an in-memory GeoTIFF.

    Args:
        rssi_raster: 2D RSSI array.
        metadata: Optional metadata dict with 'dem_affine' key.
                 Falls back to st.session_state.dem_metadata.

    Returns:
        GeoTIFF as bytes.
    """
    if metadata is None:
        _, metadata = get_dem()

    affine = (metadata or {}).get("dem_affine") or (metadata or {}).get("affine")

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
