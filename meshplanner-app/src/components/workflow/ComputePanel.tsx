import { useCallback, useRef, useState, useEffect } from "react"
import { combineCoverage, combineAtThreshold } from "@/lib/combine/union"
import { fetchDemRaster } from "@/lib/dem/fetch"
import { downloadCsv, downloadGeoJson, rasterToCoverageGeoJson } from "@/lib/export/geojson"
import { greedyMinSites } from "@/lib/optimize/greedy"
import { buildCoverageMatrix } from "@/lib/optimize/matrix"
import { warmStartMinSites } from "@/lib/optimize/warmstart"
import { computeCoverageWithWorkers } from "@/workers/coverage-manager"
import { WasmCoverageEngine } from "@/engine/WasmCoverageEngine"
import { coverageImage } from "@/lib/render/coverage-image"
import { terrainImage } from "@/lib/render/terrain-image"
import type { CoverageRaster, OptimizationResult, MeshPlanResult, HilltopScored } from "@/lib/types"
import type { EngineRunParams } from "@/engine/core"
import { Affine } from "@/lib/math/affine"
import { scoutTerrain } from "@/lib/planning/scout"
import { buildMeshCoverageMatrix } from "@/lib/planning/matrix-builder"
import { computeConnectivityGraph } from "@/lib/planning/connectivity"
import { selectMeshSites } from "@/lib/planning/selector"
import { buildMst } from "@/lib/planning/mst"
import { useStore } from "@/store"

/* ── Point-in-polygon test (ray casting) ── */
function pointInPolygon(lon: number, lat: number, polygon: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]![0], yi = polygon[i]![1]
    const xj = polygon[j]![0], yj = polygon[j]![1]
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

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
  background: disabled ? "var(--bg-secondary)" : "var(--accent)",
  color: disabled ? "var(--text-secondary)" : "#fff",
  border: disabled ? "1px solid var(--border)" : "none",
  borderRadius: 4,
  cursor: disabled ? "not-allowed" : "pointer",
})

export function ComputePanel() {
  const {
    mode,
    bbox,
    coverageZone,
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
    colormap,
    updateCoverageParams,
    setComputing,
    setProgress,
    setCoverageGeoJson,
    setCoverageImage,
    setTerrainImage,
    setCoverageResults,
    setOptimizationResult,
    setGreedyResult,
    setOptimizationPhase,
    setImprovement,
    setError,
    /* Mesh planning */
    hilltopCandidates,
    meshPlanResult,
    mstEdges,
    meshPlanPhase,
    meshPlanProgress,
    setHilltopCandidates,
    setMeshPlanResult,
    setMstEdges,
    setMeshPlanPhase,
    setMeshPlanProgress,
  } = useStore()

  const resultsPanelRef = useRef<HTMLDivElement>(null)
  const computeInFlight = useRef(false)
  const errorRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const startTimeRef = useRef(0)
  const [elapsed, setElapsed] = useState(0)
  const [ramMb, setRamMb] = useState(0)
  const [demPct, setDemPct] = useState(0)

  /* Timer + RAM polling during computation. */
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (computing) {
      startTimeRef.current = performance.now()
      setElapsed(0)
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((performance.now() - startTimeRef.current) / 1000))
        const m = (performance as any).memory
        if (m) setRamMb(Math.round(m.usedJSHeapSize / (1024 * 1024)))
      }, 500)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [computing])

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

  const engineRef = useRef<WasmCoverageEngine | null>(null)
  const getEngine = () => {
    if (!engineRef.current) engineRef.current = new WasmCoverageEngine()
    return engineRef.current
  }

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
      const { maxRangeKm, numRadials, threshold, targetCoverage, highRes, debugTerrain } = coverageParams
      const ippd = highRes ? 3600 : 1200
      const demZoom = highRes ? 13 : 12

    try {
      // ── Step 1: Fetch DEM covering full SPLAT! page area ──
      // SPLAT! creates 1-degree terrain pages. The DEM must cover the
      // degree-aligned tiles, not just the bbox, or narrow/tall bboxes
      // produce pages with empty terrain data.
      setProgress({ current: 0, total: 4, label: "Loading DEM tiles…" })
      const demBbox = {
        west: Math.floor(bbox.west),
        south: Math.floor(bbox.south),
        east: Math.ceil(bbox.east),
        north: Math.ceil(bbox.north),
      }
      let dem
      try {
        dem = await fetchDemRaster(demBbox, (pct) => {
          setDemPct(pct)
          setProgress({ current: 0, total: 4, label: `Loading DEM tiles…` })
        }, demZoom)
      } catch (demErr) {
        const msg = demErr instanceof Error ? demErr.message : "Unknown DEM error"
        throw new Error(
          `Failed to fetch elevation data. ${msg}. Check your network connection and try again.`,
        )
      }
      const demAffine = dem.affine

      // Generate terrain elevation image for debugging
      const tImg = terrainImage(dem.data, dem.width, dem.height, demAffine)
      setTerrainImage(tImg)

      // ── Step 2: Compute coverage for each selected site ──
      setProgress({ current: 1, total: 4, label: `Computing coverage (${selectedSiteNames.length} sites)…` })
      const selectedSites = sites.filter((s) => selectedSiteNames.includes(s.name))
      const rasterMap = new Map<string, CoverageRaster>()
      for (const site of selectedSites) {
        try {
          // Use SPLAT! WASM engine for propagation
          const engineParams: EngineRunParams = {
            lat: site.latitude,
            lon: site.longitude,
            txHeightM: params.txHeightM,
            rxHeightM: params.rxHeightM,
            frequencyMhz: params.frequencyMhz,
            txPowerDbm: params.txPowerDbm,
            txAntennaGainDbi: params.txAntennaGainDbi,
            rxAntennaGainDbi: params.rxAntennaGainDbi,
            rxSensitivityDbm: params.rxSensitivityDbm,
            bandwidthHz: params.bandwidthHz,
            requiredMarginDb: params.requiredMarginDb,
            cableLossTxDb: params.cableLossTxDb,
            cableLossRxDb: params.cableLossRxDb,
            climate: params.climate ?? 5,
            polarization: params.polarization ?? 1,
            groundPermittivity: params.groundPermittivity ?? 15,
            groundConductivity: params.groundConductivity ?? 0.005,
            surfaceRefractivity: params.surfaceRefractivity ?? 314,
            clutterHeightM: coverageParams.clutterHeightM ?? 1.0,
            conf: coverageParams.situationFraction != null ? coverageParams.situationFraction / 100 : undefined,
            rel: coverageParams.timeFraction != null ? coverageParams.timeFraction / 100 : undefined,
            radiusKm: maxRangeKm,
            numRadials,
            resolutionIppd: ippd,
            debugTerrain: debugTerrain ?? false,
          }

          const engine = getEngine()
          const result = await engine.run(engineParams, {
            demData: dem.data,
            demWidth: dem.width,
            demHeight: dem.height,
            demAffine,
          })

          console.log('[ALIGN] DEM affine:', { a: demAffine.a, c: demAffine.c, f: demAffine.f, e: demAffine.e })
          console.log('[ALIGN] DEM bounds:', {
            north: demAffine.f, south: demAffine.f + dem.height * demAffine.e,
            west: demAffine.c, east: demAffine.c + dem.width * demAffine.a,
          })
          console.log('[ALIGN] Result bounds:', result.bounds)
          console.log('[ALIGN] Result size:', `${result.width}x${result.height}`)

          // Convert CoverageResult to CoverageRaster, sampled onto DEM grid
          // Use bilinear interpolation between SPLAT! pixels for smooth transitions
          const splatPixelLon = (result.bounds.east - result.bounds.west) / result.width
          const splatPixelLat = (result.bounds.north - result.bounds.south) / result.height
          const demRssi = new Float32Array(dem.width * dem.height).fill(-Infinity)
          for (let r = 0; r < dem.height; r++) {
            const lat = demAffine.f + r * demAffine.e
            for (let c = 0; c < dem.width; c++) {
              const lon = demAffine.c + c * demAffine.a
              const sc = (lon - result.bounds.west) / splatPixelLon
              const sr = (result.bounds.north - lat) / splatPixelLat
              // Bilinear interpolation between 4 nearest SPLAT! pixels
              const sc0 = Math.floor(sc); const sr0 = Math.floor(sr)
              const sc1 = sc0 + 1; const sr1 = sr0 + 1
              if (sc0 < 0 || sc1 >= result.width || sr0 < 0 || sr1 >= result.height) {
                // Use nearest-neighbor at edges
                const sci = Math.round(sc); const sri = Math.round(sr)
                if (sci >= 0 && sci < result.width && sri >= 0 && sri < result.height) {
                  demRssi[r * dem.width + c] = result.dbm[sri * result.width + sci]!
                }
                continue
              }
              const fx = sc - sc0; const fy = sr - sr0
              const v00 = result.dbm[sr0 * result.width + sc0]!
              const v10 = result.dbm[sr0 * result.width + sc1]!
              const v01 = result.dbm[sr1 * result.width + sc0]!
              const v11 = result.dbm[sr1 * result.width + sc1]!
              demRssi[r * dem.width + c] = v00 + (v10 - v00) * fx + (v01 - v00) * fy + (v11 - v10 - v01 + v00) * fx * fy
            }
          }
          const raster: CoverageRaster = {
            rssi: demRssi,
            width: dem.width,
            height: dem.height,
            affine: new Affine(demAffine.a, 0, demAffine.c, 0, demAffine.e, demAffine.f),
            txLat: site.latitude,
            txLon: site.longitude,
            params,
            maxRangeKm,
            numRadials,
          }
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
      const { width: cw, height: ch, affine } = combined
      const maskLen = cw * ch
      let coveredCells = 0
      let totalTargetCells = 0
      if (coverageZone && coverageZone.length >= 3) {
        for (let r = 0; r < ch; r++) {
          const lat = affine.f + r * affine.e
          for (let c = 0; c < cw; c++) {
            const lon = affine.c + c * affine.a
            if (!pointInPolygon(lon, lat, coverageZone)) continue
            totalTargetCells++
            const val = mask[r * cw + c]
            if (val && val >= 0.5) coveredCells++
          }
        }
      } else {
        for (let i = 0; i < maskLen; i++) {
          const val = mask[i]
          if (val && val >= 0.5) coveredCells++
        }
        totalTargetCells = maskLen
      }
      const coveredFraction = totalTargetCells > 0 ? coveredCells / totalTargetCells : 0

      const coverageGeoJson = rasterToCoverageGeoJson(
        mask, combined.width, combined.height, combined.affine, 4,
      )
      setCoverageGeoJson(coverageGeoJson)

      // Generate heatmap image overlay (colormapped, Mercator-corrected)
      const img = coverageImage(combined, {
        colormap,
        minDbm: debugTerrain ? 0 : threshold - 30,
        maxDbm: debugTerrain ? 1500 : -80,
        opacity: 0.7,
        sensitivityDbm: debugTerrain ? -9999 : threshold,
      })
      setCoverageImage(img)

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
        totalCells: totalTargetCells,
        coveredCells,
        nSites: greedy.selectedSites.length,
        computeTimeS,
        threshold,
        optimizationResult: greedy,
      })

      // ── Step 7: Optional ILP background upgrade ──
      const canUseIlp = false

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
              // hiGHS WASM load failed or ILP didn't improve — not a real error
              console.info('ILP fallback: using greedy result')
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

  const meshPlanInFlight = useRef(false)

  const handleMeshPlan = useCallback(async () => {
    if (meshPlanInFlight.current) return
    if (!bbox) { setError("Draw or enter a bounding box first"); return }

    meshPlanInFlight.current = true

    setComputing(true)
    setError(null)
    setHilltopCandidates([])
    setMeshPlanResult(null)
    setMstEdges([])
    setMeshPlanPhase("scout")
    setOptimizationPhase("computing")

    const { targetCoverage, maxRangeKm, numRadials, highRes } = coverageParams
    const ippd = highRes ? 3600 : 1200
    const demZoom = highRes ? 13 : 12

    const planStartTime = performance.now()

    try {
      // ── SCOUT phase: fetch DEM + detect hilltops ──
      setProgress({ current: 0, total: 100, label: "Scanning terrain…" })
      const demBbox = {
        west: Math.floor(bbox.west),
        south: Math.floor(bbox.south),
        east: Math.ceil(bbox.east),
        north: Math.ceil(bbox.north),
      }
      let dem
      try {
        dem = await fetchDemRaster(demBbox, (pct) => {
          setDemPct(pct)
          setProgress({ current: Math.round(pct * 0.2), total: 100, label: "Scanning terrain…" })
        }, demZoom)
      } catch (demErr) {
        const msg = demErr instanceof Error ? demErr.message : "Unknown DEM error"
        throw new Error(
          `Failed to fetch elevation data. ${msg}. Check your network connection and try again.`,
        )
      }
      const demAffine = dem.affine

      const candidates = await scoutTerrain(
        dem.data, dem.width, dem.height, demAffine, bbox,
      )
      if (candidates.length === 0) {
        throw new Error("No hilltop candidates found in the current area. Try a different bounding box.")
      }
      setHilltopCandidates(candidates)
      setMeshPlanProgress({ current: 20, total: 100, label: `${candidates.length} candidates found` })
      setProgress({ current: 20, total: 100, label: `${candidates.length} candidates found` })
      setMeshPlanPhase("compute")

      // ── COMPUTE phase: build coverage matrix ──
      setMeshPlanProgress({ current: 20, total: 100, label: "Computing coverage matrices…" })
      setProgress({ current: 20, total: 100, label: "Computing coverage matrices…" })
      const matrixResult = await buildMeshCoverageMatrix(
        candidates,
        dem.data, dem.width, dem.height, demAffine,
        params,
        { maxRangeKm, threshold: coverageParams.threshold, numRadials },
        undefined,
        (done, total) => {
          const pct = 20 + Math.round((done / total) * 40)
          setMeshPlanProgress({ current: pct, total: 100, label: `Computing coverage (${done}/${total})…` })
          setProgress({ current: pct, total: 100, label: `Computing coverage (${done}/${total})…` })
        },
      )
      setProgress({ current: 60, total: 100, label: "Computing connectivity…" })
      setMeshPlanProgress({ current: 60, total: 100, label: "Computing connectivity…" })
      setMeshPlanPhase("select")

      // ── SELECT phase: connectivity + greedy selector ──
      const connectivityEdges = computeConnectivityGraph(
        candidates,
        dem.data, dem.width, dem.height, demAffine,
        maxRangeKm,
        {
          frequencyMhz: params.frequencyMhz,
          txHeightM: params.txHeightM,
          rxHeightM: params.rxHeightM,
        },
      )
      const selectorResult = selectMeshSites(
        matrixResult.matrix,
        matrixResult.siteNames,
        connectivityEdges,
        targetCoverage,
      )
      setProgress({ current: 90, total: 100, label: "Building mesh tree…" })
      setMeshPlanProgress({ current: 90, total: 100, label: "Building mesh tree…" })
      setMeshPlanPhase("mst")

      // ── MST phase: build minimum spanning tree ──
      const mstEdges = buildMst(selectorResult.selected, connectivityEdges, candidates.length)
      setMstEdges(mstEdges)

      const planTimeS = (performance.now() - planStartTime) / 1000

      const result: MeshPlanResult = {
        selectedCandidates: selectorResult.selected.map((i) => candidates[i]).filter((c): c is HilltopScored => c !== undefined),
        mstEdges,
        coveredFraction: selectorResult.coveredFraction,
        totalCandidates: candidates.length,
        solveTimeS: planTimeS,
        gapFraction: 1 - selectorResult.coveredFraction,
        connected: selectorResult.connected,
      }
      setMeshPlanResult(result)
      setMeshPlanPhase("complete")
      setMeshPlanProgress({ current: 100, total: 100, label: "Plan complete" })
      setProgress({ current: 100, total: 100, label: "Plan complete" })
      setOptimizationPhase("greedy")

      // Focus results panel after compute completes
      resultsPanelRef.current?.focus()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Mesh planning failed"
      setError(msg)
      setMeshPlanPhase("error")
      console.error("Mesh plan error:", err)
      setTimeout(() => {
        errorRef.current?.focus()
      }, 0)
    } finally {
      setComputing(false)
      setProgress(null)
      setMeshPlanProgress(null)
      meshPlanInFlight.current = false
    }
  }, [
    bbox, params, coverageParams,
    setComputing, setProgress, setError,
    setHilltopCandidates, setMeshPlanResult, setMstEdges,
    setMeshPlanPhase, setMeshPlanProgress, setOptimizationPhase,
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

  const isMeshPlanRunning = meshPlanPhase !== "idle" && meshPlanPhase !== "complete" && meshPlanPhase !== "error"
  const disableMeshPlanButton = computing || !bbox

  const meshPlanButtonLabel = (() => {
    if (!computing) return "Plan Mesh"
    switch (meshPlanPhase) {
      case "scout": return "Scouting terrain…"
      case "compute": return "Computing matrices…"
      case "select": return "Selecting sites…"
      case "mst": return "Building mesh tree…"
      case "complete": return "Plan complete"
      case "error": return "Plan failed"
      default: return "Planning…"
    }
  })()

  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "8px" }}>

      {/* ── Compute button ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <button
          type="button"
          data-testid="compute-btn"
          onClick={handleCompute}
          disabled={disableButton}
          aria-label={disableButton ? `Compute coverage${!bbox ? " — bounding box required" : ""}${selectedSiteNames.length === 0 ? " — select at least one site" : ""}` : "Compute coverage"}
          aria-busy={computing ? "true" : undefined}
          style={{ ...primaryBtn(disableButton), flex: mode === "meshplan" ? 1 : undefined }}
        >
          {buttonLabel}
        </button>
        {mode === "meshplan" && (
          <button
            type="button"
            data-testid="mesh-plan-btn"
            onClick={handleMeshPlan}
            disabled={disableMeshPlanButton}
            aria-label={disableMeshPlanButton ? "Plan Mesh — bounding box required" : "Plan Mesh"}
            aria-busy={isMeshPlanRunning ? "true" : undefined}
            style={{ ...primaryBtn(disableMeshPlanButton), flex: 1 }}
          >
            {meshPlanButtonLabel}
          </button>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }} title="Show terrain elevation instead of signal strength">
          <input type="checkbox" checked={coverageParams.debugTerrain ?? false} onChange={e => updateCoverageParams({ debugTerrain: e.target.checked })} aria-label="Debug terrain mode" />
          Terrain
        </label>
      </div>

      {/* ── Progress bar (DEM/coverage/combine) ── */}
      {computing && progress && optimizationPhase === "computing" && (() => {
        // Step 0 (DEM): progress.current=0, demPct 0-100 fills the first 25%
        // Steps 1-4: progress.current/total fills proportionally
        let pct: number
        if (progress.total <= 4 && progress.current === 0 && demPct > 0) {
          pct = demPct  // DEM progress: 0-100% during tile loading
        } else {
          pct = progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0
        }
        const eta = pct > 0 && elapsed > 0 ? Math.round(elapsed / pct * (100 - pct)) : 0
        return (
          <div style={{ marginTop: 8 }} role="status" aria-live="polite" aria-label={progress.label}>
            <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
              <span>{progress.label}</span>
              <span>{pct}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
              <span>{elapsed}s elapsed</span>
              <span>{eta > 0 ? `${eta}s remaining` : ''}</span>
              <span>{ramMb > 0 ? `${ramMb} MB` : ''}</span>
            </div>
          </div>
        )
      })()}

      {/* ── Mesh plan progress bar ── */}
      {computing && meshPlanProgress && meshPlanPhase !== "idle" && meshPlanPhase !== "complete" && meshPlanPhase !== "error" && (
        (() => {
          const pct = Math.min(100, Math.max(0, Math.round((meshPlanProgress.current / meshPlanProgress.total) * 100)))
          const eta = pct > 0 && elapsed > 0 ? Math.round(elapsed / pct * (100 - pct)) : 0
          return (
            <div style={{ marginTop: 8 }} role="status" aria-live="polite" aria-label={meshPlanProgress.label}>
              <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 4, transition: 'width 0.3s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                <span>{meshPlanProgress.label}</span>
                <span>{pct}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                <span>{elapsed}s elapsed</span>
                <span>{eta > 0 ? `${eta}s remaining` : ''}</span>
                <span>{ramMb > 0 ? `${ramMb} MB` : ''}</span>
              </div>
            </div>
          )
        })()
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
            background: "var(--bg-secondary)",
            borderRadius: 4, fontSize: 12,
            display: "flex", alignItems: "center", gap: 6,
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          {optimizationPhase === "ilp-loading" && (
            <span style={{
              display: "inline-block",
              width: 10, height: 10,
              border: "2px solid var(--accent)",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              role: "img",
              "aria-label": "Solving",
            } as React.CSSProperties & { role: string }} />
          )}
          <span style={{
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
            background: "var(--bg-secondary)", color: "#fca5a5",
            borderRadius: 4, fontSize: 12,
            outline: "none",
            border: "1px solid #7f1d1d",
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
                color: "#fca5a5", cursor: "pointer",
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
                background: "#7f1d1d",
                color: "#fca5a5",
                border: "1px solid #991b1b",
                borderRadius: 3,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 11,
              }}
            >
              Retry
            </button>
          )}
          {/* Show retry button for mesh plan errors */}
          {meshPlanPhase === "error" && (
            <button
              type="button"
              onClick={() => {
                setMeshPlanPhase("idle")
                setError(null)
                setMeshPlanResult(null)
                setMstEdges([])
                setHilltopCandidates([])
                setMeshPlanProgress(null)
              }}
              aria-label="Retry mesh plan"
              style={{
                marginTop: 6,
                padding: "4px 12px",
                background: "#7f1d1d",
                color: "#fca5a5",
                border: "1px solid #991b1b",
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
            background: "var(--bg-secondary)", borderRadius: 4,
            fontSize: 12, color: "var(--text-secondary)",
            border: "1px solid var(--border)",
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
            background: "var(--bg-secondary)", borderRadius: 4,
            fontSize: 12, outline: "none",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13, color: "var(--text-h)" }}>
            Coverage Results
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
            <span style={{ color: "var(--text-secondary)" }}>Coverage:</span>
            <span style={{ fontWeight: 600 }}>
              {(coverageResults.coveredFraction * 100).toFixed(1)}%
            </span>
            <span style={{ color: "var(--text-secondary)" }}>Selected sites:</span>
            <span style={{ fontWeight: 600 }}>{coverageResults.nSites}</span>
            <span style={{ color: "var(--text-secondary)" }}>Cells covered:</span>
            <span style={{ fontWeight: 600 }}>
              {coverageResults.coveredCells.toLocaleString()} / {coverageResults.totalCells.toLocaleString()}
            </span>
            <span style={{ color: "var(--text-secondary)" }}>Time:</span>
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
                background: "var(--bg)", borderRadius: 3,
                fontWeight: 600, fontSize: 12, color: "var(--accent)",
                border: "1px solid var(--border)",
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
                background: "var(--bg)", borderRadius: 3,
                fontWeight: 500, fontSize: 12, color: "var(--text-secondary)",
                border: "1px solid var(--border)",
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
                background: "var(--bg)", borderRadius: 3,
                fontWeight: 500, fontSize: 12, color: "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              Greedy solution (ILP skipped on mobile)
            </div>
          )}

          {/* Solver info */}
          {optimizationResult && (
            <div style={{
              fontWeight: 600, marginTop: 6, marginBottom: 2,
              fontSize: 13, color: "var(--text-h)",
            }}>
              Optimisation
            </div>
          )}
          {optimizationResult && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
              <span style={{ color: "var(--text-secondary)" }}>Solver:</span>
              <span style={{ fontWeight: 600 }}>{optimizationResult.source}</span>
              <span style={{ color: "var(--text-secondary)" }}>Status:</span>
              <span style={{ fontWeight: 600 }}>{optimizationResult.status}</span>
              {optimizationResult.selectedSites.length <= 5 && (
                <>
                  <span style={{ color: "var(--text-secondary)" }}>Sites:</span>
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
                  background: "var(--bg)", border: "1px solid var(--border)",
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
                  background: "var(--bg)", border: "1px solid var(--border)",
                  borderRadius: 3, cursor: "pointer",
                }}
              >
                Export CSV
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Mesh plan results ── */}
      {meshPlanPhase === "complete" && meshPlanResult && (
        <div
          data-testid="mesh-plan-results"
          tabIndex={-1}
          role="region"
          aria-label="Mesh plan results"
          style={{
            marginTop: 8, padding: "8px",
            background: "var(--bg-secondary)", borderRadius: 4,
            fontSize: 12, outline: "none",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13, color: "var(--text-h)" }}>
            Mesh Plan Results
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
            <span style={{ color: "var(--text-secondary)" }}>Selected sites:</span>
            <span style={{ fontWeight: 600 }}>{meshPlanResult.selectedCandidates.length}</span>
            <span style={{ color: "var(--text-secondary)" }}>Covered fraction:</span>
            <span style={{ fontWeight: 600 }}>
              {(meshPlanResult.coveredFraction * 100).toFixed(1)}%
            </span>
            <span style={{ color: "var(--text-secondary)" }}>MST edges:</span>
            <span style={{ fontWeight: 600 }}>{meshPlanResult.mstEdges.length}</span>
            <span style={{ color: "var(--text-secondary)" }}>Connectivity:</span>
            <span style={{ fontWeight: 600, color: meshPlanResult.connected ? "var(--accent)" : "#fca5a5" }}>
              {meshPlanResult.connected ? "Connected" : `${(() => {
                const seen = new Set<number>()
                let components = 0
                for (const e of meshPlanResult.mstEdges) {
                  seen.add(e.sourceIdx)
                  seen.add(e.targetIdx)
                }
                const selected = new Set(meshPlanResult.selectedCandidates.map((_, i) => i))
                const isolated = [...selected].filter(i => !seen.has(i)).length
                components = (meshPlanResult.selectedCandidates.length - seen.size / 2) + isolated
                return components
              })()} components`}
            </span>
            <span style={{ color: "var(--text-secondary)" }}>Total candidates:</span>
            <span style={{ fontWeight: 600 }}>{meshPlanResult.totalCandidates}</span>
            <span style={{ color: "var(--text-secondary)" }}>Time:</span>
            <span style={{ fontWeight: 600 }}>{meshPlanResult.solveTimeS.toFixed(1)}s</span>
          </div>
        </div>
      )}

      {/* Spinner keyframe */}
      <style>{"@keyframes spin { to { transform: rotate(360deg) } }"}</style>
    </div>
  )
}
