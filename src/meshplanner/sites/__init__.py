"""Candidate site generation from grids, OSM, hilltop analysis, and CSV/GeoJSON I/O."""

from meshplanner.sites.candidate import (
    CandidateSite,
    read_sites_csv,
    read_sites_geojson,
    write_sites_csv,
    write_sites_geojson,
)
from meshplanner.sites.osm import fetch_osm_sites

__all__ = [
    "CandidateSite",
    "read_sites_csv",
    "write_sites_csv",
    "read_sites_geojson",
    "write_sites_geojson",
    "fetch_osm_sites",
]
