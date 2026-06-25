"""MeshPlanner Web UI — Streamlit entry point."""
from __future__ import annotations

import streamlit as st

from meshplanner.web.batch import render_batch_page
from meshplanner.web.coverage import render_coverage_page
from meshplanner.web.export import render_export_section
from meshplanner.web.optimize import render_optimize_page
from meshplanner.web.params import render_params_form
from meshplanner.web.state import init_all, reset_results
from meshplanner.web.upload import render_upload_section

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
st.sidebar.caption("LoRa Network Site Planner for Disaster Recovery")

# Mode selector
mode = st.sidebar.radio(
    "Mode",
    options=["coverage", "optimize", "batch"],
    index=["coverage", "optimize", "batch"].index(
        getattr(st.session_state, "page", "coverage")
    ),
    key="page",
    help=(
        "coverage: single-transmitter | "
        "optimize: site selection | "
        "batch: bulk coverage"
    ),
)

st.sidebar.markdown("---")

# Upload section
render_upload_section()

st.sidebar.markdown("---")

# Parameter form
params_submitted = render_params_form()

# Reset results when parameters change
if params_submitted:
    reset_results()

st.sidebar.markdown("---")

# Export section (shared, shown in sidebar)
render_export_section()

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

# Route to the correct page module
if mode == "coverage":
    render_coverage_page()
elif mode == "optimize":
    render_optimize_page()
elif mode == "batch":
    render_batch_page()

# ── Footer ────────────────────────────────────────────────────────────────────

st.divider()
st.caption(f"MeshPlanner v0.1.0 | Streamlit {st.__version__}")
