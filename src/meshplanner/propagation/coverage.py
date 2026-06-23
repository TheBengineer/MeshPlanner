"""Single-site coverage raster via ITM radial sweep."""
import bisect
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Tuple

import numpy as np

from meshplanner.propagation.itm import compute_path_loss
from meshplanner.propagation.params import LinkBudget, LoraParams
from meshplanner.terrain.profile import (
    _bilinear_interpolate,
    _haversine_distance,
    _pixel_coords,
    extract_profile,
)

# ---------------------------------------------------------------------------
# Radial helpers
# ---------------------------------------------------------------------------


def _radial_points(
    tx_lat: float,
    tx_lon: float,
    angle_deg: float,
    max_range_km: float,
    step_km: float,
) -> list:
    """Generate points along a radial at given spacing.

    Args:
        tx_lat, tx_lon: Transmitter coordinates (degrees)
        angle_deg: Bearing from north (degrees)
        max_range_km: Maximum distance along radial
        step_km: Distance between sample points

    Returns:
        list of (lat, lon, distance_km) tuples
    """
    earth_radius_km = 6371.0
    angle_rad = math.radians(angle_deg)
    tx_lat_rad = math.radians(tx_lat)
    tx_lon_rad = math.radians(tx_lon)

    points = []
    d_km = 0.0
    while d_km <= max_range_km:
        if d_km == 0.0:
            points.append((tx_lat, tx_lon, 0.0))
        else:
            # Destination point given distance and bearing from start
            angular_dist = d_km / earth_radius_km
            lat2 = math.asin(
                math.sin(tx_lat_rad) * math.cos(angular_dist)
                + math.cos(tx_lat_rad) * math.sin(angular_dist) * math.cos(angle_rad)
            )
            lon2 = tx_lon_rad + math.atan2(
                math.sin(angle_rad) * math.sin(angular_dist) * math.cos(tx_lat_rad),
                math.cos(angular_dist) - math.sin(tx_lat_rad) * math.sin(lat2),
            )
            points.append((math.degrees(lat2), math.degrees(lon2), d_km))
        d_km += step_km

    return points


# ---------------------------------------------------------------------------
# DEM sampling helpers
# ---------------------------------------------------------------------------


def _pixel_for_point(
    lat: float, lon: float, affine
) -> Tuple[int, int]:
    """Get pixel coordinates for a geographic point using DEM affine transform.

    Args:
        lat, lon: Geographic coordinates
        affine: rasterio Affine transform mapping (col, row) -> (lon, lat)

    Returns:
        (col, row) integer pixel coordinates, or (-1, -1) if outside DEM
    """
    col = (lon - affine.c) / affine.a
    row = (lat - affine.f) / affine.e
    return int(round(col)), int(round(row))


def _sample_elevation(dem_array: np.ndarray, lat: float, lon: float, affine):
    """Sample elevation from DEM at a geographic point.

    Uses bilinear interpolation for sub-pixel accuracy.
    """
    col, row = _pixel_coords(lat, lon, affine)
    return _bilinear_interpolate(dem_array, col, row)


# ---------------------------------------------------------------------------
# Radial computation
# ---------------------------------------------------------------------------


def _compute_radial_path_loss(
    dem_array: np.ndarray,
    affine,
    tx_lat: float,
    tx_lon: float,
    tx_elevation: float,
    angle_deg: float,
    max_range_km: float,
    step_km: float,
    params: LoraParams,
) -> list:
    """Compute path loss along a single radial.

    For each sample point along the radial, computes the path loss from
    the transmitter to that point using the ITM model.

    Returns:
        list of dicts with: distance_km, path_loss_db, rssi_dbm, lat, lon
    """
    results = []
    points = _radial_points(tx_lat, tx_lon, angle_deg, max_range_km, step_km)

    for lat, lon, d_km in points:
        if d_km < 0.1:  # Skip TX location itself
            # Free space path loss at very close range (100 m reference)
            fs = 32.45 + 20 * math.log10(params.frequency_mhz) + 20 * math.log10(0.1)
            budget = LinkBudget.calculate(params, fs)
            results.append({
                "distance_km": 0.0,
                "path_loss_db": round(fs, 1),
                "rssi_dbm": budget.rx_power_dbm,
                "lat": lat,
                "lon": lon,
            })
            continue

        # Extract terrain profile from TX to this point
        profile = extract_profile(
            dem_array,
            {"affine": affine, "crs": "EPSG:4326"},
            tx_lat,
            tx_lon,
            lat,
            lon,
            num_points=min(500, max(50, int(d_km * 10))),
        )

        # Compute path loss via ITM
        result = compute_path_loss(
            elevations=profile["elevations"],
            total_distance_km=d_km,
            frequency_mhz=params.frequency_mhz,
            tx_height_m=params.tx_height_m,
            rx_height_m=params.rx_height_m,
        )

        # Compute RSSI via link budget
        budget = LinkBudget.calculate(params, result["path_loss_db"])

        results.append({
            "distance_km": round(d_km, 2),
            "path_loss_db": result["path_loss_db"],
            "rssi_dbm": budget.rx_power_dbm,
            "lat": lat,
            "lon": lon,
        })

    return results


# ---------------------------------------------------------------------------
# Gap filling helpers
# ---------------------------------------------------------------------------


def _interpolate_rssi_at_distance(
    radial_points: list, distance_km: float
) -> Optional[float]:
    """Interpolate RSSI at a given distance along a radial.

    Args:
        radial_points: list of (distance_km, rssi_dbm) tuples
        distance_km: Target distance

    Returns:
        RSSI at that distance, or None if out of range
    """
    if not radial_points:
        return None

    distances = [p[0] for p in radial_points]
    rssis = [p[1] for p in radial_points]

    if distance_km <= distances[0]:
        return rssis[0]
    if distance_km >= distances[-1]:
        return rssis[-1]

    # Linear interpolation between nearest points
    idx = 0
    for i in range(len(distances) - 1):
        if distances[i] <= distance_km <= distances[i + 1]:
            idx = i
            break

    d1, d2 = distances[idx], distances[idx + 1]
    r1, r2 = rssis[idx], rssis[idx + 1]

    frac = (distance_km - d1) / (d2 - d1) if d2 > d1 else 0.0
    return r1 + frac * (r2 - r1)


def _fill_coverage_gaps(
    rssi_raster: np.ndarray,
    radials: list,
    dem_array: np.ndarray,
    affine,
    tx_lat: float,
    tx_lon: float,
    params: LoraParams,
    max_range_km: float,
) -> np.ndarray:
    """Fill gaps between radials using angular interpolation.

    For each pixel within range of TX, find the two bounding radials
    and interpolate RSSI based on angular position.

    Args:
        rssi_raster: Partially-filled RSSI raster (direct radial samples)
        radials: list of (angle, radial_results) pairs
        dem_array: DEM elevation array for nodata masking
        affine: rasterio Affine transform
        tx_lat, tx_lon: Transmitter location (degrees)
        params: LoRa parameters for reference (unused in interpolation)
        max_range_km: Maximum analysis range

    Returns:
        Filled RSSI raster
    """
    rows, cols = dem_array.shape
    result = rssi_raster.copy()

    # Extract radial data as angle -> list of (distance, rssi)
    radial_data: Dict[float, list] = {}
    for angle, points in radials:
        radial_data[angle] = [(p["distance_km"], p["rssi_dbm"]) for p in points]

    radial_angles = sorted(radial_data.keys())

    if len(radial_angles) < 2:
        return result  # Can't interpolate with <2 radials

    tx_lat_rad = math.radians(tx_lat)
    tx_lon_rad = math.radians(tx_lon)

    for row in range(rows):
        for col in range(cols):
            if result[row, col] > -np.inf:
                continue  # Already computed directly

            # Get pixel center coordinates
            lon = affine.c + (col + 0.5) * affine.a
            lat = affine.f + (row + 0.5) * affine.e

            # Check if within geographic bounds
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue

            # Check if DEM elevation is valid (not ocean/nodata)
            if dem_array[row, col] < -30000:
                continue

            # Distance from TX
            d_km = _haversine_distance(tx_lat, tx_lon, lat, lon)
            if d_km > max_range_km or d_km < 0.1:
                continue

            # Bearing from TX to pixel
            lat_rad = math.radians(lat)
            lon_rad = math.radians(lon)
            dlon = lon_rad - tx_lon_rad

            y = math.sin(dlon) * math.cos(lat_rad)
            x = (
                math.cos(tx_lat_rad) * math.sin(lat_rad)
                - math.sin(tx_lat_rad) * math.cos(lat_rad) * math.cos(dlon)
            )
            bearing = (math.degrees(math.atan2(y, x)) + 360) % 360

            # Find two nearest radials
            angles_deg = list(radial_angles)
            idx = bisect.bisect_left(angles_deg, bearing)

            if idx == 0:
                left_angle = angles_deg[-1]
                right_angle = angles_deg[0]
            elif idx >= len(angles_deg):
                left_angle = angles_deg[-1]
                right_angle = angles_deg[0]
            else:
                left_angle = angles_deg[idx - 1]
                right_angle = angles_deg[idx]

            # Get RSSI at this distance on each radial
            left_rssi = _interpolate_rssi_at_distance(
                radial_data[left_angle], d_km
            )
            right_rssi = _interpolate_rssi_at_distance(
                radial_data[right_angle], d_km
            )

            if left_rssi is None and right_rssi is None:
                continue

            if left_rssi is None:
                result[row, col] = right_rssi
            elif right_rssi is None:
                result[row, col] = left_rssi
            else:
                # Angular interpolation
                angle_diff = (right_angle - left_angle) % 360
                if angle_diff == 0:
                    angle_diff = 360
                pos_from_left = (bearing - left_angle) % 360
                weight = pos_from_left / angle_diff
                result[row, col] = left_rssi + weight * (right_rssi - left_rssi)

    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compute_coverage_raster(
    dem_array: np.ndarray,
    dem_metadata: dict,
    tx_lat: float,
    tx_lon: float,
    params: Optional[LoraParams] = None,
    max_range_km: float = 30.0,
    num_radials: int = 360,
    step_km: float = 0.1,
    num_workers: int = 8,
) -> Tuple[np.ndarray, dict]:
    """Compute RSSI coverage raster for a single transmitter.

    Uses radial sweep with ITM path loss to predict received signal
    strength at every DEM cell within range of the transmitter.

    Args:
        dem_array: 2D elevation array from fetch_dem()
        dem_metadata: DEM metadata dict with 'affine' key
        tx_lat, tx_lon: Transmitter location (degrees)
        params: LoRa parameters (default: US915, SF10, 20dBm)
        max_range_km: Maximum analysis range from transmitter
        num_radials: Number of evenly-spaced radials (default: 360 = 1 deg)
        step_km: Distance between sample points along each radial
        num_workers: Thread pool workers for parallel radial computation

    Returns:
        tuple of:
            rssi_raster: 2D numpy array (dBm), same shape as dem_array
            coverage_metadata: dict with site info and computation params
    """
    if params is None:
        params = LoraParams()

    affine = dem_metadata["affine"]

    # Sample TX elevation from DEM
    tx_elevation = _sample_elevation(dem_array, tx_lat, tx_lon, affine)
    if tx_elevation is None:
        tx_elevation = float(dem_array[dem_array > -30000].min())

    # Compute path loss along each radial in parallel
    angles = [360.0 * i / num_radials for i in range(num_radials)]

    all_radial_results: List[Tuple[float, list]] = []
    with ThreadPoolExecutor(max_workers=num_workers) as executor:
        futures = {}
        for angle in angles:
            future = executor.submit(
                _compute_radial_path_loss,
                dem_array,
                affine,
                tx_lat,
                tx_lon,
                tx_elevation,
                angle,
                max_range_km,
                step_km,
                params,
            )
            futures[future] = angle

        for future in as_completed(futures):
            angle = futures[future]
            try:
                results = future.result()
                all_radial_results.append((angle, results))
            except Exception as e:
                print(f"Radial {angle} deg failed: {e}")

    # Sort radials by angle
    all_radial_results.sort(key=lambda x: x[0])

    # Create RSSI raster by marking directly-computed pixels
    rows, cols = dem_array.shape
    rssi_raster = np.full((rows, cols), -np.inf, dtype=np.float32)

    for _, radial_results in all_radial_results:
        for point in radial_results:
            col, row = _pixel_for_point(point["lat"], point["lon"], affine)
            if 0 <= col < cols and 0 <= row < rows:
                current = rssi_raster[row, col]
                if point["rssi_dbm"] > current:
                    rssi_raster[row, col] = point["rssi_dbm"]

    # Fill gaps between radials via angular interpolation
    rssi_raster = _fill_coverage_gaps(
        rssi_raster,
        all_radial_results,
        dem_array,
        affine,
        tx_lat,
        tx_lon,
        params,
        max_range_km,
    )

    coverage_metadata = {
        "type": "rssi",
        "units": "dBm",
        "tx_lat": tx_lat,
        "tx_lon": tx_lon,
        "max_range_km": max_range_km,
        "num_radials": num_radials,
        "step_km": step_km,
        "params": {
            "frequency_mhz": params.frequency_mhz,
            "spreading_factor": params.spreading_factor,
            "tx_power_dbm": params.tx_power_dbm,
            "tx_antenna_gain_dbi": params.tx_antenna_gain_dbi,
        },
        "dem_shape": dem_array.shape,
        "dem_affine": affine,
    }

    return rssi_raster, coverage_metadata


def compute_coverage_at_threshold(
    rssi_raster: np.ndarray,
    threshold_dbm: float = -120.0,
) -> np.ndarray:
    """Convert RSSI raster to binary coverage mask at given threshold.

    Args:
        rssi_raster: RSSI values in dBm (from compute_coverage_raster)
        threshold_dbm: RSSI threshold (default -120 dBm typical for SF10)

    Returns:
        Boolean array: True where RSSI >= threshold
    """
    return rssi_raster >= threshold_dbm


def compute_coverage_area(
    coverage_mask: np.ndarray,
    dem_metadata: dict,
) -> float:
    """Compute area covered (in km2) from binary coverage mask.

    Uses the DEM affine transform to compute pixel area, converting from
    degree-squared to km-squared using a latitude-dependent correction.

    Args:
        coverage_mask: Boolean array from compute_coverage_at_threshold
        dem_metadata: DEM metadata with affine transform

    Returns:
        Area in square kilometers
    """
    affine = dem_metadata["affine"]

    # Approximate center latitude from affine bounds
    rows = coverage_mask.shape[0]
    center_row = rows / 2.0
    center_lat = affine.f + center_row * affine.e
    lat_rad = math.radians(center_lat)

    # Meters per degree
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 111320.0 * math.cos(lat_rad)

    # Pixel area in km2
    area_per_pixel_km2 = (abs(affine.a) * m_per_deg_lon / 1000.0) * (
        abs(affine.e) * m_per_deg_lat / 1000.0
    )

    covered_pixels = np.sum(coverage_mask)
    return round(float(covered_pixels) * area_per_pixel_km2, 2)



