import {
  type ResolvedTag,
  buildOverpassQuery,
  elementToSite,
  elementsToSites,
  fetchOsmBuildings,
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

  it("resolves built-in police", () => {
    const r = resolveTag("police")
    expect(r.conditions).toEqual([["amenity", "police"]])
    expect(r.label).toBe("Police Station")
  })
})

// ── parseTags ──

describe("parseTags", () => {
  it("returns defaults when called without arguments", () => {
    const tags = parseTags()
    expect(tags).toHaveLength(7)
    const ids = tags.map((t) => t.label)
    expect(ids).toContain("Fire Station")
    expect(ids).toContain("School")
    expect(ids).toContain("Hospital")
    expect(ids).toContain("Police Station")
    expect(ids).toContain("Town Hall")
    expect(ids).toContain("Tower")
    expect(ids).toContain("Water Tower")
  })

  it("returns defaults when called with empty array", () => {
    const tags = parseTags([])
    expect(tags).toHaveLength(7)
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

  // ── onError callback ──

  it("calls onError with network error message on fetch failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"))

    const onError = vi.fn()
    const sites = await fetchOsmSites(mockBbox, undefined, { onError })
    expect(sites).toEqual([])
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith("Network error — check internet connection")
  })

  it("calls onError with HTTP error message on server error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 502 }))

    const onError = vi.fn()
    const sites = await fetchOsmSites(mockBbox, undefined, { onError })
    expect(sites).toEqual([])
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith("Server returned 502")
  })

  it("calls onError with no-results message when elements array is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: [] }), { status: 200 }),
    )

    const onError = vi.fn()
    const sites = await fetchOsmSites(mockBbox, undefined, { onError })
    expect(sites).toEqual([])
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(
      "No Fire Station, School, Hospital, Police Station, Town Hall, Tower, Water Tower found in this area",
    )
  })

  it("does not call onError on successful fetch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: [{ type: "node", id: 1, lat: 35.6, lon: -82.5, tags: {} }] }), { status: 200 }),
    )

    const onError = vi.fn()
    const sites = await fetchOsmSites(mockBbox, undefined, { onError })
    expect(sites).toHaveLength(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it("calls onError with timeout message on abort signal", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      Object.assign(new Error("The user aborted a request."), { name: "AbortError" }),
    )

    const onError = vi.fn()
    const sites = await fetchOsmSites(mockBbox, undefined, { onError })
    expect(sites).toEqual([])
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith("Request timed out — try a smaller area")
  })
})

// ── fetchOsmBuildings ──

describe("fetchOsmBuildings", () => {
  it("returns building coordinates and count from a successful fetch", async () => {
    const mockElements = [
      {
        type: "way",
        id: 1,
        geometry: [
          { lat: 35.6, lon: -82.5 },
          { lat: 35.61, lon: -82.49 },
          { lat: 35.61, lon: -82.48 },
          { lat: 35.6, lon: -82.5 },
        ],
      },
      {
        type: "way",
        id: 2,
        geometry: [
          { lat: 35.62, lon: -82.52 },
          { lat: 35.63, lon: -82.51 },
          { lat: 35.62, lon: -82.50 },
          { lat: 35.62, lon: -82.52 },
        ],
      },
    ]
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: mockElements }), { status: 200 }),
    )

    const result = await fetchOsmBuildings(mockBbox)
    expect(result.count).toBe(2)
    expect(result.coordinates).toHaveLength(2)
    // First building: 4 points in [lng, lat] order
    expect(result.coordinates[0]).toEqual([
      [-82.5, 35.6],
      [-82.49, 35.61],
      [-82.48, 35.61],
      [-82.5, 35.6],
    ])
  })

  it("closes unclosed polygon rings", async () => {
    const mockElements = [
      {
        type: "way",
        id: 42,
        geometry: [
          { lat: 35.6, lon: -82.5 },
          { lat: 35.61, lon: -82.49 },
          { lat: 35.61, lon: -82.48 },
          // missing closing point
        ],
      },
    ]
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: mockElements }), { status: 200 }),
    )

    const result = await fetchOsmBuildings(mockBbox)
    expect(result.count).toBe(1)
    expect(result.coordinates[0]).toHaveLength(4)
    // Last point must equal first point
    expect(result.coordinates[0][3]).toEqual(result.coordinates[0][0])
  })

  it("returns empty when response has no elements", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: [] }), { status: 200 }),
    )

    const result = await fetchOsmBuildings(mockBbox)
    expect(result).toEqual({ coordinates: [], count: 0 })
  })

  it("returns empty on HTTP 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 500 }))

    const result = await fetchOsmBuildings(mockBbox)
    expect(result).toEqual({ coordinates: [], count: 0 })
  })

  it("returns empty on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"))

    const result = await fetchOsmBuildings(mockBbox)
    expect(result).toEqual({ coordinates: [], count: 0 })
  })

  it("returns empty on malformed JSON response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not json", { status: 200 }))

    const result = await fetchOsmBuildings(mockBbox)
    expect(result).toEqual({ coordinates: [], count: 0 })
  })

  it("returns empty on unexpected response structure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ notElements: true }), { status: 200 }),
    )

    const result = await fetchOsmBuildings(mockBbox)
    expect(result).toEqual({ coordinates: [], count: 0 })
  })

  it("filters out non-way elements", async () => {
    const mockElements = [
      { type: "node", id: 1, geometry: [{ lat: 35.6, lon: -82.5 }] },
      {
        type: "way",
        id: 2,
        geometry: [
          { lat: 35.6, lon: -82.5 },
          { lat: 35.61, lon: -82.49 },
          { lat: 35.61, lon: -82.48 },
          { lat: 35.6, lon: -82.5 },
        ],
      },
      { type: "relation", id: 3, geometry: [] },
    ]
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: mockElements }), { status: 200 }),
    )

    const result = await fetchOsmBuildings(mockBbox)
    expect(result.count).toBe(1)
  })

  it("filters out elements with fewer than 3 geometry points", async () => {
    const mockElements = [
      {
        type: "way",
        id: 1,
        geometry: [{ lat: 35.6, lon: -82.5 }, { lat: 35.61, lon: -82.5 }],
      },
      {
        type: "way",
        id: 2,
        geometry: [
          { lat: 35.6, lon: -82.5 },
          { lat: 35.61, lon: -82.49 },
          { lat: 35.61, lon: -82.48 },
          { lat: 35.6, lon: -82.5 },
        ],
      },
    ]
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: mockElements }), { status: 200 }),
    )

    const result = await fetchOsmBuildings(mockBbox)
    expect(result.count).toBe(1)
  })

  it("handles abort signal gracefully", async () => {
    const abortController = new AbortController()
    abortController.abort()

    // Signal is aborted before fetch; mock only to guard against
    // unexpected fetch calls through rateLimit timing edge cases.
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Should not reach fetch"))

    const result = await fetchOsmBuildings(mockBbox, abortController.signal)
    expect(result).toEqual({ coordinates: [], count: 0 })
  })

  it("retries once on 429 response", async () => {
    const mockElements = [
      {
        type: "way",
        id: 1,
        geometry: [
          { lat: 35.6, lon: -82.5 },
          { lat: 35.61, lon: -82.49 },
          { lat: 35.61, lon: -82.48 },
          { lat: 35.6, lon: -82.5 },
        ],
      },
    ]
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ elements: mockElements }), { status: 200 }),
      )

    const result = await fetchOsmBuildings(mockBbox)
    expect(result.count).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(2)
  }, 15_000)

  it("returns empty when 429 retry also fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))

    const result = await fetchOsmBuildings(mockBbox)
    expect(result).toEqual({ coordinates: [], count: 0 })
  }, 15_000)
})
