"""Session state management for the MeshPlanner web UI.

Provides typed getters and setters for all state keys used across the
application, ensuring each key is initialised before use.

State keys
----------
dem_loaded : bool          True after a DEM GeoTIFF is successfully parsed.
dem_array : np.ndarray    2-D elevation array from fetch_dem().
dem_metadata : dict       DEM metadata (affine, crs, bounds, resolution).

sites_loaded : bool       True after candidate sites are successfully parsed.
sites : list[CandidateSite]  Parsed candidate sites.

params : LoraParams       Current LoRa parameter configuration.
mode : str                "min-sites" | "max-coverage" | "single-site"

results_ready : bool      True after an optimisation / coverage run completes.
rasters : dict            {site_name: (rssi_raster, metadata)} from process_sites().
optimization_result : dict  Result from warm_start_min_sites/_max_coverage.

page : str                "coverage" | "optimize" | "batch"
"""

from __future__ import annotations

from typing import Optional
import streamlit as st
import numpy as np

from meshplanner.propagation.params import LoraParams
from meshplanner.sites.candidate import CandidateSite


# ── Default values ────────────────────────────────────────────────────────────

_DEFAULT_PARAMS = LoraParams()


def _init_key(key: str, default):
    """Initialise *key* in session state if it does not already exist."""
    if key not in st.session_state:
        st.session_state[key] = default


def init_all():
    """Initialise all known state keys to their defaults.

    Call once at the top of ``app.py`` to guarantee every key exists.
    """
    _init_key("dem_loaded", False)
    _init_key("dem_array", None)
    _init_key("dem_metadata", None)
    _init_key("sites_loaded", False)
    _init_key("sites", [])
    _init_key("params", _DEFAULT_PARAMS)
    _init_key("mode", "single-site")
    _init_key("results_ready", False)
    _init_key("rasters", {})
    _init_key("optimization_result", None)
    _init_key("page", "coverage")


def reset_dem():
    """Clear DEM data (e.g. after user uploads a new file)."""
    st.session_state.dem_loaded = False
    st.session_state.dem_array = None
    st.session_state.dem_metadata = None


def reset_results():
    """Clear computation results (e.g. after parameter change)."""
    st.session_state.results_ready = False
    st.session_state.rasters = {}
    st.session_state.optimization_result = None


def reset_all():
    """Reset everything to defaults."""
    for key in list(st.session_state.keys()):
        del st.session_state[key]
    init_all()


# ── Typed getters ─────────────────────────────────────────────────────────────


def get_dem() -> tuple[Optional[np.ndarray], Optional[dict]]:
    """Return ``(dem_array, dem_metadata)`` or ``(None, None)``."""
    return st.session_state.dem_array, st.session_state.dem_metadata


def get_sites() -> list[CandidateSite]:
    """Return the list of parsed candidate sites."""
    return st.session_state.sites


def get_params() -> LoraParams:
    """Return the current LoRa parameters."""
    return st.session_state.params


def get_mode() -> str:
    """Return the current mode string."""
    return st.session_state.mode


def get_rasters() -> dict:
    """Return the per-site coverage rasters dict."""
    return st.session_state.rasters


def get_optimization_result() -> Optional[dict]:
    """Return the last optimisation result or ``None``."""
    return st.session_state.optimization_result


# ── Typed setters ─────────────────────────────────────────────────────────────


def set_dem(array: np.ndarray, metadata: dict):
    st.session_state.dem_array = array
    st.session_state.dem_metadata = metadata
    st.session_state.dem_loaded = True


def set_sites(sites: list[CandidateSite]):
    st.session_state.sites = sites
    st.session_state.sites_loaded = True


def set_params(params: LoraParams):
    st.session_state.params = params


def set_mode(mode: str):
    st.session_state.mode = mode


def set_rasters(rasters: dict):
    st.session_state.rasters = rasters


def set_optimization_result(result: dict):
    st.session_state.optimization_result = result
    st.session_state.results_ready = True
