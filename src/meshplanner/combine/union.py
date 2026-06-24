"""Combine multiple coverage rasters into unified products.

Functions
---------
combine_coverage
    Per-cell combining via max/mean/min across sites.
combine_at_threshold
    Binary union/intersection mask at a given RSSI threshold.
compute_redundancy
    Count of sites covering each cell above a threshold.
"""

from typing import List, Optional

import numpy as np


def combine_coverage(
    rssi_rasters: List[np.ndarray],
    metadata_list: Optional[list] = None,
    method: str = "best",
) -> np.ndarray:
    """Combine N per-site RSSI rasters into a single combined raster.

    Parameters
    ----------
    rssi_rasters : list of np.ndarray
        List of 2-D float32 arrays from ``compute_coverage_raster()``.
        Every array must have the same shape.  ``-inf`` marks cells
        with no coverage.
    metadata_list : list, optional
        Per-site metadata (currently unused, reserved for future use).
    method : {"best", "mean", "worst"}
        Combining strategy:

        - ``"best"`` — per-cell maximum RSSI (highest signal).
        - ``"mean"`` — per-cell mean RSSI over sites that *do* cover
          the cell (``-inf`` entries are excluded from the average).
        - ``"worst"`` — per-cell minimum RSSI among covering sites.

    Returns
    -------
    np.ndarray
        Combined raster (same shape and dtype as inputs).  Cells not
        covered by **any** site remain ``-inf``.

    Raises
    ------
    ValueError
        If the input list is empty.
        If input rasters have different shapes.
        If *method* is not one of ``"best"``, ``"mean"``, ``"worst"``.
    """
    if not rssi_rasters:
        raise ValueError("At least one raster is required")

    if len(rssi_rasters) == 1:
        return rssi_rasters[0].copy()

    _validate_shapes(rssi_rasters)

    if method not in ("best", "mean", "worst"):
        raise ValueError(
            f"Unknown method '{method}'. Choose from 'best', 'mean', 'worst'."
        )

    # Stack into a 3-D array (N, H, W) and mask -inf (no-coverage) values
    stack_data = np.array(rssi_rasters, dtype=np.float32)
    stack = np.ma.MaskedArray(stack_data, mask=np.isinf(stack_data))

    if method == "best":
        combined = stack.max(axis=0)
    elif method == "worst":
        combined = stack.min(axis=0)
    else:  # "mean"
        combined = stack.mean(axis=0)

    # Cells that were masked at *every* layer remain -inf
    return combined.filled(-np.inf).astype(np.float32)


def combine_at_threshold(
    rssi_rasters: List[np.ndarray],
    threshold_dbm: float = -120.0,
    require: str = "any",
) -> np.ndarray:
    """Produce a binary coverage mask from multiple RSSI rasters.

    Parameters
    ----------
    rssi_rasters : list of np.ndarray
        Per-site RSSI rasters (all must have the same shape).
    threshold_dbm : float
        RSSI threshold in dBm (default ``-120.0``).
    require : {"any", "all"}
        - ``"any"`` — cell is covered if **any** site has RSSI ≥ threshold
          (boolean union).
        - ``"all"`` — cell is covered only if **every** site has RSSI ≥
          threshold (boolean intersection).

    Returns
    -------
    np.ndarray
        Boolean array of the same shape as the inputs.

    Raises
    ------
    ValueError
        If the input list is empty, rasters have different shapes,
        or *require* is not ``"any"`` or ``"all"``.
    """
    if not rssi_rasters:
        raise ValueError("At least one raster is required")

    _validate_shapes(rssi_rasters)

    if require not in ("any", "all"):
        raise ValueError(
            f"Unknown require '{require}'. Choose from 'any', 'all'."
        )

    # (N, H, W) boolean: True where RSSI meets the threshold
    above = np.array([r >= threshold_dbm for r in rssi_rasters])

    if require == "any":
        return np.any(above, axis=0)
    else:  # "all"
        return np.all(above, axis=0)


def compute_redundancy(
    rssi_rasters: List[np.ndarray],
    threshold_dbm: float = -120.0,
) -> np.ndarray:
    """Count how many sites cover each cell above a threshold.

    Parameters
    ----------
    rssi_rasters : list of np.ndarray
        Per-site RSSI rasters (all must have the same shape).
    threshold_dbm : float
        RSSI threshold in dBm (default ``-120.0``).

    Returns
    -------
    np.ndarray
        Integer array of the same shape as the inputs.  Each cell contains
        the number of sites whose RSSI ≥ *threshold_dbm* at that cell.
        ``0`` = uncovered, ``1`` = exactly one site covers it, etc.

    Raises
    ------
    ValueError
        If the input list is empty or rasters have different shapes.
    """
    if not rssi_rasters:
        raise ValueError("At least one raster is required")

    _validate_shapes(rssi_rasters)

    # Boolean stack (N, H, W), then sum along the site axis
    above = np.array([r >= threshold_dbm for r in rssi_rasters], dtype=np.int32)
    return np.sum(above, axis=0).astype(np.int32)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _validate_shapes(rssi_rasters: List[np.ndarray]) -> None:
    """Raise ``ValueError`` if not all rasters have the same shape."""
    shape = rssi_rasters[0].shape
    for i, r in enumerate(rssi_rasters[1:], start=1):
        if r.shape != shape:
            raise ValueError(
                f"Raster {i} has shape {r.shape}, expected {shape}"
            )
