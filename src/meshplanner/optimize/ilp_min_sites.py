"""ILP formulation for minimum sites to achieve coverage target.

Solves the set-cover variant of the site-selection problem using PuLP with
the bundled CBC solver.

Formulation (with slack for soft coverage target):

    Variables:
        y_i ∈ {0, 1}  for each candidate site i     (selected or not)
        s_j ∈ {0, 1}  for each grid cell j          (uncovered slack)

    Constraints:
        Σ(M_ij · y_i) + s_j ≥ 1    ∀ cells j        (each cell either covered
                                                      by a selected site or
                                                      explicitly slacked)
        Σ s_j ≤ (1 - target_coverage) · N_cells      (at most the allowed
                                                      fraction of cells may
                                                      be uncovered)

    Objective:
        minimize Σ y_i                               (fewest sites)

This reduces to the standard set-cover ILP when target_coverage = 1.0
(the slack-sum constraint forces all s_j = 0, so every cell must be
covered).
"""

from __future__ import annotations

import time
from typing import Optional

import numpy as np
import pulp
from scipy.sparse import csr_matrix


def ilp_min_sites(
    coverage_matrix: csr_matrix,
    site_names: list[str],
    target_coverage: float = 0.95,
    time_limit_seconds: int = 60,
    warm_start: Optional[list[str]] = None,
) -> dict:
    """Solve the minimum-sites-for-coverage problem via ILP (set cover).

    Uses PuLP with the bundled CBC solver.  See module docstring for the
    full mathematical formulation.

    Parameters
    ----------
    coverage_matrix : csr_matrix
        Sparse binary matrix of shape ``(N_sites, N_cells)``.
        ``M[i, j] = 1`` if site ``i`` covers cell ``j``.
    site_names : list of str
        Names of candidate sites, in the same order as the matrix rows.
    target_coverage : float
        Fraction of cells that must be covered (default ``0.95``).
    time_limit_seconds : int
        Maximum wall-clock time for the solver in seconds (default ``60``).
    warm_start : list of str, optional
        Site names to use as the initial selected set for the solver's
        warm-start heuristic.  Typically produced by the greedy heuristic
        (T16).

    Returns
    -------
    dict
        Dictionary with the following keys:

        - **selected_sites** (*list[str]*) — Names of sites selected by the
          solver.
        - **covered_fraction** (*float*) — Fraction of cells covered by the
          selected sites (``0.0`` if infeasible).
        - **solve_time_s** (*float*) — Wall-clock time spent in the solver.
        - **status** (*str*) — One of ``"Optimal"``, ``"Feasible"``,
          ``"Infeasible"``, ``"TimedOut"``, ``"Error"``.

    Raises
    ------
    ValueError
        If *site_names* length doesn't match the matrix, or *target_coverage*
        is outside ``[0, 1]``.
    """
    n_sites, n_cells = coverage_matrix.shape

    # ------------------------------------------------------------------
    # Input validation
    # ------------------------------------------------------------------
    if len(site_names) != n_sites:
        raise ValueError(
            f"len(site_names)={len(site_names)} != n_sites={n_sites}"
        )
    if not 0.0 <= target_coverage <= 1.0:
        raise ValueError(
            f"target_coverage must be in [0, 1], got {target_coverage}"
        )

    # ------------------------------------------------------------------
    # Trivial / degenerate cases
    # ------------------------------------------------------------------
    if n_sites == 0 or n_cells == 0:
        return {
            "selected_sites": [],
            "covered_fraction": 0.0,
            "solve_time_s": 0.0,
            "status": "Trivial (no sites or no cells)",
        }

    # No coverage at all → impossible to meet any positive target
    if coverage_matrix.nnz == 0:
        return {
            "selected_sites": [],
            "covered_fraction": 0.0,
            "solve_time_s": 0.0,
            "status": "Infeasible",
        }

    # ------------------------------------------------------------------
    # Build the PuLP model
    # ------------------------------------------------------------------
    prob = pulp.LpProblem("MinSitesCoverage", pulp.LpMinimize)

    # --- Variables ----------------------------------------------------
    # y_i = 1 if site i is selected
    y_vars = pulp.LpVariable.dicts(
        "site", range(n_sites), cat=pulp.LpBinary
    )

    # s_j = 1 if cell j is uncovered (slack variable)
    s_vars = pulp.LpVariable.dicts(
        "slack", range(n_cells), cat=pulp.LpBinary
    )

    # --- Objective: minimise number of selected sites -----------------
    prob += pulp.lpSum([y_vars[i] for i in range(n_sites)])

    # --- Constraints --------------------------------------------------
    # Convert to CSC for efficient column-by-column iteration.
    csc = coverage_matrix.tocsc()

    for j in range(n_cells):
        # Non-zero rows in column j = sites that cover cell j
        start, end = csc.indptr[j], csc.indptr[j + 1]
        covering_sites = csc.indices[start:end]

        if len(covering_sites) == 0:
            # No site covers this cell → slack *must* be 1
            prob += s_vars[j] >= 1
        else:
            prob += (
                pulp.lpSum([y_vars[i] for i in covering_sites])
                + s_vars[j]
                >= 1
            )

    # Limit on how many cells may be left uncovered
    max_uncovered = int(np.floor((1.0 - target_coverage) * n_cells))
    if max_uncovered < n_cells:
        prob += (
            pulp.lpSum([s_vars[j] for j in range(n_cells)]) <= max_uncovered
        )

    # ------------------------------------------------------------------
    # Warm start
    # ------------------------------------------------------------------
    if warm_start is not None:
        name_to_idx = {name: idx for idx, name in enumerate(site_names)}
        for site_name in warm_start:
            idx = name_to_idx.get(site_name)
            if idx is not None:
                y_vars[idx].setInitialValue(1)

    # ------------------------------------------------------------------
    # Solve
    # ------------------------------------------------------------------
    solver = pulp.PULP_CBC_CMD(
        timeLimit=time_limit_seconds,
        warmStart=(warm_start is not None),
        msg=False,
    )

    start_time = time.perf_counter()
    try:
        prob.solve(solver)
    except Exception:
        return {
            "selected_sites": [],
            "covered_fraction": 0.0,
            "solve_time_s": time.perf_counter() - start_time,
            "status": "Error",
        }
    solve_time = time.perf_counter() - start_time

    # ------------------------------------------------------------------
    # Extract results
    # ------------------------------------------------------------------
    raw_status = pulp.LpStatus[prob.status]

    # Map PuLP status strings to our canonical set
    _status_map = {
        "Optimal": "Optimal",
        "Feasible": "Feasible",
        "Infeasible": "Infeasible",
        "Not Solved": "Error",
        "Undefined": "Error",
    }
    # CBC with time limit: if interrupted before proven optimal the
    # status may be "Not Solved" even with a feasible incumbent
    # available.  We detect this case via the time limit.
    timeout = solve_time >= time_limit_seconds - 0.01

    if raw_status in ("Infeasible",) or (
        raw_status == "Not Solved" and not timeout
    ):
        status = "Infeasible" if raw_status == "Infeasible" else "Error"
        return {
            "selected_sites": [],
            "covered_fraction": 0.0,
            "solve_time_s": solve_time,
            "status": status,
        }

    if raw_status == "Not Solved" and timeout:
        # CBC timed out but may have a feasible incumbent
        # Check if any variable has a valid value
        if pulp.value(y_vars[0]) is None:
            return {
                "selected_sites": [],
                "covered_fraction": 0.0,
                "solve_time_s": solve_time,
                "status": "TimedOut",
            }
        status = "TimedOut"
    else:
        status = _status_map.get(raw_status, "Error")

    # Collect selected site names
    selected_indices = [
        i for i in range(n_sites) if pulp.value(y_vars[i]) == 1
    ]
    selected_sites = [site_names[i] for i in selected_indices]

    # Compute covered fraction from slack variables
    if n_cells > 0:
        n_uncovered = sum(
            1 for j in range(n_cells) if pulp.value(s_vars[j]) == 1
        )
        covered_fraction = 1.0 - n_uncovered / n_cells
    else:
        covered_fraction = 0.0

    return {
        "selected_sites": selected_sites,
        "covered_fraction": covered_fraction,
        "solve_time_s": solve_time,
        "status": status,
    }
