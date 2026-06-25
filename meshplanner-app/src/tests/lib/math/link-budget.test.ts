import { describe, expect, it } from "vitest"
import { calculateLinkBudget, SF_SENSITIVITY } from "@/lib/math/link-budget"
import { DEFAULT_LORA_PARAMS } from "@/lib/constants"

describe("calculateLinkBudget", () => {
  it("SF10/20dBm/140dB loss -> margin ~14dB", () => {
    const result = calculateLinkBudget(DEFAULT_LORA_PARAMS, 140)
    expect(result.txEirpDbm).toBeCloseTo(22.5, 0)
    expect(result.rxPowerDbm).toBeCloseTo(-118, 0)
    expect(result.rxSensitivityDbm).toBe(-132)
    expect(result.marginDb).toBeCloseTo(14, 0)
    expect(result.isFeasible).toBe(true)
  })

  it("large path loss -> infeasible", () => {
    const result = calculateLinkBudget(DEFAULT_LORA_PARAMS, 200)
    expect(result.isFeasible).toBe(false)
    expect(result.marginDb).toBeLessThan(0)
  })

  it("zero path loss -> positive margin", () => {
    const result = calculateLinkBudget(DEFAULT_LORA_PARAMS, 0)
    expect(result.marginDb).toBeGreaterThan(0)
    expect(result.isFeasible).toBe(true)
  })

  it("uses rxSensitivityDbm from params", () => {
    const result = calculateLinkBudget({ ...DEFAULT_LORA_PARAMS, rxSensitivityDbm: -120 }, 100)
    expect(result.rxSensitivityDbm).toBe(-120)
  })

  it("SF_SENSITIVITY covers SF7-SF12", () => {
    expect(SF_SENSITIVITY[7]).toBe(-123)
    expect(SF_SENSITIVITY[8]).toBe(-126)
    expect(SF_SENSITIVITY[9]).toBe(-129)
    expect(SF_SENSITIVITY[10]).toBe(-132)
    expect(SF_SENSITIVITY[11]).toBe(-134)
    expect(SF_SENSITIVITY[12]).toBe(-137)
  })
})
