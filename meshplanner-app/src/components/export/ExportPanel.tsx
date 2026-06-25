import { useCallback } from "react"
import { useStore } from "@/store"
import type { CandidateSite, LoraParams } from "@/lib/types"
import type { CoverageParams } from "@/store"
import { downloadBlob } from "@/lib/export/geojson"

/* ── GeoJSON helper: filter sites → Point FeatureCollection ── */

function sitesToGeoJson(sites: CandidateSite[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: sites.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.longitude, s.latitude] },
      properties: {
        name: s.name,
        elevation_m: s.elevationM ?? null,
      },
    })),
  }
}

/* ── CSV helper: sites → CSV text ── */

function sitesToCsv(sites: CandidateSite[]): string {
  const lines = ['"name","latitude","longitude","elevation_m"']
  for (const s of sites) {
    const elev = s.elevationM != null ? String(s.elevationM) : ""
    lines.push(`"${s.name}",${s.latitude},${s.longitude},${elev}`)
  }
  return lines.join("\n")
}

/* ── KML helpers ── */

const XML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => XML_ENTITIES[ch] ?? ch)
}

/** Serialize a GeoJSON geometry to KML <coordinates> text. */
function geometryToKmlCoords(geom: GeoJSON.Geometry): string {
  if (geom.type === "Polygon") {
    const ring = geom.coordinates[0]
    if (!ring) return ""
    return ring.map(([lng, lat]) => `${lng},${lat},0`).join(" ")
  }
  if (geom.type === "MultiPolygon") {
    const parts: string[] = []
    for (const poly of geom.coordinates) {
      const ring = poly[0]
      if (!ring) continue
      parts.push(ring.map(([lng, lat]) => `${lng},${lat},0`).join(" "))
    }
    return parts.join(" ")
  }
  return ""
}

/** Build a complete KML document string with site points and coverage polygons. */
function buildKml(
  sites: CandidateSite[],
  coverageGj: GeoJSON.FeatureCollection | null,
): string {
  const placemarks: string[] = []

  // Coverage polygons (from the computed overlay)
  if (coverageGj?.features) {
    let polyIdx = 0
    for (const f of coverageGj.features) {
      if (!f.geometry) continue
      const coords = geometryToKmlCoords(f.geometry)
      if (!coords) continue
      polyIdx++
      placemarks.push(`  <Placemark>
    <name>Coverage Area ${polyIdx}</name>
    <styleUrl>#coverageStyle</styleUrl>
    <Polygon>
      <outerBoundaryIs>
        <LinearRing>
          <coordinates>${coords}</coordinates>
        </LinearRing>
      </outerBoundaryIs>
    </Polygon>
  </Placemark>`)
    }
  }

  // Site points
  for (const s of sites) {
    const desc = `${s.latitude}, ${s.longitude}${s.elevationM != null ? ` (${s.elevationM} m)` : ""}`
    placemarks.push(`  <Placemark>
    <name>${escapeXml(s.name)}</name>
    <description>${escapeXml(desc)}</description>
    <Point>
      <coordinates>${s.longitude},${s.latitude},0</coordinates>
    </Point>
  </Placemark>`)
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>MeshPlanner Coverage</name>
    <Style id="coverageStyle">
      <PolyStyle>
        <color>5014a0d4</color>
        <fill>1</fill>
        <outline>1</outline>
      </PolyStyle>
    </Style>
${placemarks.join("\n")}
  </Document>
</kml>`
}

/* ── Summary report ── */

function buildSummaryReport(
  params: LoraParams,
  coverageParams: CoverageParams,
  optimizationResult: import("@/lib/types").OptimizationResult | null,
  coverageResults: {
    coveredFraction: number
    coveredCells: number
    totalCells: number
    nSites: number
    computeTimeS: number
    threshold: number
  } | null,
  allSites: CandidateSite[],
): string {
  const siteMap = new Map(allSites.map((s) => [s.name, s]))
  const selectedNames = optimizationResult?.selectedSites ?? []
  const lines: string[] = [
    "═══════════════════════════════════════════════════════",
    "  MeshPlanner — Coverage Summary Report",
    "═══════════════════════════════════════════════════════",
    "",
    "── Parameters ──",
    `  Frequency:              ${params.frequencyMhz} MHz`,
    `  Spreading Factor:       SF${params.spreadingFactor}`,
    `  TX Power:               ${params.txPowerDbm} dBm`,
    `  TX Height:              ${params.txHeightM} m`,
    `  RX Height:              ${params.rxHeightM} m`,
    `  Bandwidth:              ${(params.bandwidthHz / 1000).toFixed(0)} kHz`,
    `  Required Margin:        ${params.requiredMarginDb} dB`,
    `  RX Sensitivity:         ${params.rxSensitivityDbm} dBm`,
    `  Max Range:              ${coverageParams.maxRangeKm} km`,
    `  Num Radials:            ${coverageParams.numRadials}`,
    `  RSSI Threshold:         ${coverageParams.threshold} dBm`,
    "",
    "── ITM Propagation ──",
    `  Climate:                ${params.climate ?? 5}`,
    `  Polarization:           ${params.polarization ?? 1}`,
    `  Ground Permittivity:    ${params.groundPermittivity ?? 15}`,
    `  Ground Conductivity:    ${params.groundConductivity ?? 0.005} S/m`,
    `  Surface Refractivity:   ${params.surfaceRefractivity ?? 314} N-units`,
    "",
    "── Results ──",
    `  Coverage:               ${coverageResults ? (coverageResults.coveredFraction * 100).toFixed(1) + "%" : "N/A"}`,
    `  Covered Cells:          ${coverageResults ? coverageResults.coveredCells.toLocaleString() : "N/A"}`,
    `  Total Cells:            ${coverageResults ? coverageResults.totalCells.toLocaleString() : "N/A"}`,
    `  Sites Evaluated:        ${coverageResults ? coverageResults.nSites : "N/A"}`,
    `  Computation Time:       ${coverageResults ? coverageResults.computeTimeS.toFixed(1) + " s" : "N/A"}`,
    "",
    "── Optimisation ──",
    `  Selected Sites:         ${optimizationResult ? optimizationResult.selectedSites.length + " sites" : "N/A"}`,
    `  Covered Fraction:       ${optimizationResult ? (optimizationResult.coveredFraction * 100).toFixed(1) + "%" : "N/A"}`,
    `  Solver Status:          ${optimizationResult ? optimizationResult.status : "N/A"}`,
    `  Solver Source:          ${optimizationResult ? optimizationResult.source : "N/A"}`,
    `  Solve Time:             ${optimizationResult ? optimizationResult.solveTimeS.toFixed(2) + " s" : "N/A"}`,
    `  Objective Value:        ${optimizationResult?.objectiveValue != null ? optimizationResult.objectiveValue.toFixed(4) : "N/A"}`,
    "",
    "── Selected Sites ──",
  ]

  if (selectedNames.length > 0) {
    for (const name of selectedNames) {
      const site = siteMap.get(name)
      if (site) {
        const elev = site.elevationM != null ? `, ${site.elevationM} m` : ""
        lines.push(`  • ${site.name}: ${site.latitude}, ${site.longitude}${elev}`)
      } else {
        lines.push(`  • ${name}`)
      }
    }
  } else {
    lines.push("  (none)")
  }

  lines.push("")
  lines.push("═══════════════════════════════════════════════════════")
  lines.push(`  Generated: ${new Date().toISOString()}`)
  lines.push("═══════════════════════════════════════════════════════")

  return lines.join("\n")
}

/* ── Shared button style ── */

const btnBase: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 600,
  border: "1px solid #ccc",
  borderRadius: 4,
  cursor: "pointer",
  textAlign: "left",
}

const btnDisabled: React.CSSProperties = {
  ...btnBase,
  background: "#f5f5f5",
  color: "#aaa",
  cursor: "not-allowed",
}

/* ── ExportPanel component ── */

export function ExportPanel() {
  const {
    sites,
    selectedSiteNames,
    params,
    coverageParams,
    optimizationResult,
    coverageResults,
    coverageGeoJson,
  } = useStore()

  // Sites to export: prefer optimization result, fall back to UI selection
  const exportSiteNames = optimizationResult?.selectedSites ?? selectedSiteNames
  const exportSites = sites.filter((s) => exportSiteNames.includes(s.name))
  const hasResults = optimizationResult !== null || coverageResults !== null

  /* GeoJSON — sites + coverage polygons */
  const handleExportGeoJson = useCallback(() => {
    const siteFc = sitesToGeoJson(exportSites)
    const features: GeoJSON.Feature[] = [...siteFc.features]

    if (coverageGeoJson?.features) {
      features.push(...(coverageGeoJson.features as GeoJSON.Feature[]))
    }

    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features,
    }

    downloadBlob(
      JSON.stringify(fc, null, 2),
      "meshplanner_export.geojson",
      "application/geo+json",
    )
  }, [exportSites, coverageGeoJson])

  /* CSV — site table */
  const handleExportCsv = useCallback(() => {
    const csv = sitesToCsv(exportSites)
    downloadBlob(csv, "meshplanner_sites.csv", "text/csv")
  }, [exportSites])

  /* KML — site points + coverage polygons */
  const handleExportKml = useCallback(() => {
    const kml = buildKml(exportSites, coverageGeoJson)
    downloadBlob(
      kml,
      "meshplanner_coverage.kml",
      "application/vnd.google-earth.kml+xml",
    )
  }, [exportSites, coverageGeoJson])

  /* Summary report — plain text */
  const handleExportSummary = useCallback(() => {
    const report = buildSummaryReport(
      params,
      coverageParams,
      optimizationResult,
      coverageResults,
      sites,
    )
    downloadBlob(report, "meshplanner_summary.txt", "text/plain")
  }, [params, coverageParams, optimizationResult, coverageResults, sites])

  return (
    <div data-testid="export-panel" style={{ borderTop: "1px solid #ddd", padding: "8px" }}>
      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13, color: "#333" }}>
        Export
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <button
          type="button"
          data-testid="export-geojson-btn"
          onClick={handleExportGeoJson}
          disabled={!hasResults}
          aria-label="Download results as GeoJSON"
          style={hasResults ? { ...btnBase, background: "#fff" } : btnDisabled}
        >
          Download GeoJSON
        </button>

        <button
          type="button"
          data-testid="export-csv-btn"
          onClick={handleExportCsv}
          disabled={!hasResults}
          aria-label="Download results as CSV"
          style={hasResults ? { ...btnBase, background: "#fff" } : btnDisabled}
        >
          Download CSV
        </button>

        <button
          type="button"
          data-testid="export-kml-btn"
          onClick={handleExportKml}
          disabled={!hasResults}
          aria-label="Download results as KML"
          style={hasResults ? { ...btnBase, background: "#fff" } : btnDisabled}
        >
          Download KML
        </button>

        <button
          type="button"
          data-testid="export-summary-btn"
          onClick={handleExportSummary}
          disabled={!hasResults}
          aria-label="Download summary report"
          style={hasResults ? { ...btnBase, background: "#fff" } : btnDisabled}
        >
          Summary Report
        </button>
      </div>
    </div>
  )
}
