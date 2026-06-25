import { describe, it, expect } from "vitest"
import {
  haversineDistance, intermediatePoint, bearing,
  destinationPoint, EARTH_RADIUS_KM,
} from "@/lib/math/geodetic"

describe("EARTH_RADIUS_KM", () => {
  it("is 6371", () => {
    expect(EARTH_RADIUS_KM).toBe(6371)
  })
})

describe("haversineDistance", () => {
  it("same point -> 0", () => {
    expect(haversineDistance(35.6, -82.5, 35.6, -82.5)).toBeCloseTo(0, 5)
  })
  it("north pole to itself -> 0", () => {
    expect(haversineDistance(90, 0, 90, 180)).toBeCloseTo(0, 10)
  })
  it("equator 1 deg longitude ~111km", () => {
    const d = haversineDistance(0, 0, 0, 1)
    expect(d).toBeCloseTo(111.195, 1)
  })
  it("meridian 1 deg ~111km", () => {
    const d = haversineDistance(0, 0, 1, 0)
    expect(d).toBeCloseTo(111.195, 1)
  })
  it("Asheville diagonal ~26km", () => {
    const d = haversineDistance(35.5, -82.6, 35.7, -82.4)
    expect(d).toBeGreaterThan(20)
    expect(d).toBeLessThan(30)
  })
  it("southern hemisphere works", () => {
    const d = haversineDistance(-33.86, 151.21, -37.81, 144.96)
    expect(d).toBeGreaterThan(700)
    expect(d).toBeLessThan(720)
  })
  it("antipodal ~20015 km", () => {
    const d = haversineDistance(0, 0, 0, 180)
    expect(d).toBeGreaterThan(20000)
    expect(d).toBeLessThan(20020)
  })
  it("is commutative", () => {
    const d1 = haversineDistance(35.5, -82.6, 35.7, -82.4)
    const d2 = haversineDistance(35.7, -82.4, 35.5, -82.6)
    expect(d1).toBeCloseTo(d2, 8)
  })
})

describe("intermediatePoint", () => {
  it("fraction 0 returns start", () => {
    const [lat, lon] = intermediatePoint(35.5, -82.6, 35.7, -82.4, 0)
    expect(lat).toBeCloseTo(35.5, 5)
    expect(lon).toBeCloseTo(-82.6, 5)
  })
  it("fraction 1 returns end", () => {
    const [lat, lon] = intermediatePoint(35.5, -82.6, 35.7, -82.4, 1)
    expect(lat).toBeCloseTo(35.7, 5)
    expect(lon).toBeCloseTo(-82.4, 5)
  })
  it("fraction 0.5 on equator", () => {
    const [lat, lon] = intermediatePoint(0, 0, 0, 10, 0.5)
    expect(lat).toBeCloseTo(0, 6)
    expect(lon).toBeCloseTo(5, 4)
  })
  it("fraction 0.5 equidistant from ends", () => {
    const [lat, lon] = intermediatePoint(35.5, -82.6, 35.7, -82.4, 0.5)
    const dStart = haversineDistance(35.5, -82.6, lat, lon)
    const dEnd = haversineDistance(35.7, -82.4, lat, lon)
    expect(dStart).toBeCloseTo(dEnd, 1)
  })
  it("same start/end returns start", () => {
    const [lat, lon] = intermediatePoint(35, -80, 35, -80, 0.5)
    expect(lat).toBeCloseTo(35, 8)
    expect(lon).toBeCloseTo(-80, 8)
  })
})

describe("bearing", () => {
  it("north is 0", () => {
    expect(bearing(35, -82, 36, -82)).toBeCloseTo(0, 1)
  })
  it("east is 90", () => {
    expect(bearing(0, 0, 0, 10)).toBeCloseTo(90, 1)
  })
  it("south is 180", () => {
    expect(bearing(10, 0, 0, 0)).toBeCloseTo(180, 1)
  })
  it("west is 270", () => {
    expect(bearing(35, -82, 35, -83)).toBeCloseTo(270, 0)
  })
})

describe("destinationPoint", () => {
  it("distance 0 returns same point", () => {
    const [lat, lon] = destinationPoint(35.6, -82.5, 45, 0)
    expect(lat).toBeCloseTo(35.6, 10)
    expect(lon).toBeCloseTo(-82.5, 10)
  })
  it("north 111km ~ 1 deg", () => {
    const [lat, lon] = destinationPoint(0, 0, 0, 111.195)
    expect(lat).toBeCloseTo(1, 1)
    expect(lon).toBeCloseTo(0, 1)
  })
  it("east 111km ~ 1 deg", () => {
    const [lat, lon] = destinationPoint(0, 0, 90, 111.195)
    expect(lat).toBeCloseTo(0, 1)
    expect(lon).toBeCloseTo(1, 1)
  })
  it("round-trip with haversine", () => {
    const [lat2, lon2] = destinationPoint(35, -80, 45, 50)
    const d = haversineDistance(35, -80, lat2, lon2)
    expect(d).toBeCloseTo(50, 1)
  })
})
