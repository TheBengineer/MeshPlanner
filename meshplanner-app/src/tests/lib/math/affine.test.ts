import { describe, expect, it } from "vitest"
import { Affine } from "@/lib/math/affine"

describe("Affine", () => {
  const a = new Affine(0.001, 0, -82.6, 0, -0.001, 35.65)

  it("pixelToGeo gives west,north at (0,0)", () => {
    const [lon, lat] = a.pixelToGeo(0, 0)
    expect(lon).toBeCloseTo(-82.6, 8)
    expect(lat).toBeCloseTo(35.65, 8)
  })

  it("transform matches pixelToGeo", () => {
    expect(a.transform(100.5, 50.25)).toEqual(a.pixelToGeo(100.5, 50.25))
  })

  it("geoToPixel round-trip from pixel", () => {
    const [lon, lat] = a.pixelToGeo(42.7, 88.3)
    const [col, row] = a.geoToPixel(lon, lat)
    expect(col).toBeCloseTo(42.7, 10)
    expect(row).toBeCloseTo(88.3, 10)
  })

  it("pixelToGeo round-trip from geo", () => {
    const [col, row] = a.geoToPixel(-82.55, 35.6)
    const [lon, lat] = a.pixelToGeo(col, row)
    expect(lon).toBeCloseTo(-82.55, 10)
    expect(lat).toBeCloseTo(35.6, 10)
  })

  it("invert produces correct inverse", () => {
    const inv = a.invert()
    const [lon, lat] = a.pixelToGeo(50, 100)
    const [c, r] = inv.transform(lon, lat)
    expect(c).toBeCloseTo(50, 10)
    expect(r).toBeCloseTo(100, 10)
  })

  it("fromBounds builds correct affine", () => {
    const aff = Affine.fromBounds(-82.6, 35.5, -82.4, 35.65, 200, 150)
    expect(aff.a).toBeCloseTo(0.001, 10)
    expect(aff.e).toBeCloseTo(-0.001, 10)
    expect(aff.c).toBeCloseTo(-82.6)
    expect(aff.f).toBeCloseTo(35.65)
  })

  it("resolution returns geometric mean", () => {
    expect(a.resolution()).toBeCloseTo(0.001, 10)
  })

  it("throws on singular", () => {
    expect(() => new Affine(1, 2, 0, 2, 4, 0).invert()).toThrow("Singular")
  })
})
