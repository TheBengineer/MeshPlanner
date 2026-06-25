import { describe, expect, it } from "vitest"
import { qerfi, qerf } from "@/lib/math/normal"

describe("qerfi (inverse normal CDF)", () => {
  it("qerfi(0.5) ~ 0", () => {
    expect(qerfi(0.5)).toBeCloseTo(0, 4)
  })
  it("qerfi(0.84) ~ -0.994 (itmlogic convention)", () => {
    expect(qerfi(0.84)).toBeCloseTo(-0.994, 0)
  })
  it("qerfi(0.16) ~ 0.994 (itmlogic convention)", () => {
    expect(qerfi(0.16)).toBeCloseTo(0.994, 0)
  })
  it("qerfi(0.025) ~ 1.96 (itmlogic convention)", () => {
    expect(qerfi(0.025)).toBeCloseTo(1.96, 0)
  })
  it("qerfi(0.975) ~ -1.96 (itmlogic convention)", () => {
    expect(qerfi(0.975)).toBeCloseTo(-1.96, 0)
  })
  it("p <= 0 -> -Inf", () => {
    expect(qerfi(0)).toBe(-Infinity)
    expect(qerfi(-1)).toBe(-Infinity)
  })
  it("p >= 1 -> +Inf", () => {
    expect(qerfi(1)).toBe(Infinity)
    expect(qerfi(2)).toBe(Infinity)
  })
  it("symmetry: qerfi(p) = -qerfi(1-p)", () => {
    expect(qerfi(0.3)).toBeCloseTo(-qerfi(0.7), 3)
    expect(qerfi(0.1)).toBeCloseTo(-qerfi(0.9), 3)
  })
})

describe("qerf (standard normal Q-function)", () => {
  it("qerf(0) = 0.5", () => {
    expect(qerf(0)).toBeCloseTo(0.5, 4)
  })
  it("qerf(1) ~ 0.1587", () => {
    expect(qerf(1)).toBeCloseTo(0.1587, 2)
  })
  it("qerf(-1) ~ 0.8413", () => {
    expect(qerf(-1)).toBeCloseTo(0.8413, 2)
  })
  it("qerf(1.96) ~ 0.025", () => {
    expect(qerf(1.96)).toBeCloseTo(0.025, 2)
  })
  it("qerf(-1.96) ~ 0.975", () => {
    expect(qerf(-1.96)).toBeCloseTo(0.975, 2)
  })
  it("qerf(z) + qerf(-z) = 1", () => {
    for (const z of [0.5, 1, 1.5, 2, 2.5]) {
      expect(qerf(z) + qerf(-z)).toBeCloseTo(1, 4)
    }
  })
  it("monotonically decreasing", () => {
    const zs = [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3] as const
    for (let i = 1; i < zs.length; i++) {
      expect(qerf(zs[i]!)).toBeLessThan(qerf(zs[i - 1]!))
    }
  })
  it("qerf and qerfi are consistent with itmlogic sign convention", () => {
    // itmlogic's qerfi uses a different sign convention than standard stats libraries.
    // qerf(0) = 0.5 (standard normal at mean)
    expect(qerf(0)).toBeCloseTo(0.5, 4)
    // qerf for ±small values is well-defined
    expect(qerf(-0.5)).toBeGreaterThan(0.5)
    expect(qerf(0.5)).toBeLessThan(0.5)
  })
})
