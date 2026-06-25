"""ILP formulation for maximum coverage with a fixed number of sites.

Solves the max-coverage variant of the site-selection problem using PuLP with
the bundled CBC solver.

Formulation:

    Variables:
        y_i ∈ {0, 1}  for each candidate site i     (selected or not)
        z_j ∈ {0, 1}  for each grid cell j          (covered or not)

    Constraints:
        Σ y_i = n_sites                               (exactly K sites)
        z_j ≤ Σ_i(M_ij · y_i)    ∀ cells j            (z_j only if at least
                                                        one selected site
                                                        covers cell j)

    Objective:
        maximize Σ(w_j · z_j)                          (weighted coverage)

The weights w_j allow prioritising of certain cells (e.g. population density).
When weights are uniform, this maximises the total number of covered cells.
"""

from __future__ import annotations

import time
from typing import Optional

import numpy as np
import pulp
from scipy.sparse import csr_matrix


def ilp_max_coverage(
    coverage_matrix: csr_matrix,
    site_names: list[str],
    n_sites: int,
    weights: Optional[np.ndarray] = None,
    time_limit_seconds: int = 60,
    warm_start: Optional[list[str]] = None,
) -> dict:
    """Solve the maximum-coverage-with-K-sites problem via ILP.

    Uses PuLP with the bundled CBC solver.  See module docstring for the
    full mathematical formulation.

    Parameters
    ----------
    coverage_matrix : csr_matrix
        Sparse binary matrix of shape ``(N_sites, N_cells)``.
        ``M[i, j] = 1`` if site ``i`` covers cell ``j``.
    site_names : list of str
        Names of candidate sites, in the same order as the matrix rows.
    n_sites : int
        Exactly this many sites must be selected (``0 <= n_sites <= N_sites``).
    weights : np.ndarray, optional
        Per-cell weights of shape ``(N_cells,)``.  Cells with higher weight
        are prioritised for coverage.  If ``None``, all cells have equal
        weight (``1.0``).
    time_limit_seconds : int
        Maximum wall-clock time for the solver in seconds (default ``60``).
    warm_start : list of str, optional
        Site names to use as the initial selected set for the solver's
        warm-start heuristic.  Typically produced by the greedy heuristic.

    Returns
    -------
    dict
        Dictionary with the following keys:

        - **selected_sites** (*list[str]*) -- Names of sites selected by the
          solver (length exactly ``n_sites`` if optimal/feasible).
        - **covered_fraction** (*float*) -- Fraction of cells covered by the
          selected sites (``0.0`` if infeasible/error).
        - **objective_value** (*float*) -- Value of the objective function
          (total weighted covered cells).
        - **solve_time_s** (*float*) -- Wall-clock time spent in the solver.
        - **status** (*str*) -- One of ``"Optimal"``, ``"Feasible"``,
          ``"Infeasible"``, ``"TimedOut"``, ``"Error"``.

    Raises
    ------
    ValueError
        If *site_names* length doesn't match the matrix, if *n_sites* is
        outside ``[0, N_sites]``, or if *weights* has the wrong shape.
    """
    n_sites_avail, n_cells = coverage_matrix.shape

    # ------------------------------------------------------------------
    # Input validation
    # ------------------------------------------------------------------
    if len(site_names) != n_sites_avail:
        raise ValueError(
            f"len(site_names)={len(site_names)} != n_sites_avail={n_sites_avail}"
        )
    if not 0 <= n_sites <= n_sites_avail:
        raise ValueError(
            f"n_sites must be in [0, {n_sites_avail}], got {n_sites}"
        )
    if weights is not None and weights.shape != (n_cells,):
        raise ValueError(
            f"weights must have shape ({n_cells},), got {weights.shape}"
        )

    # Default to uniform weights
    if weights is None:
        weights = np.ones(n_cells, dtype=np.float64)

    # ------------------------------------------------------------------
    # Trivial / degenerate cases
    # ------------------------------------------------------------------
    if n_sites_avail == 0 or n_cells == 0 or n_sites == 0:
        return {
            "selected_sites": [],
            "covered_fraction": 0.0,
            "objective_value": 0.0,
            "solve_time_s": 0.0,
            "status": "Trivial (no sites, no cells, or no sites to select)",
        }

    # No coverage at all → nothing to cover
    if coverage_matrix.nnz == 0:
        return {
            "selected_sites": list(site_names[:n_sites]),
            "covered_fraction": 0.0,
            "objective_value": 0.0,
            "solve_time_s": 0.0,
            "status": "Infeasible",
        }

    # If n_sites == n_sites_avail, we must select all sites — shortcut
    if n_sites == n_sites_avail:
        csc = coverage_matrix.tocsc()
        covered = np.zeros(n_cells, dtype=bool)
        for j in range(n_cells):
            start, end = csc.indptr[j], csc.indptr[j + 1]
            if end - start > 0:
                covered[j] = True
        covered_fraction = float(np.mean(covered))
        objective_value = float(np.sum(weights[covered]))
        return {
            "selected_sites": list(site_names),
            "covered_fraction": covered_fraction,
            "objective_value": objective_value,
            "solve_time_s": 0.0,
            "status": "Optimal",
        }

    # ------------------------------------------------------------------
    # Build the PuLP model
    # ------------------------------------------------------------------
    prob = pulp.LpProblem("MaxCoverage", pulp.LpMaximize)

    # --- Variables ----------------------------------------------------
    # y_i = 1 if site i is selected
    y_vars = pulp.LpVariable.dicts(
        "site", range(n_sites_avail), cat=pulp.LpBinary
    )

    # z_j = 1 if cell j is covered
    z_vars = pulp.LpVariable.dicts(
        "cell", range(n_cells), cat=pulp.LpBinary
    )

    # --- Objective: maximise weighted covered cells -------------------
    prob += pulp.lpSum([weights[j] * z_vars[j] for j in range(n_cells)])

    # --- Constraints --------------------------------------------------
    # Exactly n_sites selected
    prob += (
        pulp.lpSum([y_vars[i] for i in range(n_sites_avail)]) == n_sites
    )

    # z_j <= sum_i(M_ij * y_i)  for each cell j
    # Convert to CSC for efficient column-by-column iteration.
    csc = coverage_matrix.tocsc()

    for j in range(n_cells):
        start, end = csc.indptr[j], csc.indptr[j + 1]
        covering_sites = csc.indices[start:end]

        if len(covering_sites) == 0:
            # No site covers this cell → z_j must be 0
            prob += z_vars[j] == 0
        else:
            # z_j <= sum of y_i for sites covering cell j
            prob += (
                z_vars[j]
                <= pulp.lpSum([y_vars[i] for i in covering_sites])
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
            "objective_value": 0.0,
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
            "objective_value": 0.0,
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
                "objective_value": 0.0,
                "solve_time_s": solve_time,
                "status": "TimedOut",
            }
        status = "TimedOut"
    else:
        status = _status_map.get(raw_status, "Error")

    # Collect selected site names
    selected_indices = [
        i for i in range(n_sites_avail) if pulp.value(y_vars[i]) == 1
    ]
    selected_sites = [site_names[i] for i in selected_indices]

    # Compute covered cells and objective value from z_vars
    covered = np.array(
        [pulp.value(z_vars[j]) == 1 for j in range(n_cells)]
    )
    covered_fraction = float(np.mean(covered)) if n_cells > 0 else 0.0
    objective_value = float(np.sum(weights[covered]))

    return {
        "selected_sites": selected_sites,
        "covered_fraction": covered_fraction,
        "objective_value": objective_value,
        "solve_time_s": solve_time,
        "status": status,
    }
