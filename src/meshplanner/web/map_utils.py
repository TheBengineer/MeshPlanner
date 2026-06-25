"""Folium map builders for the MeshPlanner Web UI."""

from __future__ import annotations

from typing import Optional

import folium
import numpy as np
from folium.plugins import MarkerCluster
from matplotlib import cm


def build_base_map(
    center_lat: float = 35.595,
    center_lon: float = -82.555,
    zoom_start: int = 11,
) -> folium.Map:
    """Create a base Folium map with OSM tile layer.

    Args:
        center_lat, center_lon: Map center in degrees.
        zoom_start: Initial zoom level.

    Returns:
        Folium Map object.
    """
    return folium.Map(
        location=[center_lat, center_lon],
        zoom_start=zoom_start,
        tiles="OpenStreetMap",
        attr="MeshPlanner",
    )


def add_site_pins(
    m: folium.Map,
    sites: list,
    selected_names: Optional[list[str]] = None,
) -> None:
    """Add candidate site markers to the map.

    Args:
        m: Folium Map to add markers to.
        sites: List of objects with ``.name``, ``.latitude``, ``.longitude``.
        selected_names: List of site names to highlight (if None, all are default).
    """
    cluster = MarkerCluster(name="Candidate Sites").add_to(m)

    selected_set = set(selected_names or [])

    for site in sites:
        is_selected = site.name in selected_set
        color = "red" if is_selected else "blue"
        icon = folium.Icon(color=color, icon="wifi" if is_selected else "tower", prefix="fa")

        popup_text = f"<b>{site.name}</b><br>Lat: {site.latitude:.5f}<br>Lon: {site.longitude:.5f}"
        if site.elevation_m:
            popup_text += f"<br>Elev: {site.elevation_m:.0f} m"

        folium.Marker(
            location=[site.latitude, site.longitude],
            popup=popup_text,
            icon=icon,
        ).add_to(cluster)


def _rssi_to_rgba(rssi_raster: np.ndarray, threshold: float = -120.0) -> np.ndarray:
    """Convert RSSI raster to RGBA image array for folium overlay.

    Uses RdYlGn_r colormap (red = weak signal, green = strong).
    Cells with RSSI == -inf or below threshold are transparent.

    Returns:
        (H, W, 4) uint8 RGBA array.
    """
    valid = np.isfinite(rssi_raster) & (rssi_raster >= threshold)

    if not valid.any():
        # Fully transparent
        h, w = rssi_raster.shape
        return np.zeros((h, w, 4), dtype=np.uint8)

    # Normalize valid values to [0, 1]
    vmin, vmax = threshold, max(-50.0, float(np.max(rssi_raster)))
    normalized = np.clip((rssi_raster - vmin) / (vmax - vmin), 0, 1)

    # Apply colormap (RdYlGn_r: red=weak, yellow=mid, green=strong)
    colormap = cm.get_cmap("RdYlGn_r")
    rgba = colormap(normalized)  # (H, W, 4) float32

    # Set alpha: transparent for invalid cells
    rgba[~valid, 3] = 0.0

    return (rgba * 255).astype(np.uint8)


def add_coverage_overlay(
    m: folium.Map,
    rssi_raster: np.ndarray,
    metadata: dict,
    threshold: float = -120.0,
    name: str = "RSSI Coverage",
) -> None:
    """Add an RSSI coverage heatmap overlay to the map.

    The overlay is positioned using the DEM's affine transform.

    Args:
        m: Folium Map.
        rssi_raster: RSSI values in dBm.
        metadata: Coverage metadata dict with ``dem_affine`` or ``affine`` key.
        threshold: Minimum RSSI to display (default -120 dBm).
        name: Layer name for the Folium layer control.
    """
    affine = metadata.get("dem_affine") or metadata.get("affine")
    if affine is None:
        return

    bounds = metadata.get("bounds", {})
    if not bounds:
        return

    rgba = _rssi_to_rgba(rssi_raster, threshold)

    # Image bounds: [[south, west], [north, east]]
    img_bounds = [
        [bounds["south"], bounds["west"]],
        [bounds["north"], bounds["east"]],
    ]

    folium.raster_layers.ImageOverlay(
        image=rgba,
        bounds=img_bounds,
        opacity=0.6,
        name=name,
        overlay=True,
        interactive=True,
        cross_origin=False,
        zindex=10,
    ).add_to(m)


# ── Colour legend ──────────────────────────────────────────────────────────

_RDPI_COLORS = [
    "#d73027",  # -120 dBm (weak)
    "#fc8d59",
    "#fee08b",
    "#d9ef8b",
    "#91cf60",
    "#1a9850",  #  -50 dBm (strong)
]
_RDPI_LABELS = [
    "−120 dBm",
    "−100 dBm",
    "−80 dBm",
    "−60 dBm",
    "−50 dBm",
    "",
]


def add_color_legend(m: folium.Map, threshold: float = -120) -> None:
    """Add a discrete colour-bar legend to the map as an HTML overlay.

    The legend uses 6 coloured steps spanning the RdYlGn_r scheme
    from *threshold* up to -50 dBm.  The element is positioned in the
    bottom-right corner.

    Args:
        m: Folium Map to attach the legend to.
        threshold: Minimum RSSI value (dBm) shown on the scale.
    """
    from branca.element import MacroElement
    from branca.element import Template

    legend_html = f"""
    {{% macro html(this, kwargs) %}}
    <div id="rssi-legend" style="
        position: fixed; bottom: 30px; right: 30px; z-index: 9999;
        background: white; padding: 8px 10px; border-radius: 6px;
        box-shadow: 0 1px 5px rgba(0,0,0,.3); font-size: 12px;
        font-family: 'Helvetica Neue', Arial, sans-serif;
    ">
        <div style="font-weight: 600; margin-bottom: 4px;">RSSI (dBm)</div>
        <div style="display: flex; align-items: center; gap: 2px;">
    """
    for i, (color, label) in enumerate(zip(_RDPI_COLORS, _RDPI_LABELS)):
        legend_html += f'<div style="width: 30px; height: 14px; background: {color};"></div>'
    legend_html += "</div><div style=\"display: flex; justify-content: space-between; font-size: 10px; margin-top: 1px;\">"
    legend_html += f'<span>{int(threshold)}</span><span>-50</span>'
    legend_html += "</div></div>{% endmacro %}"

    legend = MacroElement()
    legend._template = Template(legend_html)
    m.get_root().add_child(legend)


def results_to_map(
    sites: list,
    selected_sites: list[str],
    rssi_raster: np.ndarray,
    metadata: dict,
    threshold: float = -120.0,
) -> folium.Map:
    """Build a complete results map with site pins + coverage overlay.

    Args:
        sites: All candidate sites.
        selected_sites: Names of selected (optimized) sites.
        rssi_raster: Combined RSSI raster.
        metadata: Coverage metadata.
        threshold: RSSI threshold.

    Returns:
        Folium Map with all layers.
    """
    # Compute center from sites or metadata
    if sites:
        center_lat = sum(s.latitude for s in sites) / len(sites)
        center_lon = sum(s.longitude for s in sites) / len(sites)
    else:
        bounds = metadata.get("bounds", {})
        center_lat = (bounds.get("north", 35.6) + bounds.get("south", 35.5)) / 2
        center_lon = (bounds.get("east", -82.4) + bounds.get("west", -82.6)) / 2

    m = build_base_map(center_lat, center_lon, zoom_start=11)

    add_site_pins(m, sites, selected_sites)
    add_coverage_overlay(m, rssi_raster, metadata, threshold)

    folium.LayerControl().add_to(m)

    return m
