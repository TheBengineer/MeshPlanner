"""Local disk cache for fetched DEM tiles."""

import shutil
from pathlib import Path

CACHE_DIR = Path.home() / ".meshplanner" / "dem_cache"


def get_cache_size() -> int:
    """Return total cached DEM data size in bytes."""
    if not CACHE_DIR.exists():
        return 0
    total = 0
    for f in CACHE_DIR.rglob("*.tif"):
        total += f.stat().st_size
    return total


def clear_cache():
    """Clear all cached DEM tiles."""
    if CACHE_DIR.exists():
        shutil.rmtree(CACHE_DIR)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def get_cache_path(zoom: int, x: int, y: int) -> Path:
    """Get cache file path for a tile.

    Creates the zoom-level subdirectory if it doesn't exist.

    Args:
        zoom: Tile zoom level (11 for ~90m, 12 for ~30m).
        x: Tile x coordinate.
        y: Tile y coordinate.

    Returns:
        Path to the cached tile file.
    """
    cache_dir = CACHE_DIR / str(zoom)
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / f"{x}_{y}.tif"


def is_cached(zoom: int, x: int, y: int) -> bool:
    """Check if a tile is already cached.

    Args:
        zoom: Tile zoom level.
        x: Tile x coordinate.
        y: Tile y coordinate.

    Returns:
        True if the tile exists in cache, False otherwise.
    """
    return get_cache_path(zoom, x, y).exists()
