"""LoRa parameter form for the MeshPlanner Web UI.

Renders a Streamlit form in the sidebar for configuring all LoRa
propagation and optimisation parameters.  Each widget uses an explicit
``key="param_*"`` so that caller code can retrieve values directly from
``st.session_state`` after form submission.

Typical usage in a page module::

    from meshplanner.web.params import render_params_form

    if render_params_form():
        # Form was submitted — re-run computation with new parameters.
        params = build_params()
        threshold = get_threshold()
        ...
"""

from __future__ import annotations

import streamlit as st

from meshplanner.propagation.params import BAND_CENTERS, LoraParams

# ── Form rendering ────────────────────────────────────────────────────────────


def render_params_form() -> bool:
    """Render the LoRa parameter configuration form in the sidebar.

    Returns:
        ``True`` if the form was submitted (user clicked "Apply"),
        ``False`` otherwise.  Callers should check the return value
        to trigger recomputation.
    """
    with st.sidebar.expander("LoRa Parameters", expanded=True):

        with st.form("lora_params"):

            # ── Band / frequency ───────────────────────────────────────
            st.selectbox(
                "Frequency band",
                options=list(BAND_CENTERS.keys()),
                key="param_band",
                help="Standard LoRaWAN frequency bands.",
            )

            col1, col2 = st.columns(2)
            with col1:
                st.selectbox(
                    "Spreading factor",
                    options=[7, 8, 9, 10, 11, 12],
                    index=3,
                    key="param_sf",
                    help="Higher SF = longer range, lower data rate.",
                )
            with col2:
                st.number_input(
                    "TX power (dBm)",
                    min_value=0.0,
                    max_value=30.0,
                    value=20.0,
                    step=1.0,
                    key="param_tx_power",
                    help="Transmitter power in dBm (typical: 14-20).",
                )

            col3, col4 = st.columns(2)
            with col3:
                st.number_input(
                    "Max range (km)",
                    min_value=1.0,
                    max_value=100.0,
                    value=30.0,
                    step=5.0,
                    key="param_max_range",
                    help="Maximum analysis range from each transmitter.",
                )
            with col4:
                st.number_input(
                    "RSSI threshold (dBm)",
                    min_value=-150.0,
                    max_value=-80.0,
                    value=-120.0,
                    step=5.0,
                    key="param_threshold",
                    help="Minimum RSSI to count as 'covered'.  Default SF10 = -132 dBm.",
                )

            st.markdown("#### Optimisation")

            st.radio(
                "Mode",
                options=["min-sites", "max-coverage"],
                index=0,
                key="param_mode",
                help="min-sites: find fewest sites for target coverage | "
                "max-coverage: maximise coverage with fixed site count",
            )

            st.slider(
                "Target coverage (fraction)",
                min_value=0.5,
                max_value=1.0,
                value=0.95,
                step=0.05,
                key="param_target",
                help="Fraction of cells that must be covered (min-sites mode).",
            )

            st.number_input(
                "N sites",
                min_value=1,
                max_value=100,
                value=10,
                step=1,
                key="param_n_sites",
                help="Number of sites to select (max-coverage mode).",
            )

            st.selectbox(
                "Matrix cell size (px)",
                options=[1, 2, 4, 8],
                index=2,
                key="param_cell_size",
                help="Larger = fewer cells, faster solver but coarser granularity.",
            )

            return st.form_submit_button("Apply", type="primary")

    return False


# ── Parameter accessors ───────────────────────────────────────────────────────


def build_params() -> LoraParams:
    """Build a :class:`LoraParams` instance from the current form values.

    Reads widget values from ``st.session_state`` using the ``param_*``
    keys set by :func:`render_params_form`.  Falls back to sensible
    defaults when session values are missing (e.g. first render before
    any form submission).
    """
    freq = BAND_CENTERS.get(
        st.session_state.get("param_band", "US915"), 915.0
    )
    sf = int(st.session_state.get("param_sf", 10))
    tx_power = float(st.session_state.get("param_tx_power", 20.0))
    return LoraParams(
        frequency_mhz=freq,
        spreading_factor=sf,
        tx_power_dbm=tx_power,
    )


def get_coverage_kwargs() -> dict:
    """Build coverage-computation keyword arguments from form state.

    Returns:
        Dictionary suitable for unpacking into
        :func:`meshplanner.propagation.coverage.compute_coverage_raster`
        or :func:`meshplanner.batch.process_sites`.
    """
    return {
        "max_range_km": float(st.session_state.get("param_max_range", 30.0)),
        "num_radials": 360,
        "step_km": 0.1,
        "num_workers": 4,
    }


def get_mode() -> str:
    """Return the current optimisation mode string.

    Returns:
        ``"min-sites"`` or ``"max-coverage"``.
    """
    return str(st.session_state.get("param_mode", "min-sites"))


def get_target() -> float:
    """Return the target coverage fraction (0.5 – 1.0)."""
    return float(st.session_state.get("param_target", 0.95))


def get_n_sites() -> int:
    """Return the target number of sites for max-coverage mode."""
    return int(st.session_state.get("param_n_sites", 10))


def get_cell_size() -> int:
    """Return the coverage matrix cell-size downsampling factor (1, 2, 4, or 8)."""
    return int(st.session_state.get("param_cell_size", 4))


def get_threshold() -> float:
    """Return the RSSI coverage threshold in dBm.

    Cells with RSSI below this value are considered *not covered*.
    """
    return float(st.session_state.get("param_threshold", -120.0))
