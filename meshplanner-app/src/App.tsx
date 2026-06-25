import { lazy, Suspense, useCallback } from 'react'
import { BboxSelector } from '@/components/map/BboxSelector'
import { SiteList } from '@/components/sidebar/SiteList'
import { SiteForm } from '@/components/sidebar/SiteForm'
import { LoraParamsForm } from '@/components/sidebar/LoraParamsForm'
import { FileUpload } from '@/components/common/FileUpload'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { parseSitesCsv } from '@/lib/sites/csv'
import { parseSitesGeoJson } from '@/lib/sites/geojson'
import { useStore } from '@/store'
import type { AppMode } from '@/store'
import './App.css'

const MeshMap = lazy(() => import('@/components/map/MeshMap').then(m => ({ default: m.MeshMap })))
const ComputePanel = lazy(() => import('@/components/workflow/ComputePanel').then(m => ({ default: m.ComputePanel })))

export default function App() {
  const {
    sidebarOpen, setSidebarOpen,
    mode,
    sites, addSite, removeSite, clearSites,
    setBbox, setMode, toggleSiteSelection, selectedSiteNames,
    coverageGeoJson, updateCoverageParams,
  } = useStore()

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

        <BboxSelector onBboxChange={setBbox} />

        <div className="sidebar-section sidebar-section--padded">
          <div className="section-label">Sites</div>
          <SiteForm onAddSite={addSite} />
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
            coverageGeoJson={coverageGeoJson ?? undefined}
          />
        </Suspense>
      </div>
    </div>
  )
}
