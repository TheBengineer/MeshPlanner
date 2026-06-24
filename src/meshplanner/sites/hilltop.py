"""Detect hilltop candidate sites from DEM using morphological dilation.

Uses ``scipy.ndimage.maximum_filter`` to identify local elevation maxima,
computes topographic prominence for each peak via path analysis, and filters
by minimum prominence and inter-peak distance.
"""

import math
from typing import Any

import numpy as np
from scipy.ndimage import maximum_filter, minimum_filter
from scipy.spatial import KDTree

# ── Geo helpers ──────────────────────────────────────────────────────────────


def _haversine_distance(
    lat1: float, lon1: float, lat2: float, lon2: float,
) -> float:
    """Great-circle distance between two points in kilometers."""
    radius = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _intermediate_point(
    lat1: float, lon1: float, lat2: float, lon2: float, fraction: float,
) -> tuple[float, float]:
    """Great-circle slerp — returns (lat, lon) at *fraction* along the arc."""
    φ1 = math.radians(lat1)
    λ1 = math.radians(lon1)
    φ2 = math.radians(lat2)
    λ2 = math.radians(lon2)

    # Angular distance
    δ = _haversine_distance(lat1, lon1, lat2, lon2) / 6371.0

    if δ < 1e-12:
        return (lat1, lon1)

    a = math.sin((1 - fraction) * δ) / math.sin(δ)
    b = math.sin(fraction * δ) / math.sin(δ)

    x = a * math.cos(φ1) * math.cos(λ1) + b * math.cos(φ2) * math.cos(λ2)
    y = a * math.cos(φ1) * math.sin(λ1) + b * math.cos(φ2) * math.sin(λ2)
    z = a * math.sin(φ1) + b * math.sin(φ2)

    return (math.degrees(math.atan2(z, math.sqrt(x ** 2 + y ** 2))),
            math.degrees(math.atan2(y, x)))


# ── Bilinear interpolation (nodata-safe) ─────────────────────────────────────


_NODATA_THRESHOLD = -30000


def _bilinear_interpolate(
    dem_array: np.ndarray, col: float, row: float,
) -> float | None:
    """Sample elevation at sub-pixel (col, row).

    Returns ``None`` if outside the DEM or any surrounding pixel is nodata/NaN.
    """
    rows, cols = dem_array.shape
    ci = int(math.floor(col))
    ri = int(math.floor(row))
    fx = col - ci
    fy = row - ri

    if ci < 0 or ri < 0 or ci >= cols or ri >= rows:
        return None

    def _valid(v: float) -> bool:
        return v > _NODATA_THRESHOLD and np.isfinite(v)

    v00 = float(dem_array[ri, ci])
    if not _valid(v00):
        return None

    # Right neighbour
    if fx > 0.0:
        if ci + 1 >= cols:
            return None
        v10 = float(dem_array[ri, ci + 1])
        if not _valid(v10):
            return None
    else:
        v10 = v00

    # Bottom neighbour
    if fy > 0.0:
        if ri + 1 >= rows:
            return None
        v01 = float(dem_array[ri + 1, ci])
        if not _valid(v01):
            return None
    else:
        v01 = v00

    # Diagonal neighbour
    if fx > 0.0 and fy > 0.0:
        if ci + 1 >= cols or ri + 1 >= rows:
            return None
        v11 = float(dem_array[ri + 1, ci + 1])
        if not _valid(v11):
            return None
    elif fx > 0.0:
        v11 = v01
    elif fy > 0.0:
        v11 = v10
    else:
        v11 = v00

    top = v00 + fx * (v10 - v00)
    bottom = v01 + fx * (v11 - v01)
    return top + fy * (bottom - top)


# ── Path-minimum helper (used for prominence saddle search) ──────────────────


def _min_elevation_on_path(
    dem_array: np.ndarray,
    affine: Any,
    lat1: float, lon1: float,
    lat2: float, lon2: float,
    num_samples: int = 50,
) -> float | None:
    """Minimum valid elevation along the great-circle path between two points.

    Returns ``None`` when every sample is invalid.
    """
    min_val = float("inf")
    found = False

    for i in range(num_samples):
        frac = i / (num_samples - 1) if num_samples > 1 else 0.0
        lat, lon = _intermediate_point(lat1, lon1, lat2, lon2, frac)

        col = (lon - affine.c) / affine.a
        row = (lat - affine.f) / affine.e

        elev = _bilinear_interpolate(dem_array, col, row)
        if elev is not None and elev < min_val:
            min_val = elev
            found = True

    return min_val if found else None


# ── Circular footprint ───────────────────────────────────────────────────────


def _make_circular_footprint(radius_px: int) -> np.ndarray:
    """Boolean circular structuring element (diameter = 2*radius_px + 1)."""
    diameter = 2 * radius_px + 1
    fp = np.zeros((diameter, diameter), dtype=bool)
    cx = cy = radius_px
    for i in range(diameter):
        for j in range(diameter):
            if (i - cx) ** 2 + (j - cy) ** 2 <= radius_px ** 2:
                fp[i, j] = True
    return fp


# ── Pixel-size helper ────────────────────────────────────────────────────────


def _compute_pixel_size_km(affine: Any, center_lat: float) -> float:
    """Average pixel size in kilometres, accounting for latitude."""
    lat_rad = math.radians(center_lat)
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * math.cos(lat_rad)

    px_width_km = abs(affine.a) * km_per_deg_lon
    px_height_km = abs(affine.e) * km_per_deg_lat
    return (px_width_km + px_height_km) / 2.0


# ── Public API ───────────────────────────────────────────────────────────────


def detect_hilltops(
    dem_array: np.ndarray,
    dem_metadata: dict,
    min_prominence_m: float = 50.0,
    min_distance_km: float = 0.5,
) -> list[dict]:
    """Find local elevation maxima in a DEM via morphological dilation.

    The algorithm:

    1.  Mask invalid cells (nodata / NaN).
    2.  Build a circular footprint whose radius (in pixels) is derived from
        *min_distance_km* and the DEM ground-sample distance.
    3.  Apply ``scipy.ndimage.maximum_filter`` — any cell equal to its
        local maximum and strictly greater than the local minimum is a
        candidate peak (the minimum-filter check excludes flat plateaus).
    4.  Convert pixel coordinates to geographic (lat / lon) via the affine
        transform embedded in *dem_metadata*.
    5.  **Prominence**: For each candidate (in descending elevation order),
        find the lowest saddle connecting it to any higher peak by
        sampling elevations along the great-circle arc.  The key saddle
        is the *highest* of those minimum-path values.  Prominence =
        peak elevation − key saddle elevation.
    6.  Filter by *min_prominence_m*.
    7.  Non-maximum suppression: keep only the highest peak within each
        *min_distance_km* exclusion zone.
    8.  Sort by elevation descending.

    Args:
        dem_array:
            2-D float32 elevation array (rows × cols) from
            :func:`~meshplanner.terrain.fetch.fetch_dem_raster`.
        dem_metadata:
            Metadata dict — must contain ``"affine"``
            (a ``rasterio.Affine`` in EPSG:4326).
        min_prominence_m:
            Minimum topographic prominence in metres.  Peaks whose
            prominence is below this threshold are discarded.
            Default ``50.0``.
        min_distance_km:
            Minimum separation between distinct peaks in kilometres.
            Also drives the morphological footprint radius.
            Default ``0.5``.

    Returns:
        List of dicts sorted by descending ``elevation_m``:

        .. code-block:: python

            [
                {
                    "lat": 35.595,
                    "lon": -82.487,
                    "elevation_m": 1542.3,
                    "prominence_m": 312.5,
                },
                ...
            ]

        An empty list is returned when no valid elevation data is present
        or no peaks satisfy the filters.
    """
    dem = np.asarray(dem_array, dtype=np.float32)
    affine = dem_metadata["affine"]

    # ── 1.  Valid-data mask ──────────────────────────────────────────
    valid = np.isfinite(dem) & (dem > _NODATA_THRESHOLD)
    if not valid.any():
        return []

    rows, cols = dem.shape

    # ── 2.  Footprint ────────────────────────────────────────────────
    center_lat = float(affine.f + (rows / 2.0) * affine.e)
    pixel_size_km = _compute_pixel_size_km(affine, center_lat)
    radius_px = max(1, int(round(min_distance_km / pixel_size_km)))
    footprint = _make_circular_footprint(radius_px)

    # ── 3.  Local maxima via morphological dilation ──────────────────
    # Manually pad the array to avoid scipy boundary bugs that occur
    # when the footprint is much larger than the input array.  We use
    # -inf / +inf as pad values so that out-of-bounds cells never
    # become candidates for the max / min filters.
    pad = radius_px  # footprint radius in pixels
    dem_filled = np.where(valid, dem, -np.inf).astype(np.float32)
    dem_padded = np.pad(dem_filled, pad, mode="constant", constant_values=-np.inf)

    dem_max_padded = maximum_filter(dem_padded, footprint=footprint)
    # Crop the padded result back to the original DEM shape.
    dem_max = dem_max_padded[pad:-pad, pad:-pad]

    # For the min-filter we use +inf as the sentinel so out-of-bounds
    # cells never become the neighbourhood minimum.
    dem_min_input = np.where(valid, dem, np.inf).astype(np.float32)
    dem_min_padded = np.pad(dem_min_input, pad, mode="constant", constant_values=np.inf)
    dem_min_padded_ft = minimum_filter(dem_min_padded, footprint=footprint)
    dem_min = dem_min_padded_ft[pad:-pad, pad:-pad]

    # A true local maximum equals the max-filter AND is strictly larger
    # than the min-filter (excludes flat plateaus).
    is_peak = (dem_filled == dem_max) & (dem_filled > dem_min) & valid

    # Exclude cells too close to the DEM edge — the padded boundary
    # can create false-positive peaks where the neighbourhood is only
    # partially valid.
    if pad < min(rows, cols) // 2:
        is_peak[:pad, :] = False
        is_peak[-pad:, :] = False
        is_peak[:, :pad] = False
        is_peak[:, -pad:] = False

    peak_rows, peak_cols = np.where(is_peak)
    if len(peak_rows) == 0:
        return []

    # ── 4.  Pixel → geographic ──────────────────────────────────────
    peak_lons = affine.c + peak_cols * affine.a
    peak_lats = affine.f + peak_rows * affine.e
    peak_elvs = dem[peak_rows, peak_cols]

    peaks: list[dict[str, Any]] = [
        {
            "row": int(r), "col": int(c),
            "lat": float(peak_lats[i]), "lon": float(peak_lons[i]),
            "elevation": float(peak_elvs[i]),
        }
        for i, (r, c) in enumerate(zip(peak_rows, peak_cols))
    ]

    # ── 5.  Sort by elevation descending ─────────────────────────────
    peaks.sort(key=lambda p: p["elevation"], reverse=True)

    # ── 6.  Prominence computation ───────────────────────────────────
    # The key saddle for peak P is the *highest* of the lowest points
    # on all paths from P to a *higher* peak.  For the overall highest
    # peak we approximate the key saddle by checking paths to the DEM
    # boundary (its "island parent").
    #
    # Performance: checking *all* higher peaks is O(n²) and becomes
    # impractical for hundreds of peaks.  We use a KD-tree to find
    # nearby higher peaks and limit the search to the nearest 30.
    # For most topographic settings the key saddle lies close to the
    # peak, so this approximation is accurate.
    #
    # Boundary points used for the highest-peak case.
    boundary_pts = [
        (0, 0),
        (0, cols - 1),
        (rows - 1, 0),
        (rows - 1, cols - 1),
        (rows // 2, 0),
        (rows // 2, cols - 1),
        (0, cols // 2),
        (rows - 1, cols // 2),
    ]

    # Build KD-tree over (lon, lat) for fast spatial queries.
    peak_lon_lat = np.array([[p["lon"], p["lat"]] for p in peaks], dtype=np.float64)
    tree = KDTree(peak_lon_lat)

    for i, peak in enumerate(peaks):
        if i == 0:
            # ── Highest peak — check paths to DEM boundary ──────
            saddle_vals: list[float] = []
            for br, bc in boundary_pts:
                flat2 = float(affine.f + br * affine.e)
                lon2 = float(affine.c + bc * affine.a)
                min_e = _min_elevation_on_path(
                    dem, affine,
                    peak["lat"], peak["lon"], flat2, lon2,
                    num_samples=100,
                )
                if min_e is not None:
                    saddle_vals.append(min_e)

            if saddle_vals and peak["elevation"] > max(saddle_vals):
                prominence = peak["elevation"] - max(saddle_vals)
            else:
                prominence = peak["elevation"]
        else:
            # ── Lower peaks — check nearby higher peaks via KD-tree ──
            # Search for the 30 nearest neighbours (which includes the
            # peak itself at distance 0).  We increase `k` iteratively
            # until we find at least one higher peak.
            k = min(31, len(peaks))
            distances, indices = tree.query(
                peak_lon_lat[i], k=k, p=2,
            )
            # Indices[0] is the peak itself; skip it.
            higher_indices = [idx for idx in indices if idx < i]

            # If none of the nearest 30 are higher, fall back to
            # checking ALL higher peaks (this is rare for large N
            # but can happen for the second-highest peak when peaks
            # are widely spaced).
            if not higher_indices:
                higher_indices = list(range(i))

            saddle_candidates: list[float] = []
            for j in higher_indices:
                higher = peaks[j]
                min_on_path = _min_elevation_on_path(
                    dem, affine,
                    peak["lat"], peak["lon"],
                    higher["lat"], higher["lon"],
                    num_samples=50,
                )
                if min_on_path is not None:
                    saddle_candidates.append(min_on_path)

            if saddle_candidates:
                max_saddle = max(saddle_candidates)
                prominence = peak["elevation"] - max_saddle
            else:
                prominence = peak["elevation"]

        peak["prominence_m"] = max(0.0, prominence)

    # ── 7.  Filter by prominence ─────────────────────────────────────
    peaks = [p for p in peaks if p["prominence_m"] >= min_prominence_m]

    # ── 8.  Non-maximum suppression by min_distance_km ───────────────
    kept: list[dict[str, Any]] = []
    for peak in peaks:
        too_close = any(
            _haversine_distance(peak["lat"], peak["lon"],
                                k["lat"], k["lon"])
            < min_distance_km
            for k in kept
        )
        if not too_close:
            kept.append(peak)

    # ── 9.  Return clean result dicts ────────────────────────────────
    return [
        {
            "lat": p["lat"],
            "lon": p["lon"],
            "elevation_m": p["elevation"],
            "prominence_m": p["prominence_m"],
        }
        for p in kept
    ]
