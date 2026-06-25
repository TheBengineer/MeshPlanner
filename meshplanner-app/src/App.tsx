import { useState, useCallback } from 'react'
import { MeshMap } from '@/components/map/MeshMap'
import { BboxSelector } from '@/components/map/BboxSelector'
import { SiteList } from '@/components/sidebar/SiteList'
import { SiteForm } from '@/components/sidebar/SiteForm'
import { LoraParamsForm } from '@/components/sidebar/LoraParamsForm'
import { FileUpload } from '@/components/common/FileUpload'
import { ComputePanel } from '@/components/workflow/ComputePanel'
import { parseSitesCsv } from '@/lib/sites/csv'
import { parseSitesGeoJson } from '@/lib/sites/geojson'
import { useStore } from '@/store'
import type { Bbox, CandidateSite, LoraParams } from '@/lib/types'

export default function App() {
  const [mode, setMode] = useState<'coverage' | 'optimize' | 'batch'>('coverage')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const {
    sites, addSite, removeSite, clearSites,
    setBbox, toggleSiteSelection, selectedSiteNames,
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

  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  return (
    <div className="app-layout">
      {/* Hamburger toggle */}
      <button
        data-testid="hamburger-toggle"
        className={`hamburger-toggle${sidebarOpen ? ' hamburger-toggle--open' : ''}`}
        onClick={() => setSidebarOpen(prev => !prev)}
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
      <div data-testid="sidebar" className={`sidebar${sidebarOpen ? ' sidebar--open' : ''}`}>
        <div className="sidebar-header">
          <h2 data-testid="app-title" style={{ margin: 0, fontSize: 16 }}>MeshPlanner</h2>
          <p>LoRa Site Planner</p>
        </div>
        
        <div className="sidebar-section" style={{ padding: 8 }}>
          <label>
            Mode
            <select value={mode} onChange={e => setMode(e.target.value as any)} className="form-control--full" style={{ marginTop: 4 }}>
              <option value="coverage">Single Coverage</option>
              <option value="optimize">Optimize</option>
            </select>
          </label>
        </div>
        
        <BboxSelector onBboxChange={setBbox} />
        
        <div className="sidebar-section" style={{ padding: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Sites</div>
          <SiteForm onAddSite={addSite} />
          <FileUpload onFile={handleFileUpload} label="Upload CSV/GeoJSON" />
          <SiteList sites={sites} selectedNames={selectedSiteNames} onToggleSite={toggleSiteSelection} onDeleteSite={removeSite} onClearAll={clearSites} />
        </div>
        
        <ComputePanel />
        
        <LoraParamsForm onParamsChange={(params, kwargs) => {
          useStore.setState({ params })
          if (kwargs) updateCoverageParams(kwargs)
        }} />
      </div>
      
      <div data-testid="map-area" className="map-area">
        <MeshMap
          sites={sites}
          selectedSiteNames={selectedSiteNames}
          coverageGeoJson={coverageGeoJson ?? undefined}
        />
      </div>
    </div>
  )
}
