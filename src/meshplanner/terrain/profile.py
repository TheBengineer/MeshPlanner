"""Terrain profile extraction from DEM rasters along great-circle paths."""

import math
from typing import Optional, Tuple

import numpy as np


def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points in kilometers.

    Uses the Haversine formula to compute the shortest path over the
    Earth's surface (approximated as a sphere of radius 6371 km).

    Args:
        lat1, lon1: Starting point in degrees.
        lat2, lon2: Ending point in degrees.

    Returns:
        Distance in kilometers.
    """
    radius = 6371.0  # Earth's mean radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius * c


def _intermediate_point(
    lat1: float, lon1: float, lat2: float, lon2: float, fraction: float
) -> Tuple[float, float]:
    """Calculate intermediate point along the great-circle path.

    Uses spherical linear interpolation (slerp) along the great-circle
    arc between two points.

    Args:
        lat1, lon1: Starting point in degrees.
        lat2, lon2: Ending point in degrees.
        fraction: Fraction of distance from point 1 to point 2 (0.0 to 1.0).

    Returns:
        (lat, lon) of the intermediate point in degrees.
    """
    # Convert to radians
    φ1 = math.radians(lat1)
    λ1 = math.radians(lon1)
    φ2 = math.radians(lat2)
    λ2 = math.radians(lon2)

    # Angular distance in radians
    δ = _haversine_distance(lat1, lon1, lat2, lon2) / 6371.0

    if δ < 1e-10:
        return (lat1, lon1)

    a = math.sin((1 - fraction) * δ) / math.sin(δ)
    b = math.sin(fraction * δ) / math.sin(δ)

    x = a * math.cos(φ1) * math.cos(λ1) + b * math.cos(φ2) * math.cos(λ2)
    y = a * math.cos(φ1) * math.sin(λ1) + b * math.cos(φ2) * math.sin(λ2)
    z = a * math.sin(φ1) + b * math.sin(φ2)

    φ = math.atan2(z, math.sqrt(x**2 + y**2))
    λ = math.atan2(y, x)

    return (math.degrees(φ), math.degrees(λ))


def _pixel_coords(
    lat: float, lon: float, affine_transform,
) -> Tuple[float, float]:
    """Convert geographic coordinates to pixel (col, row) coordinates.

    The affine transform maps (col, row) -> (lon, lat) for a raster in
    EPSG:4326 (WGS84). The transform matrix is::

        [a  b  c]   [col]   [lon]
        [d  e  f] @ [row] = [lat]
        [0  0  1]   [1 ]   [1  ]

    For standard north-up rasters::

        a = pixel width (east-west resolution in degrees)
        b = 0
        c = left (western) edge longitude
        d = 0
        e = -pixel height (negative because y decreases southward)
        f = top (northern) edge latitude

    So the reverse mapping is::

        col = (lon - c) / a
        row = (lat - f) / e

    Args:
        lat: Latitude in degrees.
        lon: Longitude in degrees.
        affine_transform: A rasterio ``Affine`` object.

    Returns:
        (col, row) sub-pixel coordinates (float).
    """
    col = (lon - affine_transform.c) / affine_transform.a
    row = (lat - affine_transform.f) / affine_transform.e
    return col, row


def _bilinear_interpolate(
    dem_array: np.ndarray, col: float, row: float
) -> Optional[float]:
    """Bilinear interpolation of elevation at sub-pixel coordinates.

    Samples the four nearest pixels and interpolates using fractional
    offsets. Returns ``None`` if the sample point falls outside the DEM
    bounds or if any surrounding pixel is nodata (< -30000).

    Args:
        dem_array: 2D numpy array of elevation values (shape rows x cols).
        col, row: Sub-pixel column and row coordinates (float).

    Returns:
        Interpolated elevation in meters, or ``None`` if out of bounds.
    """
    rows, cols = dem_array.shape

    # Integer pixel index (top-left of the 2x2 neighborhood)
    col_int = int(math.floor(col))
    row_int = int(math.floor(row))

    # Fractional offsets within the pixel
    fx = col - col_int
    fy = row - row_int

    # Base pixel must be in bounds
    if col_int < 0 or row_int < 0 or col_int >= cols or row_int >= rows:
        return None

    # Get the top-left pixel value
    v00 = float(dem_array[row_int, col_int])
    if v00 < -30000:
        return None

    # Right neighbor — skip if fx == 0 (no horizontal interpolation needed)
    if fx > 0.0:
        if col_int + 1 >= cols:
            return None
        v10 = float(dem_array[row_int, col_int + 1])
        if v10 < -30000:
            return None
    else:
        v10 = v00

    # Bottom neighbor — skip if fy == 0 (no vertical interpolation needed)
    if fy > 0.0:
        if row_int + 1 >= rows:
            return None
        v01 = float(dem_array[row_int + 1, col_int])
        if v01 < -30000:
            return None
    else:
        v01 = v00

    # Diagonal neighbor — only needed when both fx > 0 and fy > 0
    if fx > 0.0 and fy > 0.0:
        if col_int + 1 >= cols or row_int + 1 >= rows:
            return None
        v11 = float(dem_array[row_int + 1, col_int + 1])
        if v11 < -30000:
            return None
    elif fx > 0.0:
        v11 = v01
    elif fy > 0.0:
        v11 = v10
    else:
        v11 = v00

    # Bilinear interpolation
    top = v00 + fx * (v10 - v00)
    bottom = v01 + fx * (v11 - v01)
    return top + fy * (bottom - top)


def extract_profile(
    dem_array: np.ndarray,
    metadata: dict,
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
    num_points: int = 500,
) -> dict:
    """Extract a terrain elevation profile along the great-circle path.

    Samples elevation at equally-spaced points along the great-circle
    arc between two geographic coordinates using bilinear interpolation
    from the provided DEM raster.

    If a sample point falls outside the DEM coverage (or over ocean /
    nodata areas), a default elevation of 0.0 (sea level) is used. An
    error is raised only if *all* points are invalid.

    Args:
        dem_array: 2D elevation array (rows x cols) from ``fetch_dem()``.
        metadata: DEM metadata dict with key ``'affine'``
            (a ``rasterio.Affine`` transform).
        lat1, lon1: Starting point in degrees.
        lat2, lon2: Ending point in degrees.
        num_points: Number of sample points along the path (default 500).

    Returns:
        dict with keys:

        - **elevations** (list[float]): Elevation at each sample point (m).
        - **distances_km** (list[float]): Cumulative distance at each
          sample point (km).
        - **total_distance_km** (float): Total path length (km).
        - **max_elevation** (float): Maximum elevation along the path.
        - **min_elevation** (float): Minimum elevation along the path.
        - **avg_elevation** (float): Mean elevation along the path.
        - **latlons** (list[tuple[float, float]]): (lat, lon) tuples for
          each sample point.

    Raises:
        ValueError: If no valid elevation data is found along the
            entire profile path.
    """
    affine = metadata["affine"]
    total_dist = _haversine_distance(lat1, lon1, lat2, lon2)

    elevations: list[float] = []
    distances: list[float] = []
    latlons: list[Tuple[float, float]] = []
    valid_samples = 0

    for i in range(num_points):
        fraction = i / (num_points - 1) if num_points > 1 else 0.0
        lat, lon = _intermediate_point(lat1, lon1, lat2, lon2, fraction)
        col, row = _pixel_coords(lat, lon, affine)
        elev = _bilinear_interpolate(dem_array, col, row)

        latlons.append((lat, lon))
        distances.append(total_dist * fraction)

        if elev is not None:
            elevations.append(elev)
            valid_samples += 1
        else:
            elevations.append(0.0)  # Default to sea level outside DEM

    if valid_samples == 0:
        raise ValueError(
            "No valid elevation data found along the profile path"
        )

    return {
        "elevations": elevations,
        "distances_km": distances,
        "total_distance_km": total_dist,
        "max_elevation": float(max(elevations)),
        "min_elevation": float(min(elevations)),
        "avg_elevation": float(np.mean(elevations)),
        "latlons": latlons,
    }
