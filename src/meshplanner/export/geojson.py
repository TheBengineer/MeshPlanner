"""Export results to GeoJSON format."""

import json
from pathlib import Path
from typing import Any


def export_geojson(
    sites: list[dict[str, Any]],
    coverage: dict[str, Any],
    output_path: str,
) -> str:
    """Export selected sites and coverage metrics as a GeoJSON FeatureCollection.

    Each selected site becomes a ``Point`` feature with its coordinates and
    properties (name, elevation, notes).  The top-level ``properties`` dict
    holds optimisation summary data (coverage fraction, source algorithm).

    Args:
        sites: List of dicts, each with at least ``name``, ``latitude``,
            ``longitude``.  Optional keys: ``elevation_m``, ``notes``.
        coverage: Dict with optimisation result metadata (typically the
            ``final`` sub-dict from a warm-start result).
        output_path: Destination file path (``.geojson``).

    Returns:
        Absolute path to the written file.
    """
    path = Path(output_path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)

    features = []
    for site in sites:
        feat: dict[str, Any] = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [site["longitude"], site["latitude"]],
            },
            "properties": {
                "name": site["name"],
            },
        }
        if site.get("elevation_m") is not None:
            feat["properties"]["elevation_m"] = site["elevation_m"]
        if site.get("notes"):
            feat["properties"]["notes"] = site["notes"]
        features.append(feat)

    collection: dict[str, Any] = {
        "type": "FeatureCollection",
        "features": features,
        "properties": {
            "coverage_fraction": coverage.get("covered_fraction", 0.0),
            "n_sites": len(sites),
            "source": coverage.get("source", ""),
        },
    }

    with open(str(path), "w", encoding="utf-8") as fh:
        json.dump(collection, fh, indent=2, ensure_ascii=False)

    return str(path)
