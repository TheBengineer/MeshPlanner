"""Optimization model data structures and constraints.

This module provides the core data structures that feed the Phase 3
optimization algorithms, most importantly the coverage adjacency matrix:
a sparse binary matrix ``M[i, j] = 1`` if candidate site ``i`` covers
grid cell ``j`` at a given RSSI threshold.
"""

from typing import Dict, List, Tuple

import numpy as np
from scipy.sparse import csr_matrix


def build_coverage_matrix(
    rasters: Dict[str, np.ndarray],
    threshold_dbm: float = -120.0,
    cell_size_px: int = 1,
) -> Tuple[csr_matrix, List[str], int]:
    """Build a sparse binary coverage matrix from per-site RSSI rasters.

    Each row ``i`` corresponds to a candidate site and each column ``j``
    corresponds to a grid cell.  ``M[i, j] = 1`` if site ``i`` covers cell
    ``j`` (i.e. its RSSI >= *threshold_dbm* at that cell).

    Cells can be downsampled (aggregated into super-pixels) via the
    *cell_size_px* parameter to reduce the problem size for the solver.

    Parameters
    ----------
    rasters : dict[str, np.ndarray]
        Dictionary mapping site name to 2-D ``float32`` RSSI raster (dBm).
        ``-inf`` marks cells with no coverage.
    threshold_dbm : float
        RSSI threshold in dBm.  Cells with RSSI >= *threshold_dbm* are
        considered "covered".  Default ``-120.0``.
    cell_size_px : int
        Downsampling factor.  If > 1, adjacent cells in
        ``cell_size_px x cell_size_px`` blocks are aggregated: a block is
        "covered" if **any** pixel in the block is covered.  Default ``1``
        (no downsampling).

    Returns
    -------
    coverage_matrix : scipy.sparse.csr_matrix
        Sparse binary matrix of shape ``(N_sites, N_cells)``.
    site_names : list of str
        Site names in the same order as the matrix rows.
    n_cells : int
        Total number of grid cells (columns in the matrix).

    Raises
    ------
    ValueError
        If *rasters* is empty.
        If *cell_size_px* < 1.
        If input rasters have different shapes.
    """
    if not rasters:
        raise ValueError("At least one raster is required")
    if cell_size_px < 1:
        raise ValueError(
            f"cell_size_px must be >= 1, got {cell_size_px}"
        )

    site_names = list(rasters.keys())
    raster_list = [rasters[name] for name in site_names]

    # Validate shapes ──────────────────────────────────────────────────────
    shape = raster_list[0].shape
    if len(shape) != 2:
        raise ValueError(f"Expected 2-D rasters, got shape {shape}")
    for i, r in enumerate(raster_list[1:], start=1):
        if r.shape != shape:
            raise ValueError(
                f"Raster {i} has shape {r.shape}, expected {shape}"
            )

    h, w = shape

    # Compute output dimensions after (optional) downsampling
    h_out = (h + cell_size_px - 1) // cell_size_px
    w_out = (w + cell_size_px - 1) // cell_size_px
    n_cells = h_out * w_out

    # Build sparse matrix entries ──────────────────────────────────────────
    rows: List[int] = []
    cols: List[int] = []

    for i, rssi in enumerate(raster_list):
        # Binary mask: True where RSSI meets the threshold
        # Note: -inf >= threshold_dbm evaluates to False, so uncovered
        # cells (which are -inf) are automatically excluded.
        mask = rssi >= threshold_dbm

        # Downsample if requested
        if cell_size_px > 1:
            mask = _downsample_mask(mask, cell_size_px, h_out, w_out)

        # Find indices of covered cells in the (downsampled) 1-D view
        covered_indices = np.flatnonzero(mask.ravel())
        n_covered = len(covered_indices)
        rows.extend([i] * n_covered)
        cols.extend(covered_indices.tolist())

    # Construct CSR matrix from coordinate lists
    data = np.ones(len(rows), dtype=np.float64)
    coverage_matrix = csr_matrix(
        (data, (rows, cols)),
        shape=(len(site_names), n_cells),
        dtype=np.float64,
    )

    return coverage_matrix, site_names, n_cells


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _downsample_mask(
    mask: np.ndarray,
    cell_size_px: int,
    h_out: int,
    w_out: int,
) -> np.ndarray:
    """Downsample a binary mask by aggregating *cell_size_px* blocks.

    A block is "covered" if **any** pixel in the block is covered (OR
    pooling).  The input is padded with ``False`` along the right and
    bottom edges if the dimensions are not evenly divisible.
    """
    h, w = mask.shape
    pad_h = h_out * cell_size_px - h
    pad_w = w_out * cell_size_px - w

    if pad_h > 0 or pad_w > 0:
        mask = np.pad(mask, ((0, pad_h), (0, pad_w)), constant_values=False)

    # Reshape to (h_out, cell_size_px, w_out, cell_size_px) and OR over
    # the block-internal axes (1, 3)
    return mask.reshape(h_out, cell_size_px, w_out, cell_size_px).any(axis=(1, 3))
