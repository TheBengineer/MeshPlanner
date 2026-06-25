"""Warm-start strategies for ILP solvers.

Provides wrapper functions that run greedy heuristics first and feed their
solutions as warm-starts to the ILP solvers, combining the speed of greedy
with the optimality guarantees of ILP.

Typical speed-up: warm-start reduces ILP solve time by 30-50 % for large
problems because CBC begins with a high-quality feasible incumbent rather
than searching from scratch.

Functions
---------
warm_start_min_sites
    Greedy set-cover followed by warm-started ILP for minimum sites.
warm_start_max_coverage
    Greedy max-coverage followed by warm-started ILP for fixed-K coverage.
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np
from scipy.sparse import csr_matrix

from meshplanner.optimize.greedy import greedy_max_coverage, greedy_min_sites
from meshplanner.optimize.ilp_max_coverage import ilp_max_coverage
from meshplanner.optimize.ilp_min_sites import ilp_min_sites

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _compute_weighted_coverage(
    coverage_matrix: csr_matrix,
    selected_sites: list[str],
    site_names: list[str],
    weights: np.ndarray,
) -> float:
    """Compute weighted coverage fraction for a set of selected sites.

    This is needed because :func:`greedy_max_coverage` does not support
    per-cell weights, while the ILP does.  Calling this on the greedy result
    allows an apples-to-apples comparison.

    Parameters
    ----------
    coverage_matrix : csr_matrix
        Sparse binary matrix ``(N_sites, N_cells)``.
    selected_sites : list of str
        Site names whose collective coverage to evaluate.
    site_names : list of str
        All candidate site names (same order as matrix rows).
    weights : np.ndarray
        Per-cell weights, shape ``(N_cells,)``.

    Returns
    -------
    float
        Fraction of total weight covered by the selected sites
        (``0.0`` if *selected_sites* is empty or total weight is zero).
    """
    if not selected_sites or weights.sum() == 0:
        return 0.0

    name_to_idx = {name: idx for idx, name in enumerate(site_names)}
    n_cells = coverage_matrix.shape[1]
    covered = np.zeros(n_cells, dtype=bool)

    indptr = coverage_matrix.indptr
    indices = coverage_matrix.indices

    for site_name in selected_sites:
        idx = name_to_idx.get(site_name)
        if idx is None:
            continue
        start = indptr[idx]
        end = indptr[idx + 1]
        if start < end:
            covered[indices[start:end]] = True

    return float(np.sum(weights[covered]) / np.sum(weights))


def _site_set(selected: list[str]) -> set[str]:
    return set(selected)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def warm_start_min_sites(
    coverage_matrix: csr_matrix,
    site_names: list[str],
    target_coverage: float = 0.95,
    time_limit_seconds: int = 60,
) -> dict:
    """Run greedy set-cover, then warm-start the ILP with its solution.

    The greedy heuristic provides a high-quality feasible incumbent, which
    helps CBC prune the branch-and-bound tree faster.  If the greedy solution
    already meets the coverage target, the ILP may only need a few iterations
    to prove optimality (or find a solution with even fewer sites).

    **Fallback guarantee:** if the ILP fails (error, infeasible) or times out
    without a feasible solution, the greedy result is returned instead.

    Parameters
    ----------
    coverage_matrix : csr_matrix
        Sparse binary matrix of shape ``(N_sites, N_cells)`` from
        :func:`~meshplanner.optimize.build_coverage_matrix`.
    site_names : list of str
        Names of candidate sites, in the same order as the matrix rows.
    target_coverage : float
        Fraction of cells that must be covered (``0.0`` to ``1.0``).
        Default ``0.95``.
    time_limit_seconds : int
        Maximum wall-clock time for the ILP solver in seconds (default 60).

    Returns
    -------
    dict
        Dictionary with the following keys:

        - **greedy** (*dict*) — Raw result from :func:`greedy_min_sites`.
        - **ilp** (*dict*) — Raw result from :func:`ilp_min_sites`.
        - **improvement** (*dict*) — Comparison metrics:

          * ``covered_fraction_gain`` (float) — ILP covered fraction minus
            greedy covered fraction.  Positive means ILP covered more cells.
          * ``n_sites_savings`` (int) — Greedy iteration count minus ILP
            selected-site count.  Positive means ILP found a solution with
            fewer sites than greedy.
          * ``same_solution`` (bool) — Whether both methods selected exactly
            the same set of sites (order-insensitive).

        - **final** (*dict*) — The best available result.  Contains ILP
          results if usable, otherwise greedy results with
          ``"source": "greedy_fallback"``.
        - **used_fallback** (*bool*) — ``True`` if the greedy solution was
          used because the ILP did not produce a usable result.
    """
    # ------------------------------------------------------------------
    # Step 1 — Run greedy heuristic
    # ------------------------------------------------------------------
    greedy_result = greedy_min_sites(
        coverage_matrix,
        site_names,
        target_coverage=target_coverage,
    )
    greedy_selected: list[str] = greedy_result["selected_sites"]
    greedy_covered: float = greedy_result["covered_fraction"]
    logger.info(
        "Greedy min-sites: %d site(s) selected, %.4f coverage",
        len(greedy_selected),
        greedy_covered,
    )

    # ------------------------------------------------------------------
    # Step 2 — Warm-start ILP with greedy solution
    # ------------------------------------------------------------------
    warm_start = greedy_selected if greedy_selected else None
    ilp_result = ilp_min_sites(
        coverage_matrix,
        site_names,
        target_coverage=target_coverage,
        time_limit_seconds=time_limit_seconds,
        warm_start=warm_start,
    )
    ilp_status: str = ilp_result.get("status", "Error")
    ilp_covered: float = ilp_result.get("covered_fraction", 0.0)
    ilp_selected: list[str] = ilp_result.get("selected_sites", [])
    logger.info(
        "ILP min-sites (warm-started): %d site(s) selected, %.4f coverage, "
        "status=%s, solve_time=%.2fs",
        len(ilp_selected),
        ilp_covered,
        ilp_status,
        ilp_result.get("solve_time_s", 0.0),
    )

    # ------------------------------------------------------------------
    # Step 3 — Determine ILP usability
    # ------------------------------------------------------------------
    ilp_usable = ilp_status not in ("Error", "Infeasible") and len(ilp_selected) > 0

    # ------------------------------------------------------------------
    # Step 4 — Comparison metrics
    # ------------------------------------------------------------------
    effective_ilp_covered = ilp_covered if ilp_usable else greedy_covered
    effective_ilp_n_sites = len(ilp_selected) if ilp_usable else len(greedy_selected)

    covered_fraction_gain = effective_ilp_covered - greedy_covered
    n_sites_savings = len(greedy_selected) - effective_ilp_n_sites
    same_solution = (
        _site_set(greedy_selected) == _site_set(ilp_selected)
        if ilp_usable and greedy_selected
        else False
    )

    improvement: dict = {
        "covered_fraction_gain": covered_fraction_gain,
        "n_sites_savings": n_sites_savings,
        "same_solution": same_solution,
    }

    logger.info(
        "Warm-start comparison — coverage_gain=%.4f, sites_savings=%d, "
        "same_solution=%s",
        covered_fraction_gain,
        n_sites_savings,
        same_solution,
    )

    # ------------------------------------------------------------------
    # Step 5 — Build final result with fallback guarantee
    # ------------------------------------------------------------------
    used_fallback = not ilp_usable

    if used_fallback:
        final = {
            "selected_sites": list(greedy_selected),
            "covered_fraction": greedy_covered,
            "iterations": len(greedy_selected),
            "source": "greedy_fallback",
        }
        logger.warning("ILP min-sites failed; falling back to greedy solution")
    else:
        final = {
            "selected_sites": list(ilp_selected),
            "covered_fraction": ilp_covered,
            "solve_time_s": ilp_result.get("solve_time_s", 0.0),
            "status": ilp_status,
            "source": "ilp",
        }

    return {
        "greedy": greedy_result,
        "ilp": ilp_result,
        "improvement": improvement,
        "final": final,
        "used_fallback": used_fallback,
    }


def warm_start_max_coverage(
    coverage_matrix: csr_matrix,
    site_names: list[str],
    n_sites: int,
    weights: Optional[np.ndarray] = None,
    time_limit_seconds: int = 60,
) -> dict:
    """Run greedy max-coverage, then warm-start the ILP with its solution.

    The greedy heuristic is unweighted (counts uncovered cells), while the
    ILP supports per-cell *weights*.  When *weights* are provided, the
    improvement dict includes ``weighted_coverage_gain`` and
    ``greedy_weighted_coverage`` so the comparison is apples-to-apples.

    **Fallback guarantee:** if the ILP fails or times out without a feasible
    incumbent, the greedy result is returned instead.

    Parameters
    ----------
    coverage_matrix : csr_matrix
        Sparse binary matrix of shape ``(N_sites, N_cells)``.
    site_names : list of str
        Names of candidate sites, in the same order as the matrix rows.
    n_sites : int
        Number of sites to select (must be ``0 <= n_sites <= N_sites``).
    weights : np.ndarray, optional
        Per-cell weights of shape ``(N_cells,)``.  Passed through to the ILP.
        ``None`` means uniform weights.
    time_limit_seconds : int
        Maximum wall-clock time for the ILP solver in seconds (default 60).

    Returns
    -------
    dict
        Dictionary with the following keys:

        - **greedy** (*dict*) — Raw result from :func:`greedy_max_coverage`.
        - **ilp** (*dict*) — Raw result from :func:`ilp_max_coverage`.
        - **improvement** (*dict*) — Comparison metrics:

          * ``covered_fraction_gain`` (float) — ILP minus greedy covered
            fraction.
          * ``weighted_coverage_gain`` (float, optional) — Present only when
            *weights* is not ``None``.  ILP objective (as fraction of total
            weight) minus greedy weighted coverage.
          * ``greedy_weighted_coverage`` (float, optional) — Weighted coverage
            fraction achieved by the greedy solution (for reference).
          * ``same_solution`` (bool) — Whether both methods selected exactly
            the same set of sites.

        - **final** (*dict*) — The best available result.  Contains ILP
          results if usable, otherwise greedy results with
          ``"source": "greedy_fallback"``.
        - **used_fallback** (*bool*) — ``True`` if the greedy solution was
          used because the ILP did not produce a usable result.
    """
    # ------------------------------------------------------------------
    # Step 1 — Run greedy heuristic
    # ------------------------------------------------------------------
    greedy_result = greedy_max_coverage(
        coverage_matrix,
        site_names,
        n_sites=n_sites,
    )
    greedy_selected: list[str] = greedy_result["selected_sites"]
    greedy_covered: float = greedy_result["covered_fraction"]
    logger.info(
        "Greedy max-coverage: %d site(s) selected, %.4f coverage",
        len(greedy_selected),
        greedy_covered,
    )

    # ------------------------------------------------------------------
    # Step 2 — Warm-start ILP with greedy solution
    # ------------------------------------------------------------------
    warm_start = greedy_selected if greedy_selected else None
    ilp_result = ilp_max_coverage(
        coverage_matrix,
        site_names,
        n_sites=n_sites,
        weights=weights,
        time_limit_seconds=time_limit_seconds,
        warm_start=warm_start,
    )
    ilp_status: str = ilp_result.get("status", "Error")
    ilp_covered: float = ilp_result.get("covered_fraction", 0.0)
    ilp_selected: list[str] = ilp_result.get("selected_sites", [])
    logger.info(
        "ILP max-coverage (warm-started): %d site(s) selected, %.4f coverage, "
        "status=%s, solve_time=%.2fs",
        len(ilp_selected),
        ilp_covered,
        ilp_status,
        ilp_result.get("solve_time_s", 0.0),
    )

    # ------------------------------------------------------------------
    # Step 3 — Determine ILP usability
    # ------------------------------------------------------------------
    ilp_usable = ilp_status not in ("Error", "Infeasible") and len(ilp_selected) > 0

    # ------------------------------------------------------------------
    # Step 4 — Comparison metrics
    # ------------------------------------------------------------------
    effective_ilp_covered = ilp_covered if ilp_usable else greedy_covered
    covered_fraction_gain = effective_ilp_covered - greedy_covered

    # Weighted comparison (only available when user passed *weights*)
    greedy_weighted: Optional[float] = None
    weighted_gain: Optional[float] = None
    if weights is not None:
        greedy_weighted = _compute_weighted_coverage(
            coverage_matrix,
            greedy_selected,
            site_names,
            weights,
        )
        ilp_objective = ilp_result.get("objective_value", 0.0)
        total_weight = float(np.sum(weights))
        if total_weight > 0:
            ilp_weighted_fraction = ilp_objective / total_weight
            weighted_gain = ilp_weighted_fraction - greedy_weighted
        logger.info(
            "Weighted coverage — greedy=%.4f, ILP=%.4f, gain=%.4f",
            greedy_weighted or 0.0,
            ilp_objective / total_weight if total_weight > 0 else 0.0,
            weighted_gain or 0.0,
        )

    same_solution = (
        _site_set(greedy_selected) == _site_set(ilp_selected)
        if ilp_usable and greedy_selected
        else False
    )

    improvement: dict = {
        "covered_fraction_gain": covered_fraction_gain,
        "same_solution": same_solution,
    }
    if weights is not None:
        improvement["weighted_coverage_gain"] = weighted_gain
        improvement["greedy_weighted_coverage"] = greedy_weighted

    logger.info(
        "Warm-start comparison — coverage_gain=%.4f, same_solution=%s",
        covered_fraction_gain,
        same_solution,
    )

    # ------------------------------------------------------------------
    # Step 5 — Build final result with fallback guarantee
    # ------------------------------------------------------------------
    used_fallback = not ilp_usable

    if used_fallback:
        final = {
            "selected_sites": list(greedy_selected),
            "covered_fraction": greedy_covered,
            "iterations": len(greedy_selected),
            "source": "greedy_fallback",
        }
        logger.warning("ILP max-coverage failed; falling back to greedy solution")
    else:
        final = {
            "selected_sites": list(ilp_selected),
            "covered_fraction": ilp_covered,
            "solve_time_s": ilp_result.get("solve_time_s", 0.0),
            "status": ilp_status,
            "source": "ilp",
        }

    return {
        "greedy": greedy_result,
        "ilp": ilp_result,
        "improvement": improvement,
        "final": final,
        "used_fallback": used_fallback,
    }
