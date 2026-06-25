"""Greedy heuristics for site-selection optimization.

Provides two greedy approximation algorithms for the maximum-coverage
problem:

- **greedy_min_sites** — iteratively pick the site covering the most
  uncovered cells until a target coverage fraction is met (set-cover style).
- **greedy_max_coverage** — iteratively pick exactly *N* sites, each
  covering the most additional uncovered cells.

Both work directly on the sparse coverage matrix from
:func:`~meshplanner.optimize.build_coverage_matrix` and avoid dense
conversion for performance.
"""

import numpy as np
from scipy.sparse import csr_matrix


def greedy_min_sites(
    coverage_matrix: csr_matrix,
    site_names: list[str],
    target_coverage: float = 0.95,
) -> dict:
    """Greedy set-cover: pick sites to cover at least *target_coverage* of cells.

    At each iteration, selects the unselected site that covers the most
    currently-uncovered cells.  Stops when the fraction of covered cells
    reaches *target_coverage* or no more coverage can be gained.

    Parameters
    ----------
    coverage_matrix : csr_matrix
        Sparse binary matrix of shape ``(N_sites, N_cells)`` from
        :func:`~meshplanner.optimize.build_coverage_matrix`.
    site_names : list of str
        Site names corresponding to matrix rows.
    target_coverage : float
        Fraction of cells to cover (0.0 to 1.0).  Default 0.95.

    Returns
    -------
    dict
        - ``selected_sites`` (list of str):
            Chosen site names in the order they were selected.
        - ``covered_fraction`` (float):
            Fraction of cells covered by the selected sites.
        - ``iterations`` (int):
            Number of sites selected.
    """
    n_sites, n_cells = coverage_matrix.shape

    # ── Edge cases ──────────────────────────────────────────────────────
    if target_coverage <= 0.0 or n_sites == 0:
        return {"selected_sites": [], "covered_fraction": 0.0, "iterations": 0}

    target_coverage = min(target_coverage, 1.0)

    # Unpack CSR internals for fast row access
    indptr = coverage_matrix.indptr
    indices = coverage_matrix.indices

    row_lens = np.diff(indptr)  # shape (n_sites,)

    covered = np.zeros(n_cells, dtype=bool)
    n_covered = 0
    selected: list[str] = []
    remaining = set(range(n_sites))

    while remaining:
        best_site = -1
        best_gain = 0

        for site_idx in remaining:
            if row_lens[site_idx] == 0:
                continue  # site covers no cells at all
            start = indptr[site_idx]
            end = indptr[site_idx + 1]
            gain = np.count_nonzero(~covered[indices[start:end]])
            if gain > best_gain:
                best_gain = gain
                best_site = site_idx
                # If this site covers every still-uncovered cell, we cannot
                # possibly beat it.
                if gain == n_cells - n_covered:
                    break

        if best_site == -1 or best_gain == 0:
            break  # no further coverage possible

        selected.append(site_names[best_site])
        start = indptr[best_site]
        end = indptr[best_site + 1]
        covered[indices[start:end]] = True
        n_covered += best_gain
        remaining.remove(best_site)

        if n_covered / n_cells >= target_coverage:
            break

    return {
        "selected_sites": selected,
        "covered_fraction": float(n_covered / n_cells),
        "iterations": len(selected),
    }


def greedy_max_coverage(
    coverage_matrix: csr_matrix,
    site_names: list[str],
    n_sites: int,
) -> dict:
    """Greedy max-coverage: pick *n_sites* sites to maximise coverage.

    At each iteration, selects the unselected site that covers the most
    currently-uncovered cells.  Stops when *n_sites* are selected or no
    more sites are available.

    Parameters
    ----------
    coverage_matrix : csr_matrix
        Sparse binary matrix of shape ``(N_sites, N_cells)``.
    site_names : list of str
        Site names corresponding to matrix rows.
    n_sites : int
        Number of sites to select.

    Returns
    -------
    dict
        - ``selected_sites`` (list of str):
            Chosen site names in selection order.
        - ``covered_fraction`` (float):
            Fraction of cells covered.
        - ``iterations`` (int):
            Number of sites selected (may be less than *n_sites* if
            *n_sites* exceeds the number of available sites or no further
            coverage can be gained).
    """
    n_available, n_cells = coverage_matrix.shape

    # ── Edge cases ──────────────────────────────────────────────────────
    if n_sites <= 0 or n_available == 0:
        return {"selected_sites": [], "covered_fraction": 0.0, "iterations": 0}

    # If we have fewer sites than requested, return all of them.
    if n_sites >= n_available:
        covered = np.zeros(n_cells, dtype=bool)
        indptr = coverage_matrix.indptr
        indices = coverage_matrix.indices
        for i in range(n_available):
            start = indptr[i]
            end = indptr[i + 1]
            if start < end:
                covered[indices[start:end]] = True
        n_covered = np.count_nonzero(covered)
        return {
            "selected_sites": list(site_names),
            "covered_fraction": float(n_covered / n_cells),
            "iterations": n_available,
        }

    indptr = coverage_matrix.indptr
    indices = coverage_matrix.indices
    row_lens = np.diff(indptr)

    covered = np.zeros(n_cells, dtype=bool)
    selected: list[str] = []
    remaining = set(range(n_available))
    n_covered = 0

    for _ in range(n_sites):
        best_site = -1
        best_gain = 0

        for site_idx in remaining:
            if row_lens[site_idx] == 0:
                continue
            start = indptr[site_idx]
            end = indptr[site_idx + 1]
            gain = np.count_nonzero(~covered[indices[start:end]])
            if gain > best_gain:
                best_gain = gain
                best_site = site_idx
                if gain == n_cells - n_covered:
                    break

        if best_site == -1 or best_gain == 0:
            break

        selected.append(site_names[best_site])
        start = indptr[best_site]
        end = indptr[best_site + 1]
        covered[indices[start:end]] = True
        n_covered += best_gain
        remaining.remove(best_site)

    return {
        "selected_sites": selected,
        "covered_fraction": float(n_covered / n_cells),
        "iterations": len(selected),
    }
