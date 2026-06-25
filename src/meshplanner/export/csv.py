"""Export per-site metrics and summaries to CSV."""

import csv
from pathlib import Path
from typing import Any


def export_csv(
    sites: list[dict[str, Any]],
    metrics: dict[str, Any],
    output_path: str,
) -> str:
    """Export per-site metrics to CSV.

    Produces a CSV with one row per selected site containing its name,
    coordinates, elevation, and notes.  The *metrics* dict is used for a
    summary comment row at the bottom of the file.

    Args:
        sites: List of dicts, each with at least ``name``, ``latitude``,
            ``longitude``.  Optional keys: ``elevation_m``, ``notes``.
        metrics: Dict with optimisation result metadata (typically the
            ``final`` sub-dict from a warm-start result).
        output_path: Destination file path (``.csv``).

    Returns:
        Absolute path to the written file.
    """
    path = Path(output_path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = ["name", "latitude", "longitude", "elevation_m", "notes"]

    with open(str(path), "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for site in sites:
            row: dict[str, Any] = {
                "name": site["name"],
                "latitude": site["latitude"],
                "longitude": site["longitude"],
                "elevation_m": site.get("elevation_m", ""),
                "notes": site.get("notes", ""),
            }
            writer.writerow(row)

        # Footer comment row with summary metrics
        covered = metrics.get("covered_fraction", 0.0)
        source = metrics.get("source", "")
        writer.writerow({})  # blank separator
        writer.writerow({
            "name": f"# Coverage fraction: {covered:.4f}",
            "latitude": "",
            "longitude": "",
            "elevation_m": "",
            "notes": f"source: {source}",
        })

    return str(path)
