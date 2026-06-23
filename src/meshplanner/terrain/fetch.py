"""Fetch digital elevation model (DEM) tiles for a bounding box from AWS Open Data.

Uses NASA SRTM 30m tiles hosted on AWS Open Data:
  https://s3.amazonaws.com/elevation-tiles-prod/geotiff/{z}/{x}/{y}.tif

Zoom levels:
  - z=12 → ~30m resolution (SRTM 30m)
  - z=11 → ~90m resolution (SRTM 90m)
"""

import math
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import rasterio
import requests
from rasterio.enums import Resampling
from rasterio.merge import merge
from rasterio.warp import calculate_default_transform, reproject, transform_bounds

from meshplanner.terrain.cache import get_cache_path

SRTM_BASE_URL = (
    "https://s3.amazonaws.com/elevation-tiles-prod/geotiff/{zoom}/{x}/{y}.tif"
)

ZOOM_MAP = {"30m": 12, "90m": 11}
"""Mapping from resolution string to Web Mercator zoom level."""

SRC_CRS = "EPSG:3857"
DST_CRS = "EPSG:4326"
"""Source tiles are in Web Mercator (3857); output is WGS84 (4326)."""


def _tile_coords(lon: float, lat: float, zoom: int = 12):
    """Convert lon/lat to Web Mercator tile x/y at given zoom level.

    Args:
        lon: Longitude in degrees (-180 to 180).
        lat: Latitude in degrees (-85.05 to 85.05).
        zoom: Zoom level (0-18).

    Returns:
        Tuple of (tile_x, tile_y).
    """
    lat_rad = math.radians(lat)
    n = 2.0**zoom
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def _download_tile(x: int, y: int, zoom: int) -> str | None:
    """Download a single SRTM tile from AWS Open Data with local caching.

    Args:
        x: Tile x coordinate.
        y: Tile y coordinate.
        zoom: Zoom level.

    Returns:
        Path string to cached tile file, or None if download failed.
    """
    url = SRTM_BASE_URL.format(zoom=zoom, x=x, y=y)
    cache_path = get_cache_path(zoom, x, y)

    if cache_path.exists():
        return str(cache_path)

    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        with open(cache_path, "wb") as f:
            f.write(resp.content)
        return str(cache_path)
    except requests.RequestException:
        return None


def _fetch_dem_tiles(bbox: dict, zoom: int) -> list[str]:
    """Download all SRTM tiles covering a bounding box at given zoom level.

    Downloads tiles in parallel using a thread pool.

    Args:
        bbox: dict with keys west, south, east, north (float degrees).
        zoom: Web Mercator zoom level.

    Returns:
        List of file paths to cached tiles.

    Raises:
        RuntimeError: If no tiles could be downloaded.
    """
    x_min, y_max = _tile_coords(bbox["west"], bbox["north"], zoom)
    x_max, y_min = _tile_coords(bbox["east"], bbox["south"], zoom)

    x_min, x_max = min(x_min, x_max), max(x_min, x_max)
    y_min, y_max = min(y_min, y_max), max(y_min, y_max)

    tile_paths: list[str] = []
    tasks = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        for x in range(x_min, x_max + 1):
            for y in range(y_min, y_max + 1):
                tasks.append(executor.submit(_download_tile, x, y, zoom))

        for future in as_completed(tasks):
            path = future.result()
            if path:
                tile_paths.append(path)

    if not tile_paths:
        raise RuntimeError(f"No DEM tiles found for bbox: {bbox}")

    return tile_paths


def fetch_dem_raster(
    bbox: dict, resolution: str = "30m"
) -> tuple[np.ndarray, dict]:
    """Fetch DEM for a bounding box and return elevation array with geospatial metadata.

    Downloads SRTM tiles from AWS Open Data (EPSG:3857), merges them, crops to
    the bounding box, and reprojects to EPSG:4326 (WGS84).

    Args:
        bbox: dict with keys west, south, east, north (float degrees).
        resolution: "30m" (zoom 12, ~30m/pixel) or "90m" (zoom 11, ~90m/pixel).

    Returns:
        Tuple of (elevation_array: np.ndarray, metadata: dict).
        The elevation array is 2D with shape (height, width) in meters.
        Metadata includes:
          - affine: rasterio Affine transform (maps pixel→lng/lat in EPSG:4326)
          - crs: "EPSG:4326"
          - bounds: the input bbox
          - resolution: the input resolution string

    Raises:
        ValueError: If resolution is not recognized.
        RuntimeError: If DEM tiles cannot be fetched.
    """
    zoom = ZOOM_MAP.get(resolution)
    if zoom is None:
        raise ValueError(f"Unknown resolution: {resolution}. Use '30m' or '90m'.")

    tile_paths = _fetch_dem_tiles(bbox, zoom)

    src_files = [rasterio.open(p) for p in tile_paths]
    try:
        mosaic_3857, trans_3857 = merge(src_files)
    finally:
        for src in src_files:
            src.close()

    # Transform bbox from 4326 → 3857 to define the output region
    # in the source CRS for reprojection
    bounds_3857 = transform_bounds(
        DST_CRS, SRC_CRS,
        bbox["west"], bbox["south"], bbox["east"], bbox["north"],
    )

    # Compute the output transform and dimensions in EPSG:4326
    dst_transform, dst_width, dst_height = calculate_default_transform(
        SRC_CRS, DST_CRS,
        mosaic_3857.shape[2], mosaic_3857.shape[1],
        left=bounds_3857[0], bottom=bounds_3857[1],
        right=bounds_3857[2], top=bounds_3857[3],
    )

    dst_array = np.zeros(
        (mosaic_3857.shape[0], dst_height, dst_width), dtype=mosaic_3857.dtype
    )

    reproject(
        source=mosaic_3857,
        destination=dst_array,
        src_transform=trans_3857,
        src_crs=SRC_CRS,
        dst_transform=dst_transform,
        dst_crs=DST_CRS,
        resampling=Resampling.bilinear,
    )

    metadata = {
        "affine": dst_transform,
        "crs": DST_CRS,
        "bounds": bbox,
        "resolution": resolution,
    }

    return dst_array[0], metadata


def fetch_dem(bbox: dict, resolution: str = "30m") -> np.ndarray:
    """Fetch DEM for a bounding box.

    Convenience wrapper around :func:`fetch_dem_raster` that returns only
    the elevation array (no geospatial metadata).

    Args:
        bbox: dict with keys west, south, east, north (float degrees).
        resolution: "30m" (default) or "90m".

    Returns:
        2D numpy array of elevation values in meters.
    """
    elevation, _ = fetch_dem_raster(bbox, resolution)
    return elevation
