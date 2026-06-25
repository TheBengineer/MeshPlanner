"""Optimisation page for the MeshPlanner Web UI.

Runs batch coverage → builds coverage matrix → warm-start ILP solver →
displays results + combined folium map + export buttons.
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
from meshplanner.combine.union import combine_coverage
from meshplanner.optimize.model import build_coverage_matrix
from meshplanner.optimize.warmstart import (
    warm_start_max_coverage,
    warm_start_min_sites,
)
from meshplanner.web.map_utils import (
    add_color_legend,
    add_coverage_overlay,
    add_site_pins,
    build_base_map,
)
from meshplanner.web.params import (
    build_params,
    get_cell_size,
    get_coverage_kwargs,
    get_mode,
    get_n_sites,
    get_target,
    get_threshold,
)
from meshplanner.web.state import (
    get_dem,
    get_optimization_result,
    get_rasters,
    get_sites,
    set_optimization_result,
    set_rasters,
)


def render_optimize_page() -> None:
    """Render the site-selection optimisation page."""
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
    mode = get_mode()
    cell_size = get_cell_size()
    target = get_target()
    n_sites_val = get_n_sites()

    st.write(f"**{len(sites)} candidate sites** &middot; SF{params.spreading_factor} &middot; {params.frequency_mhz} MHz")

    # ── Optimise form ────────────────────────────────────────────────────
    with st.form("optimize_form", clear_on_submit=False):
        st.caption("Parameters are locked until the form is submitted")
        submitted = st.form_submit_button("Run optimisation", type="primary")

    if submitted:
        st.session_state.pop("_opt_rasters", None)
        st.session_state.pop("_opt_result", None)

    has_opt = st.session_state.get("_opt_result") is not None

    if submitted or has_opt:
        if submitted:
            _run_optimisation(
                dem_array, dem_metadata, sites, params, threshold,
                cov_kwargs, mode, cell_size, target, n_sites_val,
            )

        result = st.session_state.get("_opt_result")
        rasters = st.session_state.get("_opt_rasters", {})

        if result is None:
            st.error("Optimisation returned no result.")
            return

        _display_optimize_results(result, rasters, dem_metadata, threshold, sites)
        _display_export_section(result, rasters, dem_metadata, threshold)
    else:
        st.info("Configure parameters above and click **Run optimisation**.")


# ── Core computation ──────────────────────────────────────────────────────


def _run_optimisation(
    dem_array, dem_metadata, sites, params, threshold,
    cov_kwargs, mode, cell_size, target, n_sites_val,
) -> None:
    """Run the full optimisation pipeline and store results in session state."""
    st.info("**Phase 1/3:** Computing per-site coverage rasters (batch) …")
    batch_bar = st.progress(0, text="Processing sites …")

    try:
        start = time.time()
        rasters = process_sites(
            dem_array=dem_array,
            dem_metadata=dem_metadata,
            sites=sites,
            params=params,
            show_progress=False,
            **cov_kwargs,
        )
        batch_elapsed = time.time() - start
        batch_bar.progress(100, text=f"Done — {len(rasters)}/{len(sites)} sites in {batch_elapsed:.1f}s")
    except Exception as exc:
        st.error(f"Batch coverage failed: {exc}")
        return

    if not rasters:
        st.error("All sites failed during coverage computation.")
        return

    st.info("**Phase 2/3:** Building coverage matrix …")
    try:
        matrix, site_names, n_cells = build_coverage_matrix(
            rasters, threshold_dbm=threshold, cell_size_px=cell_size,
        )
        st.info(f"Matrix: {len(site_names)} sites × {n_cells} cells")
    except Exception as exc:
        st.error(f"Coverage matrix failed: {exc}")
        return

    st.info("**Phase 3/3:** Running warm-start ILP solver …")
    try:
        if mode == "min-sites":
            result = warm_start_min_sites(
                matrix, site_names, target_coverage=target, time_limit_seconds=120,
            )
        else:
            result = warm_start_max_coverage(
                matrix, site_names, n_sites=n_sites_val, time_limit_seconds=120,
            )
    except Exception as exc:
        st.error(f"Optimisation solver failed: {exc}")
        return

    # Store in session state
    st.session_state["_opt_rasters"] = rasters
    st.session_state["_opt_result"] = result


# ── Results display ────────────────────────────────────────────────────────


def _display_optimize_results(
    result: dict, rasters: dict, dem_metadata: dict,
    threshold: float, sites: list,
) -> None:
    """Render the optimisation results: metrics, table, and map."""
    final = result.get("final", {})
    improvement = result.get("improvement", {})
    greedy_info = result.get("greedy", {})
    used_fallback = result.get("used_fallback", False)

    selected_sites: list = final.get("selected_sites", [])
    covered_fraction: float = final.get("covered_fraction", 0.0)

    # ── Metrics row ────────────────────────────────────────────────────
    col1, col2, col3, col4 = st.columns(4)

    with col1:
        st.metric("Selected sites", len(selected_sites))
    with col2:
        st.metric("Coverage fraction", f"{covered_fraction:.1%}")
    with col3:
        solve_time = final.get("solve_time_s", 0)
        st.metric("Solver time", f"{solve_time:.1f}s")
    with col4:
        if used_fallback:
            st.metric("Source", "⚠️ Greedy fallback")
        else:
            st.metric("Source", "ILP (warm-start)")

    if improvement:
        gain = improvement.get("covered_fraction_gain", 0)
        savings = improvement.get("n_sites_savings", 0)
        same = improvement.get("same_solution", False)
        if not same:
            st.caption(
                f"ILP improved coverage by **{gain:.1%}** "
                f"over greedy and saved **{savings}** site(s)."
            )
        else:
            st.caption("ILP and greedy converged on the same solution.")

    # ── Selected sites table ───────────────────────────────────────────
    st.markdown("### Selected Sites")
    if selected_sites:
        site_map = {s.name: s for s in sites}
        rows = []
        for i, name in enumerate(selected_sites, 1):
            site = site_map.get(name)
            lat = site.latitude if site else ""
            lon = site.longitude if site else ""
            elev = site.elevation_m if site and site.elevation_m else ""
            rows.append({"#": i, "Site": name, "Latitude": lat, "Longitude": lon, "Elevation (m)": elev})

        df = pd.DataFrame(rows)
        st.dataframe(df, use_container_width=True, hide_index=True)
    else:
        st.warning("No sites were selected.")

    # ── Combined coverage map ──────────────────────────────────────────
    st.markdown("### Combined Coverage Map")

    try:
        # Build combined raster from selected sites
        rssi_list = []
        for name in selected_sites:
            if name in rasters:
                rssi_list.append(rasters[name][0])

        if rssi_list:
            combined = combine_coverage(rssi_list, method="best")

            # Centre map on the mean of selected sites
            coords = []
            for name in selected_sites:
                s = site_map.get(name)
                if s:
                    coords.append((s.latitude, s.longitude))

            if coords:
                center_lat = sum(c[0] for c in coords) / len(coords)
                center_lon = sum(c[1] for c in coords) / len(coords)
            else:
                bounds = dem_metadata.get("bounds", {})
                center_lat = (bounds.get("north", 35.6) + bounds.get("south", 35.5)) / 2
                center_lon = (bounds.get("east", -82.4) + bounds.get("west", -82.6)) / 2

            # Enrich metadata with DEM bounds
            cov_meta = {"bounds": dem_metadata.get("bounds", {})}

            m = build_base_map(center_lat, center_lon, zoom_start=11)
            add_site_pins(m, sites, selected_sites)
            add_coverage_overlay(m, combined, cov_meta, threshold)
            add_color_legend(m, threshold)
            folium.LayerControl().add_to(m)
            st_folium(m, height=500, width=None)
        else:
            st.warning("No coverage rasters available for the selected sites.")
    except Exception as exc:
        st.error(f"Failed to render combined map: {exc}")


# ── Export section ─────────────────────────────────────────────────────────


def _display_export_section(
    result: dict, rasters: dict, dem_metadata: dict, threshold: float,
) -> None:
    """Render download buttons for optimisation results."""
    final = result.get("final", {})
    selected_sites: list = final.get("selected_sites", [])

    if not selected_sites:
        return

    st.markdown("### Export")

    exp_col1, exp_col2, exp_col3 = st.columns(3)

    # GeoJSON
    with exp_col1:
        geojson_bytes = _opt_export_geojson(selected_sites)
        st.download_button(
            label="Download GeoJSON",
            data=geojson_bytes,
            file_name="optimized_sites.geojson",
            mime="application/geo+json",
            key="opt_export_geojson",
        )

    # CSV
    with exp_col2:
        csv_bytes = _opt_export_csv(selected_sites, final)
        st.download_button(
            label="Download CSV",
            data=csv_bytes,
            file_name="optimized_sites.csv",
            mime="text/csv",
            key="opt_export_csv",
        )

    # GeoTIFF combined coverage
    with exp_col3:
        rssi_list = [rasters[n][0] for n in selected_sites if n in rasters]
        if rssi_list:
            combined = combine_coverage(rssi_list, method="best")
            tiff_bytes = _opt_export_geotiff(combined, dem_metadata)
            st.download_button(
                label="Download GeoTIFF",
                data=tiff_bytes,
                file_name="combined_coverage.tif",
                mime="image/tiff",
                key="opt_export_tiff",
            )


def _opt_export_geojson(selected_sites: list[str]) -> bytes:
    """Build a GeoJSON FeatureCollection of selected sites.

    Returns:
        UTF-8 encoded GeoJSON bytes.
    """
    sites = get_sites()
    name_map = {s.name: s for s in sites}
    features = []
    for name in selected_sites:
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
            "n_sites": len(selected_sites),
        },
    }
    return json.dumps(collection, indent=2).encode("utf-8")


def _opt_export_csv(selected_sites: list[str], final: dict) -> bytes:
    """Build a CSV summary including optimisation metadata.

    Returns:
        UTF-8 encoded CSV bytes.
    """
    sites = get_sites()
    name_map = {s.name: s for s in sites}

    buf = io.StringIO()
    writer = csv.writer(buf)

    # Header rows
    writer.writerow(["# MeshPlanner optimisation results"])
    writer.writerow(["covered_fraction", final.get("covered_fraction", 0)])
    writer.writerow(["source", final.get("source", "")])
    writer.writerow([])
    writer.writerow(["name", "latitude", "longitude", "elevation_m"])

    for name in selected_sites:
        site = name_map.get(name)
        if site is None:
            continue
        writer.writerow([site.name, site.latitude, site.longitude, site.elevation_m or ""])

    return buf.getvalue().encode("utf-8")


def _opt_export_geotiff(rssi_raster: np.ndarray, dem_metadata: dict) -> bytes:
    """Write a combined RSSI raster to an in-memory GeoTIFF.

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
