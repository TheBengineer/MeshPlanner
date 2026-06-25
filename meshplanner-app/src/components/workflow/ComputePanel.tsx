import { useCallback } from "react"
import { combineCoverage, combineAtThreshold } from "@/lib/combine/union"
import { fetchDemRaster } from "@/lib/dem/fetch"
import { downloadCsv, downloadGeoJson, rasterToCoverageGeoJson } from "@/lib/export/geojson"
import { greedyMinSites } from "@/lib/optimize/greedy"
import { buildCoverageMatrix } from "@/lib/optimize/matrix"
import { computeCoverageRaster } from "@/lib/propagation/coverage"
import type { CoverageRaster } from "@/lib/types"
import { useStore } from "@/store"

export function ComputePanel() {
  const {
    bbox,
    sites,
    selectedSiteNames,
    params,
    coverageParams,
    computing,
    progress,
    coverageResults,
    optimizationResult,
    error,
    setComputing,
    setProgress,
    setCoverageGeoJson,
    setCoverageResults,
    setOptimizationResult,
    setError,
  } = useStore()

  const handleCompute = useCallback(async () => {
    if (!bbox) { setError("Draw or enter a bounding box first"); return }
    if (selectedSiteNames.length === 0) { setError("Add at least one site"); return }

    setComputing(true)
    setError(null)
    setCoverageResults(null)
    setOptimizationResult(null)
    setCoverageGeoJson(null)

    const startTime = performance.now()
    const { maxRangeKm, numRadials, threshold, targetCoverage } = coverageParams

    try {
      // --- Step 1: Fetch DEM ---
      setProgress({ current: 0, total: 4, label: "Fetching DEM tiles…" })
      const dem = await fetchDemRaster(bbox, (pct) => {
        setProgress({ current: 0, total: 4, label: `DEM: ${pct}%` })
      })
      const demAffine = dem.affine // { a, c, f, e }

      // --- Step 2: Compute coverage for each selected site ---
      setProgress({ current: 1, total: 4, label: `Computing coverage (${selectedSiteNames.length} sites)…` })
      const selectedSites = sites.filter((s) => selectedSiteNames.includes(s.name))
      const rasterMap = new Map<string, CoverageRaster>()
      for (const site of selectedSites) {
        const raster = computeCoverageRaster(
          dem.data, dem.width, dem.height, demAffine,
          site.latitude, site.longitude,
          params, maxRangeKm, numRadials,
        )
        rasterMap.set(site.name, raster)
      }

      // --- Step 3: Combine coverage rasters ---
      setProgress({ current: 2, total: 4, label: "Combining coverage rasters…" })
      const rasters = [...rasterMap.values()]
      const combined = combineCoverage(rasters, "best")

      // --- Step 4: Threshold mask + GeoJSON overlay ---
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

      // --- Step 5: Build matrix and optimize ---
      setProgress({ current: 4, total: 4, label: "Optimising site selection…" })
      const matrixCellSize = 4
      const matrix = buildCoverageMatrix(rasterMap, threshold, matrixCellSize)
      const optimResult = greedyMinSites(matrix, [...rasterMap.keys()], targetCoverage)

      const computeTimeS = (performance.now() - startTime) / 1000

      setOptimizationResult(optimResult)
      setCoverageResults({
        coveredFraction,
        totalCells: maskLen,
        coveredCells,
        nSites: selectedSiteNames.length,
        computeTimeS,
        threshold,
        optimizationResult: optimResult,
      })
      setProgress(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Computation failed"
      setError(msg)
      console.error("Compute error:", err)
    } finally {
      setComputing(false)
      setProgress(null)
    }
  }, [
    bbox, sites, selectedSiteNames, params, coverageParams,
    setComputing, setProgress, setCoverageGeoJson,
    setCoverageResults, setOptimizationResult, setError,
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

  return (
    <div style={{ borderTop: "1px solid #ddd", padding: "8px" }}>
      {/* Compute button */}
      <button
        type="button"
        onClick={handleCompute}
        disabled={computing || !bbox || selectedSiteNames.length === 0}
        style={{
          width: "100%",
          padding: "8px 12px",
          fontWeight: 600,
          fontSize: 13,
          background: computing ? "#ccc" : "#1a73e8",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          cursor: computing ? "not-allowed" : "pointer",
        }}
      >
        {computing ? "Computing…" : "Compute Coverage"}
      </button>

      {/* Loading indicator */}
      {computing && progress && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              display: "inline-block",
              width: 12, height: 12,
              border: "2px solid #1a73e8",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }} />
            <span>{progress.label}</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{
          marginTop: 8, padding: "6px 8px",
          background: "#fef2f2", color: "#b91c1c",
          borderRadius: 4, fontSize: 12,
        }}>
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              marginLeft: 8, background: "none", border: "none",
              color: "#b91c1c", cursor: "pointer", fontWeight: 600, fontSize: 12,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Results metrics */}
      {coverageResults && !computing && (
        <div style={{
          marginTop: 8, padding: "8px",
          background: "#f0fdf4", borderRadius: 4,
          fontSize: 12,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13, color: "#166534" }}>
            Coverage Results
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
            <span style={{ color: "#555" }}>Coverage:</span>
            <span style={{ fontWeight: 600 }}>
              {(coverageResults.coveredFraction * 100).toFixed(1)}%
            </span>
            <span style={{ color: "#555" }}>Sites:</span>
            <span style={{ fontWeight: 600 }}>{coverageResults.nSites}</span>
            <span style={{ color: "#555" }}>Cells covered:</span>
            <span style={{ fontWeight: 600 }}>
              {coverageResults.coveredCells.toLocaleString()} / {coverageResults.totalCells.toLocaleString()}
            </span>
            <span style={{ color: "#555" }}>Time:</span>
            <span style={{ fontWeight: 600 }}>{coverageResults.computeTimeS.toFixed(1)}s</span>
          </div>
          {optimizationResult && (
            <>
              <div style={{
                fontWeight: 600, marginTop: 6, marginBottom: 2,
                fontSize: 13, color: "#166534",
              }}>
                Optimisation
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
                <span style={{ color: "#555" }}>Selected:</span>
                <span style={{ fontWeight: 600 }}>{optimizationResult.selectedSites.length} sites</span>
                <span style={{ color: "#555" }}>Status:</span>
                <span style={{ fontWeight: 600 }}>{optimizationResult.status}</span>
                <span style={{ color: "#555" }}>Solver:</span>
                <span style={{ fontWeight: 600 }}>{optimizationResult.source}</span>
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
            </>
          )}

          {/* Export buttons */}
          <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
          <button
            type="button"
            onClick={handleExportGeoJson}
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
            onClick={handleExportCsv}
              style={{
                flex: 1, padding: "4px 6px", fontSize: 11,
                background: "#fff", border: "1px solid #ddd",
                borderRadius: 3, cursor: "pointer",
              }}
            >
              Export CSV
            </button>
          </div>
        </div>
      )}

      {/* Spinner keyframe */}
      <style>{"@keyframes spin { to { transform: rotate(360deg) } }"}</style>
    </div>
  )
}
