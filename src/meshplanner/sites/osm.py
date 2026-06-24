"""Import candidate sites from OpenStreetMap (schools, towers, etc.).

Uses the Overpass API directly with a fallback to osmnx when available
(install via ``pip install meshplanner[osm]``).

Queries both OSM nodes and ways for each requested tag, returning
``CandidateSite`` objects with human-readable names.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Optional

import requests

from meshplanner.sites.candidate import CandidateSite

__all__ = ["fetch_osm_sites"]

# ── Logging ───────────────────────────────────────────────────────────────────

logger = logging.getLogger(__name__)

# ── Tag specifications ────────────────────────────────────────────────────────
#
# Each entry maps a short user-facing tag identifier to:
#   [(osm_key, osm_value), ...]   (AND conditions for the Overpass query)
#
# The "label" is used when no ``name`` tag exists on the OSM element.

TAG_SPEC: dict[str, tuple[list[tuple[str, str]], str]] = {
    "fire_station": (
        [("amenity", "fire_station")],
        "Fire Station",
    ),
    "school": (
        [("amenity", "school")],
        "School",
    ),
    "hospital": (
        [("amenity", "hospital")],
        "Hospital",
    ),
    "communication_tower": (
        [("man_made", "tower"), ("tower:type", "communication")],
        "Communication Tower",
    ),
    "water_tower": (
        [("man_made", "water_tower")],
        "Water Tower",
    ),
}

DEFAULT_TAGS = list(TAG_SPEC.keys())

# ── Overpass API constants ────────────────────────────────────────────────────

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
REQUEST_TIMEOUT = 30  # seconds
RATE_LIMIT_SLEEP = 1.0  # minimum seconds between requests
USER_AGENT = "MeshPlanner/0.1 (+https://github.com/meshplanner)"


# ── Internals: tag handling ──────────────────────────────────────────────────


def _resolve_tag(tag: str) -> tuple[list[tuple[str, str]], str]:
    """Resolve a user-supplied tag to (query_conditions, label).

    Three formats are accepted:

    1. **Short identifier** — looked up in :data:`TAG_SPEC`.
    2. ``key=value`` string — parsed directly as a single condition.
    3. **Unknown identifier** — treated as ``amenity=<tag>``.
    """
    if "=" in tag:
        key, value = tag.split("=", 1)
        return [(key.strip(), value.strip())], value.strip().replace("_", " ").title()

    if tag in TAG_SPEC:
        return TAG_SPEC[tag]

    # Fallback: treat as an amenity value
    logger.debug("Unknown OSM tag %r — treating as amenity=%s", tag, tag)
    return [(("amenity", tag))], tag.replace("_", " ").title()


def _parse_tags(tags: Optional[list[str]]) -> list[tuple[list[tuple[str, str]], str]]:
    """Normalise *tags* to a list of (conditions, label) pairs.

    If *tags* is ``None`` or empty, the built-in defaults are used.
    """
    if not tags:
        tags = list(DEFAULT_TAGS)

    return [_resolve_tag(t) for t in tags]


# ── Internals: Overpass query building ───────────────────────────────────────


def _build_overpass_query(
    bbox: dict[str, float],
    resolved_tags: list[tuple[list[tuple[str, str]], str]],
) -> str:
    """Build an Overpass QL query string for the given tags.

    Both ``node`` and ``way`` elements are queried; ``out center`` is used
    so ways return a centre-point coordinate.
    """
    bbox_str = f"{bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']}"

    lines: list[str] = []
    for conditions, _label in resolved_tags:
        condition_str = "".join(f'["{k}"="{v}"]' for k, v in conditions)
        lines.append(f"  node{condition_str}({bbox_str});")
        lines.append(f"  way{condition_str}({bbox_str});")

    return "[out:json];\n(\n" + "\n".join(lines) + "\n);\nout center;\n"


# ── Internals: rate limiting ─────────────────────────────────────────────────

_last_request_time: float = 0.0


def _rate_limit() -> None:
    """Sleep if needed to honour the Overpass API rate limit."""
    global _last_request_time  # noqa: PLW0603
    now = time.monotonic()
    elapsed = now - _last_request_time
    if elapsed < RATE_LIMIT_SLEEP:
        time.sleep(RATE_LIMIT_SLEEP - elapsed)
    _last_request_time = time.monotonic()


# ── Internals: Overpass API call ─────────────────────────────────────────────


def _call_overpass(query: str) -> list[dict[str, Any]]:
    """Execute an Overpass QL query and return the parsed element list.

    Raises:
        requests.RequestException: On network / HTTP errors.
        ValueError: On malformed JSON or unexpected response structure.
    """
    _rate_limit()

    resp = requests.get(
        OVERPASS_URL,
        params={"data": query},
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": USER_AGENT},
    )

    if resp.status_code == 429:
        # Rate-limited: wait longer and retry once
        logger.warning("Overpass API returned 429 (rate limited). Waiting 5 s …")
        time.sleep(5.0)
        resp = requests.get(
            OVERPASS_URL,
            params={"data": query},
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": USER_AGENT},
        )

    resp.raise_for_status()

    data: Any = resp.json()
    if not isinstance(data, dict):
        raise ValueError(f"Overpass response is not a dict: {type(data).__name__}")

    elements = data.get("elements", [])
    if not isinstance(elements, list):
        raise ValueError(f"Overpass 'elements' is not a list: {type(elements).__name__}")

    return elements


# ── Internals: OSM element → CandidateSite conversion ────────────────────────


def _get_label_from_tags(tags: dict[str, str]) -> str:
    """Return a human-readable label for an OSM element's tag set."""
    # Check amenity tags
    amenity = tags.get("amenity", "")
    if amenity:
        return amenity.replace("_", " ").title()
    # Check man_made tags
    man_made = tags.get("man_made", "")
    if man_made:
        base = man_made.replace("_", " ").title()
        tower_type = tags.get("tower:type", "")
        if tower_type:
            return f"{tower_type.replace('_', ' ').title()} {base}"
        return base
    # Check tower:type alone (if man_made is missing)
    tower_type = tags.get("tower:type", "")
    if tower_type:
        return f"{tower_type.replace('_', ' ').title()} Tower"
    # Fallback to first tag value
    for val in tags.values():
        if val:
            return val.replace("_", " ").title()
    return "OSM Site"


def _element_to_site(element: dict[str, Any]) -> CandidateSite | None:
    """Convert a single OSM element dict to a ``CandidateSite``.

    Returns ``None`` for unsupported element types or missing coordinates.
    """
    elem_type = element.get("type", "")
    tags = element.get("tags") or {}

    # Extract lat/lon — nodes have them directly; ways have a "center" key
    # when ``out center`` is used.
    if elem_type == "node":
        lat = element.get("lat")
        lon = element.get("lon")
    elif elem_type == "way":
        center = element.get("center")
        if center is None:
            return None
        lat = center.get("lat")
        lon = center.get("lon")
    else:
        return None

    if lat is None or lon is None:
        return None

    # Build a human-readable name
    name = (tags.get("name") or "").strip()
    if not name:
        label = _get_label_from_tags(tags)
        osm_id = element.get("id", 0)
        name = f"{label} (OSM {osm_id})"

    elem_id = element.get("id", 0)
    notes = f"OSM element {elem_id} type={elem_type}"

    return CandidateSite(
        name=name,
        latitude=float(lat),
        longitude=float(lon),
        notes=notes,
    )


def _elements_to_sites(elements: list[dict[str, Any]]) -> list[CandidateSite]:
    """Batch-convert OSM elements to deduplicated ``CandidateSite`` objects."""
    sites: list[CandidateSite] = []
    seen_names: set[str] = set()

    for element in elements:
        site = _element_to_site(element)
        if site is None:
            continue

        # Deduplicate names (two different OSM elements may share a name)
        if site.name in seen_names:
            osm_id = element.get("id", 0)
            site = CandidateSite(
                name=f"{site.name} ({osm_id})",
                latitude=site.latitude,
                longitude=site.longitude,
                notes=site.notes,
            )
        seen_names.add(site.name)
        sites.append(site)

    return sites


# ── Internals: osmnx path ────────────────────────────────────────────────────


def _fetch_via_osmnx(
    bbox: dict[str, float],
    resolved_tags: list[tuple[list[tuple[str, str]], str]],
) -> list[CandidateSite] | None:
    """Query OSM via osmnx (if installed) and return ``CandidateSite`` objects.

    Returns ``None`` if osmnx is not available so the caller can fall through
    to the direct Overpass API path.
    """
    try:
        import osmnx as ox  # type: ignore[import-untyped]
    except ImportError:
        return None

    try:
        # osmnx expects tags as ``{key: [value1, value2, …]}``, grouping
        # all values for the same key together.  However, multiple conditions
        # for the same key (e.g. ``man_made=tower`` + ``tower:type=comm``)
        # cannot be expressed in osmnx's tag dict — we handle those via a
        # fallback to the Overpass API.
        #
        # For simple single-condition tags, we build the osmnx dict.
        grouped: dict[str, list[str]] = {}
        has_compound = False
        for conditions, _label in resolved_tags:
            if len(conditions) == 1:
                key, val = conditions[0]
                grouped.setdefault(key, []).append(val)
            else:
                has_compound = True

        if has_compound or not grouped:
            # Some tags need multi-condition queries that osmnx cannot
            # express — fall back to Overpass.
            return None

        _rate_limit()
        gdf = ox.features_from_bbox(
            north=bbox["north"],
            south=bbox["south"],
            east=bbox["east"],
            west=bbox["west"],
            tags=grouped,
        )
    except Exception:
        logger.debug("osmnx query failed, falling back to Overpass API", exc_info=True)
        return None

    if gdf is None or gdf.empty:
        return []

    sites: list[CandidateSite] = []
    seen_names: set[str] = set()

    for _idx, row in gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        # Extract a representative point
        if geom.geom_type == "Point":
            lon, lat = geom.x, geom.y
        elif geom.geom_type in ("Polygon", "MultiPolygon"):
            centroid = geom.centroid
            lon, lat = centroid.x, centroid.y
        elif geom.geom_type == "MultiPoint":
            # Use the first point
            pts = list(geom.geoms)
            lon, lat = pts[0].x, pts[0].y
        elif geom.geom_type == "LineString":
            lon, lat = geom.centroid.x, geom.centroid.y
        else:
            continue

        # Build name from osmnx columns
        tags_dict = dict(row.drop("geometry").dropna()) if hasattr(row, "drop") else {}

        name_raw = tags_dict.get("name", "")
        name = str(name_raw).strip() if name_raw else ""
        if not name:
            label = _get_label_from_tags(tags_dict)
            osm_id = tags_dict.get("osmid", _idx)
            name = f"{label} (OSM {osm_id})"

        # Deduplicate names
        if name in seen_names:
            osm_id = tags_dict.get("osmid", _idx)
            name = f"{name} ({osm_id})"
        seen_names.add(name)

        try:
            site = CandidateSite(
                name=name,
                latitude=float(lat),
                longitude=float(lon),
                notes="OSM element from osmnx",
            )
        except (ValueError, TypeError):
            continue

        sites.append(site)

    return sites


# ── Internals: direct Overpass API path ──────────────────────────────────────


def _fetch_via_overpass(
    bbox: dict[str, float],
    resolved_tags: list[tuple[list[tuple[str, str]], str]],
) -> list[CandidateSite]:
    """Query OSM via the direct Overpass API.

    This is the fallback path used when osmnx is not available or when
    compound tag conditions (e.g. ``man_made=tower`` + ``tower:type=comm``)
    are requested.
    """
    query = _build_overpass_query(bbox, resolved_tags)
    logger.debug("Overpass query:\n%s", query)

    try:
        elements = _call_overpass(query)
    except requests.exceptions.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else 0
        logger.warning("Overpass API HTTP %s error: %s", status, exc)
        return []
    except requests.exceptions.Timeout:
        logger.warning("Overpass API request timed out after %ss", REQUEST_TIMEOUT)
        return []
    except requests.exceptions.RequestException as exc:
        logger.warning("Overpass API network error: %s", exc)
        return []
    except ValueError as exc:
        logger.warning("Overpass API response parse error: %s", exc)
        return []

    if not elements:
        logger.info("No OSM elements found for the given bounding box and tags.")
        return []

    return _elements_to_sites(elements)


# ── Public API ────────────────────────────────────────────────────────────────


def fetch_osm_sites(
    bbox: dict[str, float],
    tags: Optional[list[str]] = None,
) -> list[CandidateSite]:
    """Query OpenStreetMap for candidate sites (fire stations, schools, etc.).

    The function attempts two strategies in order:

    1. **osmnx** (if ``pip install meshplanner[osm]``) — faster, higher-level.
       Falls through to Overpass for compound tag queries (e.g.
       ``communication_tower`` is ``man_made=tower`` + ``tower:type=comm``)
       that osmnx cannot express.

    2. **Direct Overpass API** — always available as a fallback.

    Rate limiting is enforced at a maximum of **1 request per second** to
    respect the `Overpass API usage policy
    <https://overpass-api.de/command_line.html>`_.

    Args:
        bbox:
            Bounding box with keys ``west``, ``south``, ``east``, ``north``
            (decimal degrees).  Example::

                {"west": -82.6, "south": 35.5, "east": -82.4, "north": 35.7}

        tags:
            List of OSM tag identifiers to query.  Each entry can be:

            - A **short identifier** from the built-in mapping:
              ``fire_station``, ``school``, ``hospital``,
              ``communication_tower``, ``water_tower``.
            - An explicit ``"key=value"`` string
              (e.g. ``"amenity=police"``).

            Defaults to ``["fire_station", "school", "hospital",
            "communication_tower", "water_tower"]``.

    Returns:
        List of :class:`~meshplanner.sites.candidate.CandidateSite` objects.
        Returns an **empty list** on any failure (network error, rate limiting,
        malformed response) — this function never raises.

    Example:
        >>> from meshplanner.sites.osm import fetch_osm_sites
        >>> bbox = {"west": -82.6, "south": 35.5, "east": -82.4, "north": 35.7}
        >>> sites = fetch_osm_sites(bbox)
        >>> len(sites)
        42
        >>> sites[0]
        CandidateSite(name='Asheville Fire Station #1', latitude=35.595, ...)
    """  # noqa: E501
    try:
        resolved = _parse_tags(tags)
    except Exception as exc:
        logger.warning("Failed to parse OSM tags %r: %s", tags, exc)
        return []

    # Strategy 1: try osmnx (handles simple single-condition tags only)
    try:
        result = _fetch_via_osmnx(bbox, resolved)
        if result is not None:
            logger.info("Found %d OSM candidate sites via osmnx.", len(result))
            return result
    except Exception:
        logger.debug("osmnx path failed, falling through to Overpass", exc_info=True)

    # Strategy 2: direct Overpass API (handles everything)
    result = _fetch_via_overpass(bbox, resolved)
    logger.info("Found %d OSM candidate sites via Overpass API.", len(result))
    return result
