import { useState, useCallback } from "react"
import { useStore } from "@/store"
import { fetchOsmSites } from "@/lib/sites/osm"

/* ── Facility type definitions ── */

interface FacilityType {
  key: string
  label: string
}

const FACILITY_TYPES: FacilityType[] = [
  { key: "fire_station", label: "Fire Station" },
  { key: "police", label: "Police Station" },
  { key: "hospital", label: "Hospital" },
  { key: "school", label: "School" },
  { key: "town_hall", label: "Town Hall" },
]

/* ── Shared inline style objects ── */

const btnBase: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 4,
  cursor: "pointer",
}

/* ── Component ── */

export function CriticalInfraImport() {
  const [open, setOpen] = useState(false)
  const [selectedTags, setSelectedTags] = useState<Set<string>>(
    () => new Set(FACILITY_TYPES.map((f) => f.key)),
  )
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ count: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const bbox = useStore((s) => s.bbox)
  const addSite = useStore((s) => s.addSite)

  const handleToggleTag = useCallback((key: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const handleOpen = useCallback(() => {
    setOpen(true)
    setError(null)
    setResult(null)
  }, [])

  const handleCancel = useCallback(() => {
    setOpen(false)
    setError(null)
    setResult(null)
  }, [])

  const handleImport = useCallback(async () => {
    if (!bbox) {
      setError("No bounding box set. Draw a box on the map first.")
      return
    }
    if (selectedTags.size === 0) {
      setError("Select at least one facility type.")
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const sites = await fetchOsmSites(bbox, Array.from(selectedTags))
      if (sites.length === 0) {
        setError("No facilities found in this area.")
      } else {
        for (const site of sites) addSite(site)
        setResult({ count: sites.length })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to import facilities.")
    } finally {
      setLoading(false)
    }
  }, [bbox, selectedTags, addSite])

  return (
    <div data-testid="critical-infra-import">
      {/* Trigger button */}
      <button
        type="button"
        data-testid="infra-import-btn"
        onClick={handleOpen}
        style={{
          ...btnBase,
          width: "100%",
          marginTop: 6,
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--text-h)",
        }}
      >
        Import Critical Infrastructure
      </button>

      {/* Dialog overlay — fixed over the sidebar panel */}
      {open && (
        <div
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            width: 320,
            maxWidth: "90vw",
            maxHeight: "100vh",
            zIndex: 200,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 10px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <strong style={{ fontSize: 13 }}>Import from OSM</strong>
            <button
              type="button"
              onClick={handleCancel}
              aria-label="Close"
              style={{
                fontSize: 14,
                lineHeight: 1,
                border: "none",
                background: "none",
                cursor: "pointer",
                color: "var(--text-secondary)",
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>

          {/* Facility checkboxes */}
          <div style={{ padding: "6px 10px", flex: 1, overflowY: "auto" }}>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-secondary)",
                marginBottom: 6,
              }}
            >
              Select facility types to import:
            </div>
            {FACILITY_TYPES.map((ft) => (
              <label
                key={ft.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 0",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedTags.has(ft.key)}
                  onChange={() => handleToggleTag(ft.key)}
                />
                {ft.label}
              </label>
            ))}
          </div>

          {/* Status / result */}
          <div style={{ padding: "0 10px" }}>
            {loading && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  padding: "4px 0",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span className="spinner" />
                Importing…
              </div>
            )}
            {result && (
              <div style={{ fontSize: 12, color: "#2a7", padding: "4px 0" }}>
                Added {result.count} site{result.count !== 1 ? "s" : ""}.
              </div>
            )}
            {error && !loading && (
              <div style={{ fontSize: 12, color: "#c44", padding: "4px 0" }}>
                {error}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: "8px 10px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              onClick={handleCancel}
              style={{
                ...btnBase,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text-h)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="infra-import-confirm"
              onClick={handleImport}
              disabled={loading}
              style={{
                ...btnBase,
                border: "1px solid var(--accent)",
                cursor: loading ? "not-allowed" : "pointer",
                background: loading ? "var(--bg)" : "var(--accent)",
                color: loading ? "var(--text-secondary)" : "#fff",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
