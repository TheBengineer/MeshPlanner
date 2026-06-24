"""Candidate site data model and CSV/GeoJSON I/O."""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


def _validate_name(name: str) -> str:
    if not name or not isinstance(name, str):
        raise ValueError(f"Invalid site name: {name!r}")
    return name


def _validate_latitude(lat: float) -> float:
    lat_f = float(lat)
    if not (-90.0 <= lat_f <= 90.0):
        raise ValueError(f"Latitude {lat_f} out of range [-90, 90]")
    return lat_f


def _validate_longitude(lon: float) -> float:
    lon_f = float(lon)
    if not (-180.0 <= lon_f <= 180.0):
        raise ValueError(f"Longitude {lon_f} out of range [-180, 180]")
    return lon_f


def _validate_no_duplicates(sites: Iterable[CandidateSite]) -> None:
    names = [s.name for s in sites]
    seen = set()
    dups = {n for n in names if n in seen or (seen.add(n), False)[1]}  # noqa
    if dups:
        raise ValueError(f"Duplicate site names: {sorted(dups)}")


@dataclass
class CandidateSite:
    """Represents a potential LoRa gateway/repeater location.

    Attributes:
        name: Human-readable identifier for this site.
        latitude: WGS84 latitude in degrees (-90 .. 90).
        longitude: WGS84 longitude in degrees (-180 .. 180).
        elevation_m: Optional ground elevation in metres above sea level.
        notes: Optional free-text notes.
    """

    name: str = field(repr=True)
    latitude: float = field(repr=True)
    longitude: float = field(repr=True)
    elevation_m: float | None = field(default=None, repr=True)
    notes: str | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        _validate_name(self.name)
        self.latitude = _validate_latitude(self.latitude)
        self.longitude = _validate_longitude(self.longitude)
        if self.elevation_m is not None:
            self.elevation_m = float(self.elevation_m)


# ── CSV reader ──────────────────────────────────────────────────────────────

_REQUIRED_CSV_COLUMNS = {"name", "lat", "lon"}
_OPTIONAL_CSV_COLUMNS = {"elevation", "notes"}
_COLUMN_ALIASES = {
    "latitude": "lat",
    "longitude": "lon",
}


def read_sites_csv(path: str | Path) -> list[CandidateSite]:
    """Read candidate sites from a CSV file.

    The CSV **must** contain a header row with at least ``name``, ``lat``,
    and ``lon`` columns.  Optional columns: ``elevation``, ``notes``.

    Args:
        path: Path to the CSV file.

    Returns:
        List of ``CandidateSite`` instances.

    Raises:
        FileNotFoundError: The file does not exist.
        ValueError: Missing required columns, invalid coordinate values,
            or duplicate site names.
    """
    path = Path(path)

    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            return []

        # Normalise column names (accept lat/latitude, lon/longitude/lng)
        normalized = [_normalise_column(c) for c in reader.fieldnames]
        col_map = dict(zip(reader.fieldnames, normalized))

        present = set(normalized)
        missing = _REQUIRED_CSV_COLUMNS - present
        if missing:
            raise ValueError(
                f"CSV missing required columns {sorted(missing)}. "
                f"Found columns: {sorted(present)}"
            )

        name_key = _find_key(col_map, "name")
        lat_key = _find_key(col_map, "lat")
        lon_key = _find_key(col_map, "lon")
        elev_key = _find_key(col_map, "elevation")
        notes_key = _find_key(col_map, "notes")

        sites: list[CandidateSite] = []
        for row_num, row in enumerate(reader, start=2):
            try:
                name_str = row[name_key].strip() if name_key else ""  # type: ignore[arg-type]
                lat_str = row[lat_key].strip() if lat_key else ""  # type: ignore[arg-type]
                lon_str = row[lon_key].strip() if lon_key else ""  # type: ignore[arg-type]
            except KeyError as exc:
                raise ValueError(
                    f"Row {row_num}: missing column {exc}"
                ) from exc

            elev_str = row[elev_key].strip() if elev_key else ""  # type: ignore[arg-type]
            notes_str = row[notes_key].strip() if notes_key else ""  # type: ignore[arg-type]

            try:
                site = CandidateSite(
                    name=name_str,
                    latitude=float(lat_str),
                    longitude=float(lon_str),
                    elevation_m=float(elev_str) if elev_str else None,
                    notes=notes_str if notes_str else None,
                )
            except (ValueError, TypeError) as exc:
                raise ValueError(
                    f"Error parsing row {row_num}: {exc}"
                ) from exc

            sites.append(site)

    _validate_no_duplicates(sites)
    return sites


def _normalise_column(col: str) -> str:
    """Map column-name variants to canonical names."""
    col = col.strip().lower()
    return _COLUMN_ALIASES.get(col, col)


def _find_key(mapping: dict[str, str], target: str) -> str | None:
    for orig, norm in mapping.items():
        if norm == target:
            return orig
    return None


# ── CSV writer ──────────────────────────────────────────────────────────────

_CSV_FIELD_ORDER = ["name", "lat", "lon", "elevation", "notes"]


def write_sites_csv(sites: list[CandidateSite], path: str | Path) -> None:
    """Write candidate sites to a CSV file.

    Args:
        sites: List of candidate sites to write.
        path: Destination file path.
    """
    _validate_no_duplicates(sites)
    path = Path(path)

    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=_CSV_FIELD_ORDER)
        writer.writeheader()
        for site in sites:
            writer.writerow({
                "name": site.name,
                "lat": site.latitude,
                "lon": site.longitude,
                "elevation": site.elevation_m if site.elevation_m is not None else "",
                "notes": site.notes if site.notes is not None else "",
            })


# ── GeoJSON reader ──────────────────────────────────────────────────────────


def read_sites_geojson(path: str | Path) -> list[CandidateSite]:
    """Read candidate sites from a GeoJSON FeatureCollection.

    Each feature **must** have ``Point`` geometry with ``[lon, lat]``
    coordinates.  Properties may include ``name`` (required), ``elevation_m``,
    and ``notes``.

    Args:
        path: Path to the GeoJSON file.

    Returns:
        List of ``CandidateSite`` instances.

    Raises:
        FileNotFoundError: The file does not exist.
        ValueError: Invalid structure, missing properties, or invalid
            coordinate values.
    """
    path = Path(path)

    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)

    if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
        raise ValueError(
            "GeoJSON root must be a FeatureCollection "
            f"(got type={data.get('type', 'N/A')!r})"
        )

    features = data.get("features", [])
    if not isinstance(features, list):
        raise ValueError("GeoJSON FeatureCollection must contain a 'features' array")

    sites: list[CandidateSite] = []
    for idx, feature in enumerate(features):
        if not isinstance(feature, dict):
            raise ValueError(f"Feature {idx} is not a JSON object")

        props = feature.get("properties") or {}
        geom = feature.get("geometry")

        name = props.get("name", "")
        if not name:
            raise ValueError(f"Feature {idx} missing required property 'name'")

        if not isinstance(geom, dict) or geom.get("type") != "Point":
            raise ValueError(
                f"Feature {idx} ('{name}'): geometry must be a Point, "
                f"got {geom.get('type', 'N/A') if isinstance(geom, dict) else type(geom).__name__!r}"
            )

        coords = geom.get("coordinates")
        if not isinstance(coords, (list, tuple)) or len(coords) < 2:
            raise ValueError(
                f"Feature {idx} ('{name}'): Point coordinates must have "
                f"at least [lon, lat]"
            )

        lon, lat = coords[0], coords[1]
        elevation = props.get("elevation_m")

        try:
            site = CandidateSite(
                name=name,
                latitude=lat,
                longitude=lon,
                elevation_m=float(elevation) if elevation is not None else None,
                notes=props.get("notes"),
            )
        except (ValueError, TypeError) as exc:
            raise ValueError(f"Error parsing feature {idx} ('{name}'): {exc}") from exc

        sites.append(site)

    _validate_no_duplicates(sites)
    return sites


# ── GeoJSON writer ──────────────────────────────────────────────────────────


def write_sites_geojson(sites: list[CandidateSite], path: str | Path) -> None:
    """Write candidate sites to a GeoJSON FeatureCollection file.

    Args:
        sites: List of candidate sites to write.
        path: Destination file path.
    """
    _validate_no_duplicates(sites)
    path = Path(path)

    features = []
    for site in sites:
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [site.longitude, site.latitude],
            },
            "properties": {
                "name": site.name,
            },
        }
        if site.elevation_m is not None:
            feature["properties"]["elevation_m"] = site.elevation_m
        if site.notes is not None:
            feature["properties"]["notes"] = site.notes

        features.append(feature)

    collection = {
        "type": "FeatureCollection",
        "features": features,
    }

    with path.open("w", encoding="utf-8") as fh:
        json.dump(collection, fh, indent=2, ensure_ascii=False)
