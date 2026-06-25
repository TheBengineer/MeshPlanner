"""MeshPlanner Web UI — Streamlit entry point."""
from __future__ import annotations

import streamlit as st

from meshplanner.web.state import init_all, get_dem, get_sites, get_params

# ── Page config (must be the first Streamlit call) ────────────────────────────

st.set_page_config(
    page_title="MeshPlanner",
    page_icon="📡",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Initialise session state ─────────────────────────────────────────────────

init_all()

# ── Sidebar ───────────────────────────────────────────────────────────────────

st.sidebar.title("MeshPlanner")
st.sidebar.caption(
    "LoRa Network Site Planner for Disaster Recovery"
)

# Mode selector
mode = st.sidebar.radio(
    "Mode",
    options=["coverage", "optimize", "batch"],
    index=["coverage", "optimize", "batch"].index(getattr(st.session_state, "page", "coverage")),
    key="page",
    help="coverage: single-transmitter | optimize: site selection | batch: bulk coverage",
)

st.sidebar.markdown("---")

# Status indicators
dem_ok = st.session_state.get("dem_loaded", False)
sites_ok = st.session_state.get("sites_loaded", False)
results_ok = st.session_state.get("results_ready", False)

st.sidebar.markdown("**Status**")
st.sidebar.write(f"{'✅' if dem_ok else '⬜'} DEM loaded")
st.sidebar.write(f"{'✅' if sites_ok else '⬜'} Sites loaded")
st.sidebar.write(f"{'✅' if results_ok else '⬜'} Results ready")

st.sidebar.markdown("---")

# Help / about
with st.sidebar.expander("About MeshPlanner"):
    st.markdown(
        """
        **MeshPlanner** helps disaster-response teams plan LoRa mesh
        network deployments. Uses ITM/Longley-Rice propagation and
        PuLP CBC optimisation to recommend gateway placements.

        Canonical test case: **Asheville, NC** after Hurricane Helene.
        """
    )

# ── Main content area ─────────────────────────────────────────────────────────

st.title("📡 MeshPlanner")
st.markdown("_LoRa Network Site Planner for Disaster Recovery_")

if mode == "coverage":
    st.header("Single-Site Coverage")
    st.info("Upload a DEM and candidate sites in the sidebar to begin.")

    dem_array, dem_metadata = get_dem()
    if dem_array is not None:
        st.success(f"DEM loaded: {dem_array.shape[0]}×{dem_array.shape[1]} cells")

    sites = get_sites()
    if sites:
        st.success(f"{len(sites)} candidate site(s) loaded")

elif mode == "optimize":
    st.header("Site Selection Optimisation")
    st.info("Upload a DEM and candidate sites, then configure optimisation parameters.")

    dem_array, dem_metadata = get_dem()
    sites = get_sites()

    if dem_array is not None and sites:
        params = get_params()
        st.write(f"**Ready to optimise** — {len(sites)} sites, SF{params.spreading_factor}, {params.frequency_mhz} MHz")

elif mode == "batch":
    st.header("Batch Coverage")
    st.info("Compute coverage rasters for all candidate sites in parallel.")

    dem_array, dem_metadata = get_dem()
    sites = get_sites()

    if dem_array is not None and sites:
        st.write(f"**Ready** — {len(sites)} sites to process")

# ── Footer ────────────────────────────────────────────────────────────────────

st.divider()
st.caption(f"MeshPlanner v0.1.0 | Streamlit {st.__version__}")
