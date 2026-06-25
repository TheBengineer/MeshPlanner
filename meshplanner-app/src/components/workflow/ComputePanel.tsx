import { useCallback, useRef } from "react"
import { combineCoverage, combineAtThreshold } from "@/lib/combine/union"
import { fetchDemRaster } from "@/lib/dem/fetch"
import { downloadCsv, downloadGeoJson, rasterToCoverageGeoJson } from "@/lib/export/geojson"
import { greedyMinSites } from "@/lib/optimize/greedy"
import { buildCoverageMatrix } from "@/lib/optimize/matrix"
import { warmStartMinSites } from "@/lib/optimize/warmstart"
import { computeCoverageWithWorkers } from "@/workers/coverage-manager"
import type { CoverageRaster, OptimizationResult } from "@/lib/types"
import { useStore } from "@/store"

function isMobileOrLowMemory(): boolean {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua)
  const deviceMemory = (navigator as any).deviceMemory
  const lowMem = deviceMemory !== undefined && deviceMemory < 4
  return mobile || lowMem
}

/* ── Styled button helper (avoids repeating inline styles) ── */

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  width: "100%",
  padding: "8px 12px",
  fontWeight: 600,
  fontSize: 13,
  background: disabled ? "#ccc" : "#1a73e8",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: disabled ? "not-allowed" : "pointer",
})

export function ComputePanel() {
  const {
    bbox,
    sites,
    selectedSiteNames,
    params,
    coverageParams,
    computing,
    progress,
    optimizationPhase,
    coverageResults,
    optimizationResult,
    greedyResult,
    improvement,
    error,
    setComputing,
    setProgress,
    setCoverageGeoJson,
    setCoverageResults,
    setOptimizationResult,
    setGreedyResult,
    setOptimizationPhase,
    setImprovement,
    setError,
  } = useStore()

  const resultsPanelRef = useRef<HTMLDivElement>(null)
  const computeInFlight = useRef(false)
  const errorRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)

  const handleRetry = useCallback(() => {
    setError(null)
    setCoverageResults(null)
    setOptimizationResult(null)
    setGreedyResult(null)
    setImprovement(null)
    setCoverageGeoJson(null)
    setOptimizationPhase("idle")
    // Focus the compute button for immediate re-trigger
    setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="compute-btn"]')?.focus()
    }, 0)
  }, [
    setError, setCoverageResults, setOptimizationResult,
    setGreedyResult, setImprovement, setCoverageGeoJson,
    setOptimizationPhase,
  ])

  const handleCompute = useCallback(async () => {
    if (computeInFlight.current) return
    if (!bbox) { setError("Draw or enter a bounding box first"); return }
    if (selectedSiteNames.length === 0) { setError("Add at least one site"); return }

    computeInFlight.current = true

    setComputing(true)
    setError(null)
    setCoverageResults(null)
    setOptimizationResult(null)
    setGreedyResult(null)
    setImprovement(null)
    setCoverageGeoJson(null)
    setOptimizationPhase("computing")

    const startTime = performance.now()
    const { maxRangeKm, numRadials, threshold, targetCoverage } = coverageParams

    try {
      // ── Step 1: Fetch DEM ──
      setProgress({ current: 0, total: 4, label: "Fetching DEM tiles…" })
      let dem
      try {
        dem = await fetchDemRaster(bbox, (pct) => {
          setProgress({ current: 0, total: 4, label: `DEM: ${pct}%` })
        })
      } catch (demErr) {
        const msg = demErr instanceof Error ? demErr.message : "Unknown DEM error"
        throw new Error(
          `Failed to fetch elevation data. ${msg}. Check your network connection and try again.`,
        )
      }
      const demAffine = dem.affine

      // ── Step 2: Compute coverage for each selected site ──
      setProgress({ current: 1, total: 4, label: `Computing coverage (${selectedSiteNames.length} sites)…` })
      const selectedSites = sites.filter((s) => selectedSiteNames.includes(s.name))
      const rasterMap = new Map<string, CoverageRaster>()
      for (const site of selectedSites) {
        try {
          const raster = await computeCoverageWithWorkers(
            dem.data, dem.width, dem.height, demAffine,
            site.latitude, site.longitude,
            params, maxRangeKm, numRadials,
          )
          rasterMap.set(site.name, raster)
        } catch (workerErr) {
          const msg = workerErr instanceof Error ? workerErr.message : "Worker computation failed"
          console.warn("Worker computation failed, falling back to main thread:", msg)
          // Already handled inside computeCoverageWithWorkers but if it re-throws,
          // fall through to throw a user-facing error
          throw new Error(
            `Coverage computation failed for site "${site.name}". ${msg}`,
          )
        }
      }

      // ── Step 3: Combine coverage rasters ──
      setProgress({ current: 2, total: 4, label: "Combining coverage rasters…" })
      const rasters = [...rasterMap.values()]
      const combined = combineCoverage(rasters, "best")

      // ── Step 4: Threshold mask + GeoJSON overlay ──
      setProgress({ current: 3, total: 4, label: "Building map overlay…" })
      const mask = combineAtThreshold([combined], threshold, "any")
      const maskLen = combined.width * combined.height
      let coveredCells = 0
      for (let i = 0; i < maskLen; i++) {
        const val = mask[i]
        if (val && val >= 0.5) coveredCells++
      }
      const coveredFraction = maskLen > 0 ? coveredCells / maskLen : 0

      const coverageGeoJson = rasterToCoverageGeoJson(
        mask, combined.width, combined.height, combined.affine, 4,
      )
      setCoverageGeoJson(coverageGeoJson)

      // ── Step 5: Build matrix ──
      setProgress({ current: 4, total: 4, label: "Optimising site selection…" })
      const matrixCellSize = 4
      const matrix = buildCoverageMatrix(rasterMap, threshold, matrixCellSize)
      const siteNamesList = [...rasterMap.keys()]

      // ── Step 6: Greedy (always, instant) ──
      const greedy = greedyMinSites(matrix, siteNamesList, targetCoverage)

      const computeTimeS = (performance.now() - startTime) / 1000

      setOptimizationPhase("greedy")
      setGreedyResult(greedy)
      setOptimizationResult(greedy)
      setCoverageResults({
        coveredFraction,
        totalCells: maskLen,
        coveredCells,
        nSites: greedy.selectedSites.length,
        computeTimeS,
        threshold,
        optimizationResult: greedy,
      })

      // ── Step 7: Optional ILP background upgrade ──
      const canUseIlp = !isMobileOrLowMemory()

      if (canUseIlp) {
        setOptimizationPhase("ilp-loading")

        let onIlpDone: (() => void) | null = null
        const ilpDone = new Promise<void>((resolve) => {
          onIlpDone = resolve
        })

        const safetyTimeout = new Promise<void>((resolve) =>
          setTimeout(resolve, 60000),
        )

        warmStartMinSites(matrix, siteNamesList, targetCoverage, {
          timeLimitS: 30,
          onUpdate: (result: OptimizationResult, phase: "greedy" | "ilp") => {
            if (phase === "greedy") return
            const greedyRes = greedy
            const isBetter =
              greedyRes &&
              (result.selectedSites.length !== greedyRes.selectedSites.length ||
                Math.abs(result.coveredFraction - greedyRes.coveredFraction) > 1e-10)

            if (isBetter) {
              setOptimizationResult(result)
              const saved = greedyRes.selectedSites.length - result.selectedSites.length
              if (saved > 0) setImprovement(saved)
              setCoverageResults({
                coveredFraction,
                totalCells: maskLen,
                coveredCells,
                nSites: result.selectedSites.length,
                computeTimeS,
                threshold,
                optimizationResult: result,
              })
            }

            setOptimizationPhase("ilp-complete")
            if (result.source !== "ilp") {
              // hiGHS WASM load failed / ILP unavailable
              setError("ILP solver unavailable — using greedy result")
            }
            onIlpDone?.()
          },
        })

        await Promise.race([ilpDone, safetyTimeout])

        useStore.setState((s) => {
          if (s.optimizationPhase === "ilp-loading") {
            return { optimizationPhase: "ilp-complete" as const }
          }
          return {}
        })
      } else {
        setOptimizationPhase("greedy")
      }

      // Focus results panel after compute completes
      resultsPanelRef.current?.focus()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Computation failed"
      setError(msg)
      setOptimizationPhase("error")
      console.error("Compute error:", err)
      // Focus error region for screen reader announcement
      setTimeout(() => {
        errorRef.current?.focus()
      }, 0)
    } finally {
      setComputing(false)
      setProgress(null)
      computeInFlight.current = false
    }
  }, [
    bbox, sites, selectedSiteNames, params, coverageParams,
    setComputing, setProgress, setCoverageGeoJson,
    setCoverageResults, setOptimizationResult, setGreedyResult,
    setOptimizationPhase, setImprovement, setError,
  ])

  const handleExportGeoJson = useCallback(() => {
    const gj = useStore.getState().coverageGeoJson
    if (gj) downloadGeoJson(gj)
  }, [])

  const handleExportCsv = useCallback(() => {
    const r = useStore.getState().coverageResults
    if (r) {
      const names = useStore.getState().optimizationResult?.selectedSites ?? []
      downloadCsv(names, r.coveredFraction, r.coveredCells, r.totalCells, r.computeTimeS, r.threshold)
    }
  }, [])

  const buttonLabel = (() => {
    if (!computing) return "Compute Coverage"
    switch (optimizationPhase) {
      case "computing": return "Computing…"
      case "greedy": return "Showing greedy result…"
      case "ilp-loading": return "Computing optimal solution…"
      default: return "Computing…"
    }
  })()

  const disableButton = computing || !bbox || selectedSiteNames.length === 0

  return (
    <div style={{ borderTop: "1px solid #ddd", padding: "8px" }}>

      {/* ── Compute button ── */}
      <button
        type="button"
        data-testid="compute-btn"
        onClick={handleCompute}
        disabled={disableButton}
        aria-label={disableButton ? `Compute coverage${!bbox ? " — bounding box required" : ""}${selectedSiteNames.length === 0 ? " — select at least one site" : ""}` : "Compute coverage"}
        aria-busy={computing ? "true" : undefined}
        style={primaryBtn(disableButton)}
      >
        {buttonLabel}
      </button>

      {/* ── Progress bar (DEM/coverage/combine) ── */}
      {computing && progress && optimizationPhase === "computing" && (
        <div
          style={{ marginTop: 8, fontSize: 12, color: "#555" }}
          role="status"
          aria-live="polite"
          aria-label={progress.label}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              display: "inline-block",
              width: 12, height: 12,
              border: "2px solid #1a73e8",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              role: "img",
              "aria-label": "Computing",
            } as React.CSSProperties & { role: string }} />
            <span>{progress.label}</span>
          </div>
        </div>
      )}

      {/* ── Greedy / ILP-loading status ── */}
      {(optimizationPhase === "greedy" || optimizationPhase === "ilp-loading") && (
        <div
          data-testid="optimization-status"
          role="status"
          aria-live="polite"
          ref={statusRef}
          aria-label={
            optimizationPhase === "ilp-loading"
              ? "Computing optimal solution"
              : "Greedy solution displayed — map may improve"
          }
          style={{
            marginTop: 8, padding: "6px 8px",
            background: optimizationPhase === "ilp-loading" ? "#fff7ed" : "#f0fdf4",
            borderRadius: 4, fontSize: 12,
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          {optimizationPhase === "ilp-loading" && (
            <span style={{
              display: "inline-block",
              width: 10, height: 10,
              border: "2px solid #f97316",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              role: "img",
              "aria-label": "Solving",
            } as React.CSSProperties & { role: string }} />
          )}
          <span style={{
            color: optimizationPhase === "ilp-loading" ? "#9a3412" : "#166534",
            fontWeight: 500,
          }}>
            {optimizationPhase === "greedy"
              ? "Greedy solution shown — map may improve…"
              : "Computing optimal solution (ILP)…"
            }
          </span>
        </div>
      )}

      {/* ── Error state ── */}
      {error && (
        <div
          data-testid="compute-error"
          ref={errorRef}
          role="alert"
          aria-live="assertive"
          tabIndex={-1}
          style={{
            marginTop: 8, padding: "8px 10px",
            background: "#fef2f2", color: "#b91c1c",
            borderRadius: 4, fontSize: 12,
            outline: "none",
            border: "1px solid #fca5a5",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              style={{
                background: "none", border: "none",
                color: "#b91c1c", cursor: "pointer",
                fontWeight: 600, fontSize: 14,
                padding: "2px 4px",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
          {/* Show retry button for DEM / computation errors */}
          {optimizationPhase === "error" && (
            <button
              type="button"
              onClick={handleRetry}
              aria-label="Retry computation"
              style={{
                marginTop: 6,
                padding: "4px 12px",
                background: "#b91c1c",
                color: "#fff",
                border: "none",
                borderRadius: 3,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 11,
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* ── Empty results message (compute finished, no selected sites) ── */}
      {!computing && !error && optimizationPhase !== "idle" && coverageResults && coverageResults.nSites === 0 && (
        <div
          data-testid="empty-results"
          role="status"
          aria-live="polite"
          style={{
            marginTop: 8, padding: "8px",
            background: "#fef3c7", borderRadius: 4,
            fontSize: 12, color: "#92400e",
            border: "1px solid #fde68a",
          }}
        >
          No sites selected. The optimisation could not find a solution with the current settings.
        </div>
      )}

      {/* ── Results metrics (show whenever coverageResults exist) ── */}
      {coverageResults && coverageResults.nSites > 0 && (
        <div
          data-testid="coverage-results"
          ref={(el) => { resultsPanelRef.current = el }}
          tabIndex={-1}
          role="region"
          aria-label="Coverage results"
          style={{
            marginTop: 8, padding: "8px",
            background: "#f0fdf4", borderRadius: 4,
            fontSize: 12, outline: "none",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13, color: "#166534" }}>
            Coverage Results
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
            <span style={{ color: "#555" }}>Coverage:</span>
            <span style={{ fontWeight: 600 }}>
              {(coverageResults.coveredFraction * 100).toFixed(1)}%
            </span>
            <span style={{ color: "#555" }}>Selected sites:</span>
            <span style={{ fontWeight: 600 }}>{coverageResults.nSites}</span>
            <span style={{ color: "#555" }}>Cells covered:</span>
            <span style={{ fontWeight: 600 }}>
              {coverageResults.coveredCells.toLocaleString()} / {coverageResults.totalCells.toLocaleString()}
            </span>
            <span style={{ color: "#555" }}>Time:</span>
            <span style={{ fontWeight: 600 }}>{coverageResults.computeTimeS.toFixed(1)}s</span>
          </div>

          {/* ILP completed — show improvement delta */}
          {optimizationPhase === "ilp-complete" && improvement !== null && (
            <div
              role="status"
              aria-live="polite"
              aria-label={`Improved by ILP: ${improvement} fewer site${improvement === 1 ? "" : "s"}`}
              style={{
                marginTop: 6, padding: "4px 6px",
                background: "#dbeafe", borderRadius: 3,
                fontWeight: 600, fontSize: 12, color: "#1e40af",
              }}
            >
              Improved by ILP: {improvement} fewer site{improvement === 1 ? "" : "s"}!
            </div>
          )}

          {/* ILP completed — hiGHS WASM unavailable message */}
          {optimizationPhase === "ilp-complete" && improvement === null && greedyResult && (
            <div
              role="status"
              aria-live="polite"
              aria-label="ILP solver unavailable, using greedy result"
              style={{
                marginTop: 6, padding: "4px 6px",
                background: "#fef3c7", borderRadius: 3,
                fontWeight: 500, fontSize: 12, color: "#92400e",
              }}
            >
              ILP unavailable — using greedy result
            </div>
          )}

          {/* Greedy-only mode (no ILP attempt) */}
          {optimizationPhase === "greedy" && !computing && !greedyResult && (
            <div
              role="status"
              aria-live="polite"
              aria-label="Greedy solution only, ILP skipped on mobile"
              style={{
                marginTop: 6, padding: "4px 6px",
                background: "#fef3c7", borderRadius: 3,
                fontWeight: 500, fontSize: 12, color: "#92400e",
              }}
            >
              Greedy solution (ILP skipped on mobile)
            </div>
          )}

          {/* Solver info */}
          {optimizationResult && (
            <div style={{
              fontWeight: 600, marginTop: 6, marginBottom: 2,
              fontSize: 13, color: "#166534",
            }}>
              Optimisation
            </div>
          )}
          {optimizationResult && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
              <span style={{ color: "#555" }}>Solver:</span>
              <span style={{ fontWeight: 600 }}>{optimizationResult.source}</span>
              <span style={{ color: "#555" }}>Status:</span>
              <span style={{ fontWeight: 600 }}>{optimizationResult.status}</span>
              {optimizationResult.selectedSites.length <= 5 && (
                <>
                  <span style={{ color: "#555" }}>Sites:</span>
                  <span style={{
                    fontWeight: 600, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {optimizationResult.selectedSites.join(", ")}
                  </span>
                </>
              )}
            </div>
          )}

          {/* ── Export buttons ── */}
          {!computing && (
            <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
              <button
                type="button"
                data-testid="export-geojson-btn"
                onClick={handleExportGeoJson}
                aria-label="Export results as GeoJSON"
                style={{
                  flex: 1, padding: "4px 6px", fontSize: 11,
                  background: "#fff", border: "1px solid #ddd",
                  borderRadius: 3, cursor: "pointer",
                }}
              >
                Export GeoJSON
              </button>
              <button
                type="button"
                data-testid="export-csv-btn"
                onClick={handleExportCsv}
                aria-label="Export results as CSV"
                style={{
                  flex: 1, padding: "4px 6px", fontSize: 11,
                  background: "#fff", border: "1px solid #ddd",
                  borderRadius: 3, cursor: "pointer",
                }}
              >
                Export CSV
              </button>
            </div>
          )}
        </div>
      )}

      {/* Spinner keyframe */}
      <style>{"@keyframes spin { to { transform: rotate(360deg) } }"}</style>
    </div>
  )
}
