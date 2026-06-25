"""Sensitivity analysis for optimization parameters.

Re-runs the site-selection optimizer under pessimistic, nominal, and
optimistic parameter assumptions to quantify how coverage changes when
input assumptions vary.  This is useful for:

- Evaluating robustness of a site plan against RSSI estimation errors.
- Understanding how spreading-factor choices (SF7 ≈ -123 dBm, SF12 ≈ -137 dBm)
  affect the solution.
- Reporting a "coverage range" rather than a single point estimate to
  decision-makers.

Typical usage::

    from meshplanner.optimize.model import build_coverage_matrix
    from meshplanner.optimize.sensitivity import (
        create_scenarios,
        sensitivity_min_sites,
    )

    rasters = {"SiteA": rssi_a, "SiteB": rssi_b}
    coverage_matrix, site_names, _ = build_coverage_matrix(
        rasters, threshold_dbm=-120.0
    )
    scenarios = create_scenarios(base_threshold=-120.0)
    result = sensitivity_min_sites(
        coverage_matrix, site_names, target_coverage=0.95,
        scenarios=scenarios, rasters=rasters,
    )
    print(f"Coverage range: {result['range']}")
"""

from __future__ import annotations

from typing import Optional

import numpy as np
from scipy.sparse import csr_matrix

from meshplanner.optimize.model import build_coverage_matrix
from meshplanner.optimize.warmstart import warm_start_max_coverage, warm_start_min_sites

# ---------------------------------------------------------------------------
# Scenario generation
# ---------------------------------------------------------------------------


def create_scenarios(base_threshold: float = -120.0) -> list[dict]:
    """Generate standard sensitivity scenarios.

    Creates three scenarios that model different RSSI assumptions:

    - **optimistic** (``threshold_dbm = base_threshold - 5 dB``):
      Models a lower threshold (easier to achieve coverage), corresponding
      e.g. to using a higher spreading factor (SF12 ≈ -137 dBm).
    - **nominal** (``threshold_dbm = base_threshold``):
      The default or best-guess assumption.
    - **pessimistic** (``threshold_dbm = base_threshold + 5 dB``):
      Models a higher threshold (harder to achieve coverage), corresponding
      e.g. to using a lower spreading factor (SF7 ≈ -123 dBm) or including
      a fade margin.

    Parameters
    ----------
    base_threshold : float
        The nominal RSSI threshold in dBm (default ``-120.0``).

    Returns
    -------
    list of dict
        Each dict has keys:
        - **name** (*str*) — Scenario label.
        - **threshold_dbm** (*float*) — RSSI threshold.
        - **target_coverage** (*float*) — Default coverage target (``0.95``).
        - **weights** (*None*) — Placeholder; unused in min-sites, override
          in max-coverage calls if needed.
    """
    return [
        {
            "name": "optimistic",
            "threshold_dbm": base_threshold - 5.0,
            "target_coverage": 0.95,
            "weights": None,
        },
        {
            "name": "nominal",
            "threshold_dbm": base_threshold,
            "target_coverage": 0.95,
            "weights": None,
        },
        {
            "name": "pessimistic",
            "threshold_dbm": base_threshold + 5.0,
            "target_coverage": 0.95,
            "weights": None,
        },
    ]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _deduplicate_scenarios(
    scenarios: list[dict],
) -> list[dict]:
    """Remove duplicate scenarios (by *name*), keeping the first occurrence."""
    seen: set[str] = set()
    deduplicated: list[dict] = []
    for sc in scenarios:
        name = sc.get("name", "")
        if name in seen:
            continue
        seen.add(name)
        deduplicated.append(sc)
    return deduplicated


def _scenario_matrix(
    rasters: Optional[dict[str, np.ndarray]],
    coverage_matrix: csr_matrix,
    base_threshold_dbm: float,
    scenario: dict,
    cell_size_px: int,
) -> csr_matrix:
    """Return the coverage matrix to use for *scenario*.

    If *rasters* is provided and the scenario's ``threshold_dbm`` differs
    from *base_threshold_dbm*, the matrix is rebuilt from the rasters at
    the scenario's threshold.  Otherwise the original *coverage_matrix* is
    returned as-is.
    """
    scenario_threshold = scenario.get("threshold_dbm", base_threshold_dbm)
    if rasters is not None and scenario_threshold != base_threshold_dbm:
        mat, _, _ = build_coverage_matrix(
            rasters,
            threshold_dbm=scenario_threshold,
            cell_size_px=cell_size_px,
        )
        return mat
    return coverage_matrix


# ---------------------------------------------------------------------------
# Sensitivity: min-sites
# ---------------------------------------------------------------------------


def sensitivity_min_sites(
    coverage_matrix: csr_matrix,
    site_names: list[str],
    target_coverage: float = 0.95,
    scenarios: Optional[list[dict]] = None,
    rasters: Optional[dict[str, np.ndarray]] = None,
    base_threshold_dbm: float = -120.0,
    cell_size_px: int = 1,
    time_limit_seconds: int = 60,
) -> dict:
    """Run min-sites optimisation across multiple scenarios.

    For each scenario the coverage matrix is optionally rebuilt at the
    scenario's RSSI threshold (if *rasters* is provided), then
    :func:`~meshplanner.optimize.ilp_min_sites.ilp_min_sites` is called
    with a greedy warm-start solution.

    Parameters
    ----------
    coverage_matrix : csr_matrix
        Nominal sparse binary coverage matrix (``N_sites × N_cells``).
    site_names : list of str
        Candidate site names in matrix row order.
    target_coverage : float
        Default coverage target (overridden by per-scenario
        ``target_coverage`` if present).
    scenarios : list of dict, optional
        List of scenario dicts.  Defaults to
        :func:`create_scenarios(base_threshold_dbm)`.
    rasters : dict of str → np.ndarray, optional
        Per-site RSSI rasters.  Required if any scenario specifies a
        ``threshold_dbm`` different from *base_threshold_dbm*.
    base_threshold_dbm : float
        RSSI threshold used when building *coverage_matrix* (default
        ``-120.0``).
    cell_size_px : int
        Downsampling factor for matrix rebuilding (default ``1``).
    time_limit_seconds : int
        Solver time limit per scenario (default ``60``).

    Returns
    -------
    dict
        - **scenarios** (*list[dict]*) — Per-scenario results, each with:
          ``name``, ``threshold_dbm``, ``target_coverage``,
          ``selected_sites``, ``covered_fraction``, ``n_sites``,
          ``solve_time_s``, ``status``.
        - **range** (*dict*) — ``min_fraction``, ``max_fraction``,
          ``spread`` (max - min), all in ``[0, 1]``.
    """
    # ── Default scenarios ────────────────────────────────────────────────
    if scenarios is None:
        scenarios = create_scenarios(base_threshold_dbm)

    # ── Deduplicate ──────────────────────────────────────────────────────
    scenarios = _deduplicate_scenarios(scenarios)

    if not scenarios:
        return {
            "scenarios": [],
            "range": {"min_fraction": 0.0, "max_fraction": 0.0, "spread": 0.0},
        }

    # ── Run each scenario ────────────────────────────────────────────────
    per_scenario: list[dict] = []

    for sc in scenarios:
        sc_threshold = sc.get("threshold_dbm", base_threshold_dbm)
        sc_target = sc.get("target_coverage", target_coverage)

        # Build the matrix at this scenario's threshold if needed
        mat = _scenario_matrix(
            rasters, coverage_matrix, base_threshold_dbm, sc, cell_size_px
        )

        # Run warm-start pipeline (greedy → ILP with fallback)
        ws_result = warm_start_min_sites(
            mat,
            site_names,
            target_coverage=sc_target,
            time_limit_seconds=time_limit_seconds,
        )

        # Extract final result (ILP if successful, greedy fallback otherwise)
        final = ws_result["final"]
        ilp_raw = ws_result["ilp"]
        used_fallback = ws_result.get("used_fallback", False)
        selected = final["selected_sites"]
        covered = final["covered_fraction"]

        ilp_status = ilp_raw.get("status", "Error")
        if used_fallback:
            status = f"Feasible (greedy fallback from ILP {ilp_status})"
            solve_time = ilp_raw.get("solve_time_s", 0.0)
        else:
            status = ilp_status
            solve_time = ilp_raw.get("solve_time_s", 0.0)

        per_scenario.append(
            {
                "name": sc.get("name", "unnamed"),
                "threshold_dbm": sc_threshold,
                "target_coverage": sc_target,
                "selected_sites": list(selected),
                "covered_fraction": float(covered),
                "n_sites": len(selected),
                "solve_time_s": float(solve_time),
                "status": status,
            }
        )

    # ── Compute coverage range ───────────────────────────────────────────
    fractions = [s["covered_fraction"] for s in per_scenario]
    min_frac = float(min(fractions)) if fractions else 0.0
    max_frac = float(max(fractions)) if fractions else 0.0

    return {
        "scenarios": per_scenario,
        "range": {
            "min_fraction": min_frac,
            "max_fraction": max_frac,
            "spread": round(max_frac - min_frac, 10),
        },
    }


# ---------------------------------------------------------------------------
# Sensitivity: max-coverage
# ---------------------------------------------------------------------------


def sensitivity_max_coverage(
    coverage_matrix: csr_matrix,
    site_names: list[str],
    n_sites: int,
    scenarios: Optional[list[dict]] = None,
    rasters: Optional[dict[str, np.ndarray]] = None,
    base_threshold_dbm: float = -120.0,
    cell_size_px: int = 1,
    time_limit_seconds: int = 60,
) -> dict:
    """Run max-coverage optimisation across multiple scenarios.

    For each scenario the coverage matrix is optionally rebuilt at the
    scenario's RSSI threshold (if *rasters* is provided), then
    :func:`~meshplanner.optimize.ilp_max_coverage.ilp_max_coverage` is
    called with a greedy warm-start solution.

    Per-scenario ``weights`` (if provided) are passed to the ILP solver to
    prioritise certain cells.

    Parameters
    ----------
    coverage_matrix : csr_matrix
        Nominal sparse binary coverage matrix (``N_sites × N_cells``).
    site_names : list of str
        Candidate site names in matrix row order.
    n_sites : int
        Number of sites to select (fixed across scenarios).
    scenarios : list of dict, optional
        List of scenario dicts.  Defaults to
        :func:`create_scenarios(base_threshold_dbm)`.
    rasters : dict of str → np.ndarray, optional
        Per-site RSSI rasters.  Required if any scenario specifies a
        ``threshold_dbm`` different from *base_threshold_dbm*.
    base_threshold_dbm : float
        RSSI threshold used when building *coverage_matrix* (default
        ``-120.0``).
    cell_size_px : int
        Downsampling factor for matrix rebuilding (default ``1``).
    time_limit_seconds : int
        Solver time limit per scenario (default ``60``).

    Returns
    -------
    dict
        - **scenarios** (*list[dict]*) — Per-scenario results, each with:
          ``name``, ``threshold_dbm``, ``weights`` (or ``None``),
          ``selected_sites``, ``covered_fraction``, ``objective_value``,
          ``solve_time_s``, ``status``.
        - **range** (*dict*) — ``min_fraction``, ``max_fraction``,
          ``spread`` (max - min), all in ``[0, 1]``.
    """
    # ── Default scenarios ────────────────────────────────────────────────
    if scenarios is None:
        scenarios = create_scenarios(base_threshold_dbm)

    # ── Deduplicate ──────────────────────────────────────────────────────
    scenarios = _deduplicate_scenarios(scenarios)

    if not scenarios:
        return {
            "scenarios": [],
            "range": {"min_fraction": 0.0, "max_fraction": 0.0, "spread": 0.0},
        }

    # ── Run each scenario ────────────────────────────────────────────────
    per_scenario: list[dict] = []

    for sc in scenarios:
        sc_threshold = sc.get("threshold_dbm", base_threshold_dbm)
        sc_weights = sc.get("weights", None)

        # Build the matrix at this scenario's threshold if needed
        mat = _scenario_matrix(
            rasters, coverage_matrix, base_threshold_dbm, sc, cell_size_px
        )

        # Adjust n_sites if the scenario matrix has fewer rows
        effective_n_sites = min(n_sites, mat.shape[0])

        # Run warm-start pipeline (greedy → ILP with fallback)
        ws_result = warm_start_max_coverage(
            mat,
            site_names,
            n_sites=effective_n_sites,
            weights=sc_weights,
            time_limit_seconds=time_limit_seconds,
        )

        final = ws_result["final"]
        ilp_raw = ws_result["ilp"]
        used_fallback = ws_result.get("used_fallback", False)
        selected = final["selected_sites"]
        covered = final["covered_fraction"]
        ilp_status = ilp_raw.get("status", "Error")
        if used_fallback:
            status = f"Feasible (greedy fallback from ILP {ilp_status})"
        else:
            status = ilp_status
        solve_time = ilp_raw.get("solve_time_s", 0.0)
        obj_value = ilp_raw.get("objective_value", 0.0)

        per_scenario.append(
            {
                "name": sc.get("name", "unnamed"),
                "threshold_dbm": sc_threshold,
                "weights": sc_weights,
                "selected_sites": list(selected),
                "covered_fraction": float(covered),
                "objective_value": float(obj_value),
                "solve_time_s": float(solve_time),
                "status": status,
            }
        )

    # ── Compute coverage range ───────────────────────────────────────────
    fractions = [s["covered_fraction"] for s in per_scenario]
    min_frac = float(min(fractions)) if fractions else 0.0
    max_frac = float(max(fractions)) if fractions else 0.0

    return {
        "scenarios": per_scenario,
        "range": {
            "min_fraction": min_frac,
            "max_fraction": max_frac,
            "spread": round(max_frac - min_frac, 10),
        },
    }
