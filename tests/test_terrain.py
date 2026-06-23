"""Tests for terrain module: DEM fetching, caching, and tile coordinate math."""

import numpy as np
import pytest

from meshplanner.terrain import (
    clear_cache,
    fetch_dem,
    fetch_dem_raster,
    get_cache_path,
    get_cache_size,
)
from meshplanner.terrain.fetch import ZOOM_MAP, _tile_coords

# ── Tile coordinate math ─────────────────────────────────────────────


@pytest.mark.parametrize(
    ("lon", "lat", "zoom", "expected"),
    [
        # Equator / prime meridian at different zooms
        (0.0, 0.0, 12, (2048, 2048)),
        (0.0, 0.0, 11, (1024, 1024)),
        (0.0, 0.0, 10, (512, 512)),
        (0.0, 0.0, 0, (0, 0)),
        # Known Asheville bbox corners (zoom 12)
        (-82.6, 35.7, 12, (1108, 1612)),
        (-82.4, 35.5, 12, (1110, 1615)),
        # Zoom 11 for same points (half the tiles)
        (-82.6, 35.7, 11, (554, 806)),
        (-82.4, 35.5, 11, (555, 807)),
            # International Date Line east side
            (179.9, 0.0, 12, (4094, 2048)),
            # Edge cases: near poles (should not crash, though rarely used)
            (0.0, 85.0, 12, (2048, 6)),
            (0.0, -85.0, 12, (2048, 4089)),
    ],
)
def test_tile_coords(lon, lat, zoom, expected):
    """Verify tile coordinate conversion for known lat/lon."""
    assert _tile_coords(lon, lat, zoom) == expected


def test_tile_coords_symmetry():
    """Verify round-trip: tile coords for same lon at different zooms scale by 2."""
    x12, y12 = _tile_coords(-82.5, 35.6, zoom=12)
    x11, y11 = _tile_coords(-82.5, 35.6, zoom=11)
    # Zoom 11 has half the tiles of zoom 12
    assert x11 == x12 // 2
    assert y11 == y12 // 2


# ── Zoom level resolution mapping ────────────────────────────────────


def test_zoom_map():
    """Verify resolution-to-zoom mapping."""
    assert ZOOM_MAP["30m"] == 12
    assert ZOOM_MAP["90m"] == 11


# ── Cache management ─────────────────────────────────────────────────


def test_cache_path():
    """Verify cache path structure for a tile."""
    # Use coordinates unlikely to be requested by any network test
    path = get_cache_path(12, 999, 999)
    assert path.name == "999_999.tif"
    assert "12" in str(path)
    assert path.exists() is False  # tile not downloaded yet


def test_cache_size_empty():
    """Verify get_cache_size returns 0 before any downloads."""
    clear_cache()
    assert get_cache_size() == 0


def test_clear_cache():
    """Verify clear_cache removes all cached tiles."""
    # Create a dummy file in cache
    path = get_cache_path(12, 9999, 9999)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("dummy")
    assert get_cache_size() > 0

    clear_cache()
    assert get_cache_size() == 0


# ── DEM fetching (network-dependent) ────────────────────────────────


@pytest.mark.network
def test_download_tile():
    """Download a single known SRTM tile and verify it exists on disk.

    This test requires internet access to AWS Open Data.
    """
    clear_cache()
    from meshplanner.terrain.fetch import _download_tile

    # Known tile covering part of Asheville, NC at zoom 12
    result = _download_tile(1108, 1613, 12)
    assert result is not None, "Tile download failed"
    assert result.endswith(".tif"), f"Expected GeoTIFF, got: {result}"

    # Verify the file exists and has reasonable size (> 1 KB)
    path = get_cache_path(12, 1108, 1613)
    assert path.exists()
    assert path.stat().st_size > 1024, "Tile file too small (likely an error response)"


@pytest.mark.network
@pytest.mark.slow
def test_fetch_dem_small_bbox():
    """Fetch a single-tile DEM for a tiny bbox around Asheville.

    Uses a small bounding box (~2 km) that falls within a single SRTM tile
    at zoom 12. Verifies the returned array has expected shape and valid
    elevation values.
    """
    # Tiny bbox entirely within one tile near Asheville
    bbox = {"west": -82.55, "south": 35.55, "east": -82.53, "north": 35.57}

    elevation = fetch_dem(bbox, resolution="30m")
    assert isinstance(elevation, np.ndarray)
    assert elevation.ndim == 2, f"Expected 2D array, got shape {elevation.shape}"
    assert elevation.size > 0, "Elevation array is empty"
    assert np.isfinite(elevation).any(), "All values are NaN or inf"
    # Asheville area elevations should be in a reasonable range (200-2000 m)
    valid = elevation[np.isfinite(elevation)]
    assert valid.min() > 0, f"Unexpected negative elevation: {valid.min()}"
    assert valid.max() < 3000, f"Elevation too high for Asheville: {valid.max()}"


@pytest.mark.network
@pytest.mark.slow
def test_fetch_dem_raster_metadata():
    """Verify fetch_dem_raster returns metadata dict with expected keys."""
    bbox = {"west": -82.55, "south": 35.55, "east": -82.53, "north": 35.57}

    elevation, meta = fetch_dem_raster(bbox, resolution="30m")
    assert isinstance(elevation, np.ndarray)
    assert isinstance(meta, dict)
    assert "affine" in meta
    assert "crs" in meta
    assert "bounds" in meta
    assert "resolution" in meta
    assert meta["crs"] == "EPSG:4326"
    assert meta["resolution"] == "30m"
    assert meta["bounds"] == bbox


@pytest.mark.network
@pytest.mark.slow
def test_fetch_dem_90m():
    """Verify zoom 11 (90m resolution) also works for a larger bbox."""
    # Use a larger bbox (~10 km) so resolution difference is visible
    bbox = {"west": -82.6, "south": 35.5, "east": -82.4, "north": 35.7}

    elevation_30m = fetch_dem(bbox, resolution="30m")
    elevation_90m = fetch_dem(bbox, resolution="90m")

    assert elevation_30m.ndim == 2
    assert elevation_90m.ndim == 2
    assert elevation_30m.size > 0
    assert elevation_90m.size > 0
    # 90m should be roughly 4× fewer pixels per side than 30m
    # (zoom 11 has 2× the pixel size of zoom 12, so 4× fewer total pixels)
    assert elevation_90m.size < elevation_30m.size, (
        f"Expected 90m array ({elevation_90m.size}) to be smaller "
        f"than 30m ({elevation_30m.size})"
    )


@pytest.mark.network
@pytest.mark.slow
def test_fetch_dem_ocean():
    """Verify fetch_dem over ocean returns all-nodata or zero-elevation values."""
    # Middle of the Pacific Ocean — tiles exist but should be ocean (zero/nodata)
    bbox = {"west": -170.0, "south": 0.0, "east": -169.0, "north": 1.0}

    elevation = fetch_dem(bbox, resolution="30m")
    assert isinstance(elevation, np.ndarray)
    assert elevation.ndim == 2
    assert elevation.size > 0
    # Ocean areas should have elevation ≈ 0 (or nodata = -32768 for SRTM)
    valid = elevation[elevation > -30000]
    # Most ocean values should be at or near sea level
    # (some may be nodata = -32768 which SRTM uses for water)
    assert np.median(valid) < 10, f"Ocean elevations too high: median={np.median(valid)}"


def test_fetch_dem_invalid_resolution():
    """Verify fetch_dem raises ValueError for unknown resolution."""
    bbox = {"west": -82.6, "south": 35.5, "east": -82.4, "north": 35.7}
    with pytest.raises(ValueError, match="Unknown resolution"):
        fetch_dem(bbox, resolution="invalid")

    with pytest.raises(ValueError, match="Unknown resolution"):
        fetch_dem(bbox, resolution="10m")


# ── Basic import test ────────────────────────────────────────────────


def test_terrain_imports():
    """Verify the terrain module imports without error."""
    from meshplanner import terrain as t

    assert hasattr(t, "fetch_dem")
    assert hasattr(t, "fetch_dem_raster")
    assert hasattr(t, "clear_cache")
    assert hasattr(t, "get_cache_size")
    assert hasattr(t, "get_cache_path")
    assert hasattr(t, "is_cached")
