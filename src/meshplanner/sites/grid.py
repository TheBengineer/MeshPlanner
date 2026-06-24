"""Generate regular grid of candidate sites.

Converts km spacing to lat/lon step sizes using the haversine approximation:
    - 1 degree latitude  ≈ 111.32 km (constant)
    - 1 degree longitude ≈ 111.32 * cos(lat) km (depends on latitude)
"""

import math

from shapely.geometry import Point, Polygon

from meshplanner.sites.candidate import CandidateSite


def generate_grid(
    bbox: dict[str, float],
    spacing_km: float = 1.0,
    name_prefix: str = "Grid",
) -> list[CandidateSite]:
    """Generate a regular grid of candidate sites within a bounding box.

    Args:
        bbox: Bounding box with keys {"west", "south", "east", "north"} (decimal degrees).
        spacing_km: Target spacing between adjacent sites in kilometres.
        name_prefix: Prefix for site names (default "Grid").

    Returns:
        List of CandidateSite objects named "{prefix}-{row}-{col}".
    """
    west = bbox["west"]
    south = bbox["south"]
    east = bbox["east"]
    north = bbox["north"]

    # Use the midpoint latitude for longitude step calculation
    mid_lat = (south + north) / 2.0
    lat_rad = math.radians(mid_lat)

    lat_step = spacing_km / 111.32
    lon_step = spacing_km / (111.32 * math.cos(lat_rad))

    # Guard against degenerate bounding boxes
    if lat_step <= 0 or lon_step <= 0:
        return []
    if north <= south or east <= west:
        return []

    sites: list[CandidateSite] = []

    # Generate rows from south to north
    lat = south
    row = 0
    while lat <= north:
        lon = west
        col = 0
        while lon <= east:
            name = f"{name_prefix}-{row}-{col}"
            sites.append(CandidateSite(lat=lat, lon=lon, name=name))
            lon += lon_step
            col += 1
        lat += lat_step
        row += 1

    return sites


def generate_grid_within_polygon(
    polygon_coords: list[tuple[float, float]],
    spacing_km: float = 1.0,
) -> list[CandidateSite]:
    """Generate a regular grid of candidate sites within an arbitrary polygon.

    A bounding-box grid is created first, then sites falling outside the
    polygon are filtered out via shapely's ``Point.within()`` test.

    Args:
        polygon_coords: List of (longitude, latitude) tuples defining the polygon
                        boundary (in clockwise or counter-clockwise order).
        spacing_km: Target spacing between adjacent sites in kilometres.

    Returns:
        List of CandidateSite objects that lie inside the polygon.
    """
    if len(polygon_coords) < 3:
        return []

    polygon = Polygon(polygon_coords)

    # Compute bounding box of the polygon
    lons = [p[0] for p in polygon_coords]
    lats = [p[1] for p in polygon_coords]
    bbox = {
        "west": min(lons),
        "south": min(lats),
        "east": max(lons),
        "north": max(lats),
    }

    # Generate full grid within the bbox
    all_sites = generate_grid(bbox, spacing_km=spacing_km, name_prefix="Grid")

    # Keep only sites inside the polygon
    sites: list[CandidateSite] = []
    for site in all_sites:
        point = Point(site.lon, site.lat)
        if point.within(polygon):
            sites.append(site)

    return sites
