/**
 * Import candidate sites from OpenStreetMap (schools, towers, etc.).
 *
 * Uses the Overpass API directly (no osmnx — browser-compatible).
 * Queries both OSM nodes and ways for each requested tag, returning
 * {@link CandidateSite} objects with human-readable names.
 *
 * @module
 */

import type { Bbox, CandidateSite } from "../types"

// ── Types ──

interface TagSpec {
  conditions: [string, string][]
  label: string
}

export interface ResolvedTag {
  conditions: [string, string][]
  label: string
}

interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  center?: { lat: number; lon: number }
}

interface OverpassResponse {
  elements?: OverpassElement[]
}

// ── Tag specifications ──
//
// Each entry maps a short user-facing tag identifier to:
//   [osm_key, osm_value][]   (AND conditions for the Overpass query)
//
// The "label" is used when no ``name`` tag exists on the OSM element.

const TAG_SPEC: Record<string, TagSpec> = {
  fire_station: {
    conditions: [["amenity", "fire_station"]],
    label: "Fire Station",
  },
  school: {
    conditions: [["amenity", "school"]],
    label: "School",
  },
  hospital: {
    conditions: [["amenity", "hospital"]],
    label: "Hospital",
  },
  police: {
    conditions: [["amenity", "police"]],
    label: "Police Station",
  },
  town_hall: {
    conditions: [["amenity", "townhall"]],
    label: "Town Hall",
  },
  tower: {
    conditions: [["man_made", "tower"]],
    label: "Tower",
  },
  water_tower: {
    conditions: [["man_made", "water_tower"]],
    label: "Water Tower",
  },
}

const DEFAULT_TAGS: readonly string[] = Object.keys(TAG_SPEC)

// ── Overpass API constants ──

const OVERPASS_URL = "https://overpass-api.de/api/interpreter"
const REQUEST_TIMEOUT_MS = 30_000
const RATE_LIMIT_MS = 1_000
const USER_AGENT = "MeshPlanner/0.1 (+https://github.com/meshplanner)"

// ── General helpers ──

/** Convert ``snake_case`` to ``Title Case``. */
function toTitle(s: string): string {
  return s
    .split("_")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Tag handling ──

/**
 * Resolve a user-supplied tag to (query_conditions, label).
 *
 * Three formats are accepted:
 *
 * 1. **Short identifier** — looked up in the built-in tag map.
 * 2. ``key=value`` string — parsed directly as a single condition.
 * 3. **Unknown identifier** — treated as ``amenity=<tag>``.
 */
export function resolveTag(tag: string): ResolvedTag {
  const eqIdx = tag.indexOf("=")
  if (eqIdx >= 0) {
    const key = tag.slice(0, eqIdx).trim()
    const value = tag.slice(eqIdx + 1).trim()
    return { conditions: [[key, value]], label: toTitle(value) }
  }

  const spec = TAG_SPEC[tag]
  if (spec) {
    return {
      conditions: spec.conditions.map((c) => [c[0], c[1]] as [string, string]),
      label: spec.label,
    }
  }

  // Fallback: treat as an amenity value
  return { conditions: [["amenity", tag]], label: toTitle(tag) }
}

/**
 * Normalise *tags* to a list of (conditions, label) pairs.
 *
 * If *tags* is ``undefined`` or empty, the built-in defaults are used.
 * Duplicate conditions are deduplicated.
 */
export function parseTags(tags?: string[]): ResolvedTag[] {
  const input = tags && tags.length > 0 ? tags : DEFAULT_TAGS
  const seen = new Set<string>()
  const result: ResolvedTag[] = []
  for (const t of input) {
    const r = resolveTag(t)
    const key = JSON.stringify(r.conditions)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(r)
    }
  }
  return result
}

// ── Overpass query building ──

/**
 * Build an Overpass QL query string for the given tags and bounding box.
 *
 * Both ``node`` and ``way`` elements are queried; ``out center`` is used
 * so ways return a centre-point coordinate.
 */
export function buildOverpassQuery(bbox: Bbox, resolvedTags: ResolvedTag[]): string {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`

  const lines: string[] = []
  for (const { conditions } of resolvedTags) {
    const conditionStr = conditions.map(([k, v]) => `["${k}"="${v}"]`).join("")
    lines.push(`  node${conditionStr}(${bboxStr});`)
    lines.push(`  way${conditionStr}(${bboxStr});`)
  }

  return `[out:json];\n(\n${lines.join("\n")}\n);\nout center;\n`
}

// ── Rate limiting ──

let lastRequestTime = 0

async function rateLimit(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed)
  }
  lastRequestTime = Date.now()
}

// ── Overpass API call ──

/**
 * Execute an Overpass QL query and return the parsed element list.
 *
 * Throws on network / HTTP errors, 429 (after one retry), or malformed responses.
 */
async function callOverpass(query: string): Promise<OverpassElement[]> {
  await rateLimit()

  const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`
  const headers = { "User-Agent": USER_AGENT }

  let resp: Response
  try {
    resp = await fetch(url, { headers })
  } catch {
    throw new Error("Overpass API network error")
  }

  // Retry once on 429
  if (resp.status === 429) {
    await sleep(5_000)
    try {
      resp = await fetch(url, { headers })
    } catch {
      throw new Error("Overpass API network error on retry")
    }
  }

  if (!resp.ok) {
    throw new Error(`Overpass API HTTP ${resp.status}`)
  }

  let data: unknown
  try {
    data = await resp.json()
  } catch {
    throw new Error("Overpass API returned invalid JSON")
  }

  if (typeof data !== "object" || data === null) {
    throw new Error(`Overpass response is not a dict: ${typeof data}`)
  }

  const elements = (data as OverpassResponse).elements
  if (!Array.isArray(elements)) {
    throw new Error(`Overpass 'elements' is not a list`)
  }

  return elements
}

// ── OSM element → CandidateSite conversion ──

/**
 * Return a human-readable label for an OSM element's tag set.
 */
export function getLabelFromTags(tags: Record<string, string | undefined>): string {
  // Check amenity tags
  const amenity = tags.amenity ?? ""
  if (amenity) {
    return toTitle(amenity)
  }

  // Check man_made tags
  const manMade = tags.man_made ?? ""
  if (manMade) {
    const base = toTitle(manMade)
    const towerType = tags["tower:type"]
    if (towerType) {
      return `${toTitle(towerType)} ${base}`
    }
    return base
  }

  // Check tower:type alone (if man_made is missing)
  const towerType = tags["tower:type"]
  if (towerType) {
    return `${toTitle(towerType)} Tower`
  }

  // Fallback to first tag value
  for (const val of Object.values(tags)) {
    if (val) {
      return toTitle(val)
    }
  }

  return "OSM Site"
}

/**
 * Convert a single OSM element dict to a ``CandidateSite``.
 *
 * Returns ``null`` for unsupported element types or missing coordinates.
 */
export function elementToSite(element: OverpassElement): CandidateSite | null {
  const elemType = element.type
  const tags = element.tags ?? {}

  // Extract lat/lon — nodes have them directly; ways have a "center" key
  // when ``out center`` is used.
  let lat: number | undefined
  let lon: number | undefined

  if (elemType === "node") {
    lat = element.lat
    lon = element.lon
  } else if (elemType === "way") {
    const center = element.center
    if (center === undefined) return null
    lat = center.lat
    lon = center.lon
  } else {
    return null
  }

  if (lat === undefined || lon === undefined) return null

  // Build a human-readable name
  let name = (tags.name ?? "").trim()
  if (!name) {
    const label = getLabelFromTags(tags)
    name = `${label} (OSM ${element.id})`
  }

  return {
    name,
    latitude: lat,
    longitude: lon,
    notes: `OSM element ${element.id} type=${elemType}`,
    siteType: "existing",
  }
}

/**
 * Batch-convert OSM elements to deduplicated ``CandidateSite`` objects.
 */
export function elementsToSites(elements: OverpassElement[]): CandidateSite[] {
  const sites: CandidateSite[] = []
  const seenNames = new Set<string>()

  for (const element of elements) {
    const site = elementToSite(element)
    if (site === null) continue

    // Deduplicate names (two different OSM elements may share a name)
    if (seenNames.has(site.name)) {
      sites.push({ ...site, name: `${site.name} (${element.id})` })
    } else {
      seenNames.add(site.name)
      sites.push(site)
    }
  }

  return sites
}

// ── Public API ──

/**
 * Query OpenStreetMap for candidate sites (fire stations, schools, towers, etc.).
 *
 * Rate limiting is enforced at **1 request per second** to respect the
 * Overpass API usage policy.
 *
 * @param bbox - Bounding box with keys ``west``, ``south``, ``east``, ``north``.
 * @param tags - List of OSM tag identifiers to query. Each entry can be:
 *   - A **short identifier** from the built-in mapping:
 *     ``fire_station``, ``school``, ``hospital``, ``tower``, ``water_tower``.
 *   - An explicit ``"key=value"`` string (e.g. ``"amenity=police"``).
 *   Defaults to all built-in tags.
 * @returns List of {@link CandidateSite} objects. Returns an **empty array** on
 *   any failure (network error, rate limiting, malformed response) — this
 *   function never throws.
 *
 * @example
 * ```ts
 * import { fetchOsmSites } from '@/lib/sites/osm'
 * const bbox = { west: -82.6, south: 35.5, east: -82.4, north: 35.7 }
 * const sites = await fetchOsmSites(bbox)
 * // sites: [{ name: 'Asheville Fire Station #1', latitude: 35.595, ... }]
 * ```
 */
export async function fetchOsmSites(bbox: Bbox, tags?: string[]): Promise<CandidateSite[]> {
  let resolved: ResolvedTag[]
  try {
    resolved = parseTags(tags)
  } catch {
    return []
  }

  const query = buildOverpassQuery(bbox, resolved)

  try {
    const elements = await callOverpass(query)
    if (elements.length === 0) return []
    return elementsToSites(elements)
  } catch {
    return []
  }
}

// ── Building footprint query ──

/**
 * Overpass API response element with full geometry (``out geom``).
 */
interface OverpassGeomElement {
  type: string
  id: number
  geometry: { lat: number; lon: number }[]
}

interface OverpassGeomResponse {
  elements?: OverpassGeomElement[]
}

/**
 * Query OpenStreetMap for building footprints within a bounding box.
 *
 * Uses Overpass API's ``out geom`` to retrieve full polygon geometry
 * for each building way. Returns polygon coordinates in ``[lng, lat]``
 * order (GeoJSON convention) and a count of buildings found.
 *
 * Rate limiting is enforced at **1 request per second** to respect the
 * Overpass API usage policy.
 *
 * @param bbox - Bounding box with keys ``west``, ``south``, ``east``, ``north``.
 * @param signal - Optional ``AbortSignal`` to cancel the request.
 * @returns Object with ``coordinates`` (array of polygon rings) and
 *   ``count`` of buildings. Returns ``{ coordinates: [], count: 0 }``
 *   on any failure — this function never throws.
 *
 * @example
 * ```ts
 * import { fetchOsmBuildings } from '@/lib/sites/osm'
 * const bbox = { west: -82.6, south: 35.5, east: -82.4, north: 35.7 }
 * const { coordinates, count } = await fetchOsmBuildings(bbox)
 * // coordinates[0] => [[-82.5, 35.6], [-82.49, 35.6], ...]
 * ```
 */
export async function fetchOsmBuildings(
  bbox: Bbox,
  signal?: AbortSignal,
): Promise<{ coordinates: [number, number][][]; count: number }> {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  const query = `[out:json];\nway["building"](${bboxStr});\nout geom;\n`

  await rateLimit()

  if (signal?.aborted) return { coordinates: [], count: 0 }

  const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`
  const headers = { "User-Agent": USER_AGENT }

  let resp: Response
  try {
    resp = await fetch(url, { headers, signal })
  } catch {
    return { coordinates: [], count: 0 }
  }

  // Retry once on 429
  if (resp.status === 429) {
    await sleep(5_000)
    if (signal?.aborted) return { coordinates: [], count: 0 }
    try {
      resp = await fetch(url, { headers, signal })
    } catch {
      return { coordinates: [], count: 0 }
    }
  }

  if (!resp.ok) {
    return { coordinates: [], count: 0 }
  }

  let data: unknown
  try {
    data = await resp.json()
  } catch {
    return { coordinates: [], count: 0 }
  }

  if (typeof data !== "object" || data === null) {
    return { coordinates: [], count: 0 }
  }

  const elements = (data as OverpassGeomResponse).elements
  if (!Array.isArray(elements)) {
    return { coordinates: [], count: 0 }
  }

  const coordinates: [number, number][][] = []
  for (const element of elements) {
    if (element.type !== "way" || !Array.isArray(element.geometry)) continue
    if (element.geometry.length < 3) continue

    const ring: [number, number][] = element.geometry.map(
      (pt) => [pt.lon, pt.lat] as [number, number],
    )

    // Close the ring if Overpass didn't (first === last is required for
    // valid GeoJSON polygons).
    const first = ring[0]!
    const last = ring[ring.length - 1]!
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]])
    }

    coordinates.push(ring)
  }

  return { coordinates, count: coordinates.length }
}
