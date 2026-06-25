import { describe, it, expect } from "vitest"
import { ComputePanel } from "@/components/workflow/ComputePanel"

describe("ComputePanel", () => {
  it("is exported as a function component", () => {
    expect(ComputePanel).toBeDefined()
    expect(typeof ComputePanel).toBe("function")
  })
})
