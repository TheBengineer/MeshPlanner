import { lazy, Suspense, useCallback, useRef, useEffect } from 'react'
import { SiteList } from '@/components/sidebar/SiteList'
import { SiteForm } from '@/components/sidebar/SiteForm'
import { LoraParamsForm } from '@/components/sidebar/LoraParamsForm'
import { FileUpload } from '@/components/common/FileUpload'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { parseSitesCsv } from '@/lib/sites/csv'
import { parseSitesGeoJson } from '@/lib/sites/geojson'
import { useStore } from '@/store'
import type { AppMode } from '@/store'
import { encodeState, decodeState, extractState } from '@/lib/serializer'
import './App.css'

const MeshMap = lazy(() => import('@/components/map/MeshMap').then(m => ({ default: m.MeshMap })))
const ComputePanel = lazy(() => import('@/components/workflow/ComputePanel').then(m => ({ default: m.ComputePanel })))

export default function App() {
  const {
    sidebarOpen, setSidebarOpen,
    mode,
    sites, addSite, removeSite, clearSites,
    updateSitePosition,
    setMode, toggleSiteSelection, selectedSiteNames,
    coverageImage, updateCoverageParams,
    placing, setPlacing, showTerrain, setShowTerrain, terrainImage, setTerrainImage,
  } = useStore()

  const placeCounter = useRef(0)

  /* ── URL state persistence ── */

  const restoredRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Restore state from URL on mount
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true

    const params = new URLSearchParams(window.location.search)
    const encoded = params.get('state')
    if (!encoded) return

    const state = decodeState(encoded)
    if (!state) return

    const s = useStore.getState()
    // Only restore if there's actual state data
    if (state.s.length > 0 || state.b) {
      if (state.s.length > 0) {
        s.loadSites(state.s)
        // Restore selection
        if (state.sn.length > 0) {
          useStore.setState({ selectedSiteNames: state.sn })
        }
      }
      if (state.b) s.setBbox(state.b)
      if (state.p) {
        const merged: any = {}
        for (const [key, val] of Object.entries(state.p)) {
          if (val !== undefined) merged[key] = val
        }
        if (Object.keys(merged).length > 0) s.updateParams(merged)
      }
      if (state.cp) useStore.setState({ coverageParams: { ...s.coverageParams, ...state.cp } })
      else {
        // Legacy restore (single-field coverage attrs)
        if ((state as any).r) useStore.setState({ coverageParams: { ...s.coverageParams, maxRangeKm: (state as any).r } })
        if ((state as any).t) useStore.setState({ coverageParams: { ...s.coverageParams, threshold: (state as any).t } })
        if ((state as any).tc) useStore.setState({ coverageParams: { ...s.coverageParams, targetCoverage: (state as any).tc } })
      }
      if (state.c) s.setColormap(state.c)
      if (state.m) s.setMode(state.m)
    }
  }, [])

  // Subscribe to store changes → debounce → update URL
  useEffect(() => {
    const unsub = useStore.subscribe(() => {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const state = useStore.getState()
        const persisted = extractState(state)
        // Include viewport
        persisted.vp = {
          lat: state.viewport.latitude,
          lon: state.viewport.longitude,
          zoom: state.viewport.zoom,
        }
        const encoded = encodeState(persisted)
        const url = new URL(window.location.href)
        if (encoded) {
          url.searchParams.set('state', encoded)
        } else {
          url.searchParams.delete('state')
        }
        window.history.replaceState({}, '', url.toString())
      }, 500)
    })
    return unsub
  }, [])

  const handlePlaceSite = useCallback((lat: number, lon: number) => {
    placeCounter.current += 1
    const name = `Site ${placeCounter.current}`
    addSite({ name, latitude: lat, longitude: lon })
  }, [addSite])

  const handleTogglePlacing = useCallback(() => {
    setPlacing(!placing)
  }, [placing, setPlacing])

  const handleCancelPlacing = useCallback(() => {
    setPlacing(false)
  }, [setPlacing])

  const handleFileUpload = (content: string, filename: string) => {
    try {
      const parsed = filename.endsWith('.csv') ? parseSitesCsv(content) : parseSitesGeoJson(content)
      for (const site of parsed) addSite(site)
    } catch (e) {
      useStore.getState().setError(e instanceof Error ? e.message : 'Failed to parse sites file')
    }
  }

  const closeSidebar = useCallback(() => setSidebarOpen(false), [setSidebarOpen])

  return (
    <div className="app-layout">
      {/* Hamburger toggle */}
      <button
        data-testid="hamburger-toggle"
        className={`hamburger-toggle${sidebarOpen ? ' hamburger-toggle--open' : ''}`}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        type="button"
      >
        <span className="hamburger-toggle__icon">
          <span className="hamburger-toggle__bar" />
          <span className="hamburger-toggle__bar" />
          <span className="hamburger-toggle__bar" />
        </span>
      </button>

      {/* Sidebar overlay (mobile only) */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' sidebar-overlay--visible' : ''}`}
        onClick={closeSidebar}
        role="presentation"
      />

      {/* Sidebar */}
      <div
        data-testid="sidebar"
        className={`sidebar${sidebarOpen ? ' sidebar--open' : ''}`}
        role="dialog"
        aria-label="Configuration panel"
        aria-modal={sidebarOpen ? "true" : undefined}
      >
        <div className="sidebar-header">
          <h2 data-testid="app-title" className="app-title">MeshPlanner</h2>
          <p className="app-subtitle">LoRa Site Planner</p>
        </div>

        <div className="sidebar-section sidebar-section--padded">
          <label className="form-label--mode">
            Mode
            <select
              value={mode}
              onChange={e => setMode(e.target.value as AppMode)}
              className="form-control--full"
              aria-label="Application mode"
            >
              <option value="single">Single Coverage</option>
              <option value="optimize">Optimize</option>
              <option value="batch">Batch</option>
            </select>
          </label>
        </div>

        <div className="sidebar-section sidebar-section--padded">
          <div className="section-label">Sites</div>
          <SiteForm onAddSite={addSite} />

          {/* Terrain overlay toggle */}
          <button
            type="button"
            data-testid="terrain-toggle"
            onClick={() => setShowTerrain(!showTerrain)}
            aria-pressed={showTerrain}
            style={{
              width: '100%',
              marginTop: 6,
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              border: showTerrain ? '1px solid var(--accent)' : '1px solid var(--border)',
              borderRadius: 4,
              cursor: 'pointer',
              background: showTerrain ? 'var(--accent)' : 'var(--bg)',
              color: showTerrain ? '#fff' : 'var(--text-h)',
            }}
          >
            {showTerrain ? 'Terrain On' : 'Show Terrain'}
          </button>

          {/* Place button — toggles placing mode */}
          <button
            type="button"
            data-testid="place-btn"
            onClick={handleTogglePlacing}
            aria-label={placing ? 'Cancel placing mode' : 'Place sites on map'}
            aria-pressed={placing}
            style={{
              width: '100%',
              marginTop: 6,
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              border: placing ? '1px solid var(--accent)' : '1px solid var(--border)',
              borderRadius: 4,
              cursor: 'pointer',
              background: placing ? 'var(--accent)' : 'var(--bg)',
              color: placing ? '#fff' : 'var(--text-h)',
              transition: 'background 0.15s, border-color 0.15s',
              boxShadow: placing ? '0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent)' : 'none',
            }}
          >
            {placing ? 'Placing… (click map)  Esc to cancel' : '📍 Place Sites'}
          </button>

          <FileUpload onFile={handleFileUpload} label="Upload CSV/GeoJSON" />
          <SiteList
            sites={sites}
            selectedNames={selectedSiteNames}
            onToggleSite={toggleSiteSelection}
            onDeleteSite={removeSite}
            onClearAll={clearSites}
          />
        </div>

        <ErrorBoundary>
          <Suspense fallback={<div className="sidebar-loading">Loading computation engine…</div>}>
            <ComputePanel />
          </Suspense>
        </ErrorBoundary>

        <LoraParamsForm onParamsChange={(params, kwargs) => {
          useStore.setState({ params })
          if (kwargs) updateCoverageParams(kwargs)
        }} />
      </div>

      <div data-testid="map-area" className="map-area">
        <Suspense fallback={<div className="map-loading">Loading map…</div>}>
          <MeshMap
            sites={sites}
            selectedSiteNames={selectedSiteNames}
            coverageImage={coverageImage ?? undefined}
            placing={placing}
            onPlaceSite={handlePlaceSite}
            onCancelPlacing={handleCancelPlacing}
            onUpdateSitePosition={updateSitePosition}
          />
        </Suspense>
      </div>
    </div>
  )
}
