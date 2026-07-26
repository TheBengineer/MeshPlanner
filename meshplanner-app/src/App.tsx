import { lazy, Suspense, useCallback, useRef, useEffect, useState } from 'react'
import { SiteList } from '@/components/sidebar/SiteList'
import { SiteForm } from '@/components/sidebar/SiteForm'
import { LoraParamsForm } from '@/components/sidebar/LoraParamsForm'
import { ExportPanel } from '@/components/export/ExportPanel'
import { FileUpload } from '@/components/common/FileUpload'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { CriticalInfraImport } from '@/components/common/CriticalInfraImport'
import { TabBar } from '@/components/layout/TabBar'
import { StepStepper } from '@/components/layout/StepStepper'
import { ModeToggle } from '@/components/layout/ModeToggle'
import { TutorialOverlay } from '@/components/tutorial/TutorialOverlay'
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
    sites, addSite, removeSite, clearSites, renameSite,
    updateSitePosition,
    setMode, toggleSiteSelection, selectedSiteNames,
    coverageImage, updateCoverageParams,
    placing, setPlacing, coordPlacing, setCoordPlacing, showTerrain, setShowTerrain, showBuildings, setShowBuildings, terrainImage, setTerrainImage,
    activeTab, setActiveTab,
    guidedMode,
  } = useStore()

  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [advOpen, setAdvOpen] = useState(false)

  const placeCounter = useRef(0)
  const coordPlaceCounter = useRef(0)

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
        if (state.sn.length > 0) {
          useStore.setState({ selectedSiteNames: state.sn })
        }
      }
      if (state.b) s.setBbox(state.b)
      // Restore settings key-value map — auto-distributes to typed fields
      if (state.kv && Object.keys(state.kv).length > 0) {
        for (const [key, val] of Object.entries(state.kv)) {
          if (val !== undefined) s.setSetting(key, val)
        }
      }
      if (state.c) s.setColormap(state.c)
      if (state.m) s.setMode(state.m)
      if (state.vp) useStore.setState({ viewport: { latitude: state.vp.lat, longitude: state.vp.lon, zoom: state.vp.zoom } })
      if (state.cz) useStore.setState({ coverageZone: state.cz })
      if (state.hc) useStore.setState({ hilltopCandidates: state.hc })
      if (state.mpr) useStore.setState({ meshPlanResult: state.mpr })
    }
  }, [])

  // Subscribe to store changes → debounce → update URL
  useEffect(() => {
    const unsub = useStore.subscribe(() => {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const state = useStore.getState()
        const persisted = extractState({
          sites: state.sites,
          selectedSiteNames: state.selectedSiteNames,
          mode: state.mode,
          bbox: state.bbox,
          settings: state.settings,
          coverageZone: state.coverageZone,
          hilltopCandidates: state.hilltopCandidates,
          meshPlanResult: state.meshPlanResult,
        })
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

  const handlePlaceCoordSite = useCallback((lat: number, lon: number) => {
    coordPlaceCounter.current += 1
    const name = `Coord Area ${coordPlaceCounter.current}`
    addSite({ name, latitude: lat, longitude: lon, siteType: 'required-coverage' })
  }, [addSite])

  const handleToggleCoordPlacing = useCallback(() => {
    setCoordPlacing(!coordPlacing)
  }, [coordPlacing, setCoordPlacing])

  const handleCancelCoordPlacing = useCallback(() => {
    setCoordPlacing(false)
  }, [setCoordPlacing])

  const handleFileUpload = (content: string, filename: string) => {
    try {
      const parsed = filename.endsWith('.csv') ? parseSitesCsv(content) : parseSitesGeoJson(content)
      for (const site of parsed) addSite(site)
    } catch (e) {
      useStore.getState().setError(e instanceof Error ? e.message : 'Failed to parse sites file')
    }
  }

  const closeSidebar = useCallback(() => setSidebarOpen(false), [setSidebarOpen])

  const handleStepClick = useCallback((index: number) => {
    const ids = ['step-disaster-limits', 'step-existing-required', 'step-params']
    const id = ids[index]
    if (id) {
      const el = document.getElementById(id)
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  return (
    <>
      {tutorialOpen && <TutorialOverlay onClose={() => setTutorialOpen(false)} />}
      {/* Top bar */}
      <div className="top-bar">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <h2 data-testid="app-title" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-h)', lineHeight: 1.3 }}>MeshPlanner</h2>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.2 }}>LoRa Communications Planner for Disaster Relief</span>
        </div>
        <div className="top-bar__actions">
          <button
            type="button"
            onClick={() => setTutorialOpen(true)}
            aria-label="Open tutorial"
            data-testid="tutorial-btn"
            style={{
              width: 28,
              height: 28,
              marginRight: 6,
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--bg-secondary)',
              color: 'var(--text)',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
            }}
          >
            ?
          </button>
          <ModeToggle />
          <select
            value={mode}
            onChange={e => setMode(e.target.value as AppMode)}
            aria-label="Application mode"
          >
            <option value="single">Single Coverage</option>
            <option value="optimize">Optimize</option>
            <option value="batch">Batch</option>
            <option value="meshplan">Mesh Plan</option>
          </select>
        </div>
      </div>
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
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === 'setup' && (
        <>
          {guidedMode && (
            <p style={{ padding: '8px 12px 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
              Set disaster area limits, add existing and required sites, then configure simulation parameters.
            </p>
          )}
          {guidedMode && <StepStepper currentStep={0} onStepClick={handleStepClick} />}
          <div className="sidebar-section sidebar-section--padded">
          {guidedMode ? <h3 id="step-existing-required" style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Existing and Required Sites</h3> : <div className="section-label">Existing and Required Sites</div>}
          <SiteForm onAddSite={addSite} />

          {guidedMode && <h3 id="step-disaster-limits" style={{ margin: '12px 0 8px', fontSize: 13, fontWeight: 600 }}>Disaster Area Limits</h3>}
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

          {/* Add Coordination Area button — toggles coordPlacing mode */}
          <button
            type="button"
            data-testid="coord-place-btn"
            onClick={handleToggleCoordPlacing}
            aria-label={coordPlacing ? 'Cancel coord placing mode' : 'Add coordination area on map'}
            aria-pressed={coordPlacing}
            style={{
              width: '100%',
              marginTop: 6,
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              border: coordPlacing ? '1px solid var(--accent)' : '1px solid var(--border)',
              borderRadius: 4,
              cursor: 'pointer',
              background: coordPlacing ? 'var(--accent)' : 'var(--bg)',
              color: coordPlacing ? '#fff' : 'var(--text-h)',
              transition: 'background 0.15s, border-color 0.15s',
              boxShadow: coordPlacing ? '0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent)' : 'none',
            }}
          >
            {coordPlacing ? 'Placing coordination area…' : '➕ Add Coordination Area'}
          </button>

          <FileUpload onFile={handleFileUpload} label="Upload CSV/GeoJSON" />
          <CriticalInfraImport />
          <button type="button" onClick={() => useStore.getState().triggerCenterOnSite()} style={{ width: '100%', padding: '4px 8px', marginTop: 4, marginBottom: 4, fontSize: 12 }}>Center on site</button>
          <SiteList
            sites={sites}
            selectedNames={selectedSiteNames}
            onToggleSite={toggleSiteSelection}
            onDeleteSite={removeSite}
            onClearAll={clearSites}
            onRenameSite={renameSite}
          />
        </div>
        </>
        )}

        {guidedMode && activeTab === 'plan' && (
          <p style={{ padding: '8px 12px 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
            Run the mesh planner to automatically find optimal hilltop relay locations and build a connected mesh network.
          </p>
        )}

        <ErrorBoundary>
          <Suspense fallback={<div className="sidebar-loading">Loading computation engine…</div>}>
            <ComputePanel />
          </Suspense>
        </ErrorBoundary>

        {activeTab === 'setup' && (
        <>
          {guidedMode && <h3 id="step-params" style={{ margin: '8px 12px 0', fontSize: 13, fontWeight: 600 }}>Params</h3>}
          <LoraParamsForm onParamsChange={(params, kwargs) => {
            useStore.setState({ params })
            if (kwargs) updateCoverageParams(kwargs)
          }} />
          {(() => {
            return (
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 8 }}>
                <div role="button" tabIndex={0} onClick={() => setAdvOpen(!advOpen)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAdvOpen(!advOpen) } }} aria-expanded={advOpen} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', cursor: 'pointer', userSelect: 'none', fontSize: 13, fontWeight: 600 }}>
                  <span style={{ fontSize: 16 }}>⚙</span>
                  <span>Advanced</span>
                  <span style={{ marginLeft: 'auto', transition: 'transform 0.2s', transform: advOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} aria-hidden="true">▶</span>
                </div>
                {advOpen && (
                  <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button type="button" onClick={() => setShowTerrain(!showTerrain)} aria-pressed={showTerrain} style={{ width: '100%', padding: '6px 10px', fontSize: 12, fontWeight: 600, border: showTerrain ? '1px solid var(--accent)' : '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', background: showTerrain ? 'var(--accent)' : 'var(--bg)', color: showTerrain ? '#fff' : 'var(--text-h)' }}>
                      {showTerrain ? 'Terrain On' : 'Show Terrain'}
                    </button>
                    <button type="button" onClick={() => setShowBuildings(!showBuildings)} aria-pressed={showBuildings} style={{ width: '100%', padding: '6px 10px', fontSize: 12, fontWeight: 600, border: showBuildings ? '1px solid var(--accent)' : '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', background: showBuildings ? 'var(--accent)' : 'var(--bg)', color: showBuildings ? '#fff' : 'var(--text-h)' }}>
                      {showBuildings ? 'Buildings On' : 'Show Buildings'}
                    </button>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={useStore.getState().coverageParams.debugTerrain ?? false} onChange={e => useStore.getState().updateCoverageParams({ debugTerrain: e.target.checked })} aria-label="Debug terrain mode" />
                      Debug Terrain
                    </label>
                  </div>
                )}
              </div>
            )
          })()}
        </>
        )}
        {activeTab === 'results' && (
        <>
          {guidedMode && (
            <p style={{ padding: '8px 12px 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
              Review coverage metrics, compare optimization results, and export your deployment plan.
            </p>
          )}
          <ExportPanel />
        </>
        )}
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
            coordPlacing={coordPlacing}
            onPlaceCoordSite={handlePlaceCoordSite}
            onCancelCoordPlacing={handleCancelCoordPlacing}
            onUpdateSitePosition={updateSitePosition}
          />
        </Suspense>
      </div>
    </div>
    </>
  )
}
