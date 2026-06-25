import { describe, expect, it } from "vitest"
import { bilinearInterpolate, angularInterpolate } from "@/lib/math/interpolation"

describe("bilinearInterpolate", () => {
  const data = new Float32Array([1, 2, 3, 4])
  const w = 2
  const h = 2

  it("exact pixel top-left -> 1", () => {
    expect(bilinearInterpolate(data, w, h, 0, 0)).toBeCloseTo(1, 6)
  })
  it("exact pixel bottom-right -> 4", () => {
    expect(bilinearInterpolate(data, w, h, 1, 1)).toBeCloseTo(4, 6)
  })
  it("centre -> 2.5", () => {
    expect(bilinearInterpolate(data, w, h, 0.5, 0.5)).toBeCloseTo(2.5, 6)
  })
  it("quarter -> 1.75", () => {
    expect(bilinearInterpolate(data, w, h, 0.25, 0.25)).toBeCloseTo(1.75, 6)
  })
  it("col < 0 -> null", () => {
    expect(bilinearInterpolate(data, w, h, -0.5, 0.5)).toBeNull()
  })
  it("row < 0 -> null", () => {
    expect(bilinearInterpolate(data, w, h, 0.5, -0.5)).toBeNull()
  })
  it("col > width-1 -> null", () => {
    expect(bilinearInterpolate(data, w, h, 1.5, 0.5)).toBeNull()
  })
  it("accepts number[]", () => {
    expect(bilinearInterpolate([10, 20, 30, 40], 2, 2, 0.5, 0.5)).toBeCloseTo(25, 6)
  })
})

describe("angularInterpolate", () => {
  it("target = left -> left value", () => {
    expect(angularInterpolate(-100, -90, 45, 90, 45)).toBeCloseTo(-100, 6)
  })
  it("target = right -> right value", () => {
    expect(angularInterpolate(-100, -90, 45, 90, 90)).toBeCloseTo(-90, 6)
  })
  it("midpoint -> average", () => {
    expect(angularInterpolate(-100, -90, 45, 90, 67.5)).toBeCloseTo(-95, 6)
  })
  it("handles 0/360 wrap-around", () => {
    expect(angularInterpolate(-100, -90, 350, 10, 355)).toBeCloseTo(-97.5, 6)
  })
  it("same angle -> left value", () => {
    expect(angularInterpolate(-110, -110, 30, 30, 45)).toBeCloseTo(-110, 6)
  })
})
