"""File upload and validation handlers for the MeshPlanner Web UI."""

from __future__ import annotations

import numpy as np
import rasterio
import streamlit as st

from meshplanner.sites.candidate import read_sites_csv, read_sites_geojson
from meshplanner.web.state import set_dem, set_sites


def render_upload_section():
    """Render the file upload area in the sidebar.

    Provides two file uploaders:
    1. DEM GeoTIFF (required for all modes)
    2. Candidate sites CSV/GeoJSON (required for optimize and batch modes)

    Parsed data is stored in session state via state setters.
    """
    st.sidebar.markdown("### Data Upload")

    # ── DEM upload ────────────────────────────────────────────────────
    dem_file = st.sidebar.file_uploader(
        "DEM GeoTIFF (EPSG:4326)",
        type=["tif", "tiff"],
        help="SRTM or other DEM in GeoTIFF format, EPSG:4326 CRS.",
    )

    if dem_file is not None and not st.session_state.get("dem_loaded", False):
        _handle_dem_upload(dem_file)
    elif dem_file is None:
        # User cleared the upload
        if st.session_state.get("dem_loaded", False):
            from meshplanner.web.state import reset_dem

            reset_dem()
            st.rerun()

    # Show DEM status
    if st.session_state.get("dem_loaded", False):
        dem_array = st.session_state.dem_array
        st.sidebar.success(
            f"DEM: {dem_array.shape[0]}×{dem_array.shape[1]} cells"
        )

    # ── Sites upload ──────────────────────────────────────────────────
    sites_file = st.sidebar.file_uploader(
        "Candidate sites (CSV/GeoJSON)",
        type=["csv", "geojson", "json"],
        help="CSV with columns: name,lat,lon or GeoJSON FeatureCollection.",
    )

    if sites_file is not None and not st.session_state.get("sites_loaded", False):
        _handle_sites_upload(sites_file)
    elif sites_file is None:
        if st.session_state.get("sites_loaded", False):
            st.session_state.sites_loaded = False
            st.session_state.sites = []
            st.rerun()

    if st.session_state.get("sites_loaded", False):
        n = len(st.session_state.sites)
        st.sidebar.success(f"Sites: {n} loaded")


def _handle_dem_upload(uploaded_file) -> None:
    """Parse an uploaded DEM GeoTIFF and store in session state.

    Validates:
    - File can be opened by rasterio
    - CRS is EPSG:4326 (or reprojectable)
    - Array is 2D (single band)

    On success: calls ``set_dem(array, metadata)``.
    On failure: shows ``st.error`` and returns.
    """
    try:
        with rasterio.MemoryFile(uploaded_file.read()) as memfile:
            with memfile.open() as src:
                # Validate CRS
                crs = src.crs
                if crs is None:
                    st.error(
                        "DEM GeoTIFF has no CRS. "
                        "Please provide an EPSG:4326 file."
                    )
                    return

                # Read first band
                if src.count < 1:
                    st.error("DEM GeoTIFF has no bands.")
                    return

                array = src.read(1).astype(np.float32)
                metadata = {
                    "affine": src.transform,
                    "crs": crs.to_string(),
                    "bounds": {
                        "west": src.bounds.left,
                        "south": src.bounds.bottom,
                        "east": src.bounds.right,
                        "north": src.bounds.top,
                    },
                    "resolution": abs(src.res[0]),
                }

        set_dem(array, metadata)
        st.rerun()

    except Exception as exc:
        st.error(f"Failed to read DEM: {exc}")


def _handle_sites_upload(uploaded_file) -> None:
    """Parse an uploaded sites file and store in session state.

    Supports CSV (``name,lat,lon``) and GeoJSON (FeatureCollection of Points).

    On success: calls ``set_sites(sites)``.
    On failure: shows ``st.error`` and returns.
    """
    try:
        content = uploaded_file.read().decode("utf-8")

        name = uploaded_file.name.lower()
        if name.endswith(".csv"):
            import os
            import tempfile

            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".csv", delete=False
            ) as f:
                f.write(content)
                tmp_path = f.name
            try:
                sites = read_sites_csv(tmp_path)
            finally:
                os.unlink(tmp_path)
        elif name.endswith((".geojson", ".json")):
            import os
            import tempfile

            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".geojson", delete=False
            ) as f:
                f.write(content)
                tmp_path = f.name
            try:
                sites = read_sites_geojson(tmp_path)
            finally:
                os.unlink(tmp_path)
        else:
            st.error(f"Unsupported file type: {uploaded_file.name}")
            return

        if not sites:
            st.warning("No candidate sites found in the uploaded file.")
            return

        set_sites(sites)
        st.rerun()

    except Exception as exc:
        st.error(f"Failed to read sites: {exc}")
