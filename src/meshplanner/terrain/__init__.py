"""Terrain data fetching, caching, and profile extraction."""

from meshplanner.terrain.cache import clear_cache, get_cache_path, get_cache_size, is_cached
from meshplanner.terrain.fetch import fetch_dem, fetch_dem_raster

__all__ = [
    "clear_cache",
    "fetch_dem",
    "fetch_dem_raster",
    "get_cache_path",
    "get_cache_size",
    "is_cached",
]
