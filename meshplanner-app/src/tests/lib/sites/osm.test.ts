import {
  type ResolvedTag,
  buildOverpassQuery,
  elementToSite,
  elementsToSites,
  fetchOsmSites,
  getLabelFromTags,
  parseTags,
  resolveTag,
} from "@/lib/sites/osm"
import type { Bbox } from "@/lib/types"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockBbox: Bbox = { west: -82.6, south: 35.5, east: -82.4, north: 35.7 }

beforeEach(() => {
  vi.restoreAllMocks()
})

// ── resolveTag ──

describe("resolveTag", () => {
  it("resolves built-in fire_station", () => {
    const r = resolveTag("fire_station")
    expect(r.conditions).toEqual([["amenity", "fire_station"]])
    expect(r.label).toBe("Fire Station")
  })

  it("resolves built-in school", () => {
    const r = resolveTag("school")
    expect(r.conditions).toEqual([["amenity", "school"]])
    expect(r.label).toBe("School")
  })

  it("resolves built-in hospital", () => {
    const r = resolveTag("hospital")
    expect(r.conditions).toEqual([["amenity", "hospital"]])
    expect(r.label).toBe("Hospital")
  })

  it("resolves built-in tower", () => {
    const r = resolveTag("tower")
    expect(r.conditions).toEqual([["man_made", "tower"]])
    expect(r.label).toBe("Tower")
  })

  it("resolves built-in water_tower", () => {
    const r = resolveTag("water_tower")
    expect(r.conditions).toEqual([["man_made", "water_tower"]])
    expect(r.label).toBe("Water Tower")
  })

  it("parses key=value string", () => {
    const r = resolveTag("amenity=police")
    expect(r.conditions).toEqual([["amenity", "police"]])
    expect(r.label).toBe("Police")
  })

  it("parses key=value with whitespace", () => {
    const r = resolveTag("  building =  yes ")
    expect(r.conditions).toEqual([["building", "yes"]])
    expect(r.label).toBe("Yes")
  })

  it("parses compound tag key=value with underscores", () => {
    const r = resolveTag("tower:type=communication")
    expect(r.conditions).toEqual([["tower:type", "communication"]])
    expect(r.label).toBe("Communication")
  })

  it("falls back to amenity for unknown identifiers", () => {
    const r = resolveTag("police")
    expect(r.conditions).toEqual([["amenity", "police"]])
    expect(r.label).toBe("Police")
  })
})

// ── parseTags ──

describe("parseTags", () => {
  it("returns defaults when called without arguments", () => {
    const tags = parseTags()
    expect(tags).toHaveLength(5)
    const ids = tags.map((t) => t.label)
    expect(ids).toContain("Fire Station")
    expect(ids).toContain("School")
    expect(ids).toContain("Hospital")
    expect(ids).toContain("Tower")
    expect(ids).toContain("Water Tower")
  })

  it("returns defaults when called with empty array", () => {
    const tags = parseTags([])
    expect(tags).toHaveLength(5)
  })

  it("deduplicates identical conditions", () => {
    const tags = parseTags(["fire_station", "fire_station"])
    expect(tags).toHaveLength(1)
  })

  it("resolves mixed built-in and custom tags", () => {
    const tags = parseTags(["fire_station", "amenity=police"])
    expect(tags).toHaveLength(2)
    expect(tags[0]?.label).toBe("Fire Station")
    expect(tags[1]?.label).toBe("Police")
  })
})

// ── buildOverpassQuery ──

describe("buildOverpassQuery", () => {
  it("produces valid Overpass QL for a single tag", () => {
    const resolved = parseTags(["fire_station"])
    const query = buildOverpassQuery(mockBbox, resolved)
    expect(query).toContain("[out:json]")
    expect(query).toContain('node["amenity"="fire_station"]')
    expect(query).toContain('way["amenity"="fire_station"]')
    expect(query).toContain("out center;")
  })

  it("includes bbox in south,west,north,east order", () => {
    const resolved = parseTags(["fire_station"])
    const query = buildOverpassQuery(mockBbox, resolved)
    expect(query).toContain("(35.5,-82.6,35.7,-82.4)")
  })

  it("generates queries for multiple tags", () => {
    const resolved = parseTags(["fire_station", "school"])
    const query = buildOverpassQuery(mockBbox, resolved)
    expect(query).toContain('["amenity"="fire_station"]')
    expect(query).toContain('["amenity"="school"]')
    // Should have 4 lines: 2 node + 2 way
    const nodeMatches = query.match(/node\[/g)
    expect(nodeMatches).toHaveLength(2)
    const wayMatches = query.match(/way\[/g)
    expect(wayMatches).toHaveLength(2)
  })
})

// ── getLabelFromTags ──

describe("getLabelFromTags", () => {
  it("returns amenity label", () => {
    expect(getLabelFromTags({ amenity: "fire_station" })).toBe("Fire Station")
  })

  it("returns man_made label", () => {
    expect(getLabelFromTags({ man_made: "water_tower" })).toBe("Water Tower")
  })

  it("returns man_made + tower:type label", () => {
    expect(getLabelFromTags({ man_made: "tower", "tower:type": "communication" })).toBe(
      "Communication Tower",
    )
  })

  it("returns tower:type label when man_made is missing", () => {
    expect(getLabelFromTags({ "tower:type": "observation" })).toBe("Observation Tower")
  })

  it("falls back to first non-empty tag value", () => {
    expect(getLabelFromTags({ building: "yes", something: "else" })).toBe("Yes")
  })

  it("returns OSM Site for empty tags", () => {
    expect(getLabelFromTags({})).toBe("OSM Site")
  })
})

// ── elementToSite ──

describe("elementToSite", () => {
  it("converts a node element with name tag", () => {
    const site = elementToSite({
      type: "node",
      id: 1,
      lat: 35.6,
      lon: -82.5,
      tags: { name: "Station 1", amenity: "fire_station" },
    })
    expect(site).not.toBeNull()
    expect(site?.name).toBe("Station 1")
    expect(site?.latitude).toBe(35.6)
    expect(site?.longitude).toBe(-82.5)
    expect(site?.notes).toBe("OSM element 1 type=node")
  })

  it("generates fallback name when name tag is missing", () => {
    const site = elementToSite({
      type: "node",
      id: 42,
      lat: 35.6,
      lon: -82.5,
      tags: { amenity: "fire_station" },
    })
    expect(site?.name).toBe("Fire Station (OSM 42)")
  })

  it("converts a way element with center", () => {
    const site = elementToSite({
      type: "way",
      id: 7,
      center: { lat: 35.61, lon: -82.51 },
      tags: { amenity: "school", name: "School 1" },
    })
    expect(site?.latitude).toBe(35.61)
    expect(site?.longitude).toBe(-82.51)
  })

  it("returns null for way without center", () => {
    const site = elementToSite({
      type: "way",
      id: 7,
      tags: { amenity: "school" },
    })
    expect(site).toBeNull()
  })

  it("returns null for unsupported element type", () => {
    const site = elementToSite({
      type: "relation",
      id: 1,
      tags: {},
    })
    expect(site).toBeNull()
  })

  it("returns null for node with missing coordinates", () => {
    const site = elementToSite({
      type: "node",
      id: 1,
      tags: {},
    })
    expect(site).toBeNull()
  })
})

// ── elementsToSites ──

describe("elementsToSites", () => {
  it("converts multiple elements", () => {
    const elements = [
      {
        type: "node",
        id: 1,
        lat: 35.6,
        lon: -82.5,
        tags: { amenity: "fire_station", name: "Station A" },
      },
      {
        type: "node",
        id: 2,
        lat: 35.61,
        lon: -82.51,
        tags: { amenity: "school", name: "School B" },
      },
    ]
    const sites = elementsToSites(elements)
    expect(sites).toHaveLength(2)
    expect(sites[0]?.name).toBe("Station A")
    expect(sites[1]?.name).toBe("School B")
  })

  it("filters out null conversions", () => {
    const sites = elementsToSites([
      { type: "node", id: 1, lat: 35.6, lon: -82.5, tags: { name: "Valid" } },
      { type: "relation", id: 2 },
    ] as Parameters<typeof elementsToSites>[0])
    expect(sites).toHaveLength(1)
    expect(sites[0]?.name).toBe("Valid")
  })

  it("deduplicates duplicate names by appending OSM id", () => {
    const elements = [
      {
        type: "node",
        id: 1,
        lat: 35.6,
        lon: -82.5,
        tags: { amenity: "fire_station", name: "Station" },
      },
      {
        type: "node",
        id: 2,
        lat: 35.61,
        lon: -82.51,
        tags: { amenity: "fire_station", name: "Station" },
      },
    ]
    const sites = elementsToSites(elements)
    expect(sites).toHaveLength(2)
    expect(sites[0]?.name).toBe("Station")
    expect(sites[1]?.name).toBe("Station (2)")
  })
})

// ── fetchOsmSites (integration with mocked fetch) ──

describe("fetchOsmSites", () => {
  it("returns sites from a successful fetch", async () => {
    const mockElements = [
      {
        type: "node",
        id: 1,
        lat: 35.6,
        lon: -82.5,
        tags: { name: "Fire Station 1", amenity: "fire_station" },
      },
    ]
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: mockElements }), { status: 200 }),
    )

    const sites = await fetchOsmSites(mockBbox)
    expect(sites).toHaveLength(1)
    expect(sites[0]?.name).toBe("Fire Station 1")
    expect(sites[0]?.latitude).toBe(35.6)
    expect(sites[0]?.longitude).toBe(-82.5)
  })

  it("returns empty array when response has no elements", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: [] }), { status: 200 }),
    )

    const sites = await fetchOsmSites(mockBbox)
    expect(sites).toEqual([])
  })

  it("returns empty array on HTTP 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 500 }))

    const sites = await fetchOsmSites(mockBbox)
    expect(sites).toEqual([])
  })

  it("returns empty array on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"))

    const sites = await fetchOsmSites(mockBbox)
    expect(sites).toEqual([])
  })

  it("returns empty array on malformed JSON response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not json", { status: 200 }))

    const sites = await fetchOsmSites(mockBbox)
    expect(sites).toEqual([])
  })

  it("returns empty array on unexpected response structure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ notElements: true }), { status: 200 }),
    )

    const sites = await fetchOsmSites(mockBbox)
    expect(sites).toEqual([])
  })

  it("generates fallback names when name tag is missing", async () => {
    const mockElements = [
      { type: "node", id: 42, lat: 35.6, lon: -82.5, tags: { amenity: "fire_station" } },
    ]
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: mockElements }), { status: 200 }),
    )

    const sites = await fetchOsmSites(mockBbox)
    expect(sites).toHaveLength(1)
    expect(sites[0]?.name).toBe("Fire Station (OSM 42)")
  })

  it("handles way elements with center coordinates", async () => {
    const mockElements = [
      {
        type: "way",
        id: 7,
        center: { lat: 35.61, lon: -82.51 },
        tags: { amenity: "school", name: "School 1" },
      },
    ]
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: mockElements }), { status: 200 }),
    )

    const sites = await fetchOsmSites(mockBbox)
    expect(sites).toHaveLength(1)
    expect(sites[0]?.latitude).toBe(35.61)
    expect(sites[0]?.longitude).toBe(-82.51)
  })

  it("deduplicates site names by appending OSM id", async () => {
    const mockElements = [
      {
        type: "node",
        id: 1,
        lat: 35.6,
        lon: -82.5,
        tags: { amenity: "fire_station", name: "Station" },
      },
      {
        type: "node",
        id: 2,
        lat: 35.61,
        lon: -82.51,
        tags: { amenity: "fire_station", name: "Station" },
      },
    ]
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: mockElements }), { status: 200 }),
    )

    const sites = await fetchOsmSites(mockBbox)
    expect(sites).toHaveLength(2)
    expect(sites[0]?.name).toBe("Station")
    expect(sites[1]?.name).toBe("Station (2)")
  })

  it("uses custom tags when provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: [] }), { status: 200 }),
    )

    await fetchOsmSites(mockBbox, ["amenity=police"])

    const fetchUrl = (vi.mocked(fetch).mock.calls[0]?.[0] as string) ?? ""
    expect(fetchUrl).toContain(encodeURIComponent('node["amenity"="police"]'))
  })

  it("retries once on 429 response", async () => {
    const mockElements = [
      { type: "node", id: 1, lat: 35.6, lon: -82.5, tags: { name: "OK", amenity: "fire_station" } },
    ]
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ elements: mockElements }), { status: 200 }),
      )

    const sites = await fetchOsmSites(mockBbox)
    expect(sites).toHaveLength(1)
    expect(sites[0]?.name).toBe("OK")
    expect(fetch).toHaveBeenCalledTimes(2)
  }, 15_000)

  it("returns empty array when 429 retry also fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))

    const sites = await fetchOsmSites(mockBbox)
    expect(sites).toEqual([])
  }, 15_000)
})
