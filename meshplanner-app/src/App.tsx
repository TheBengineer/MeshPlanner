import { useState } from 'react'
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
  const {
    sites, addSite, removeSite, clearSites,
    setBbox, toggleSiteSelection, selectedSiteNames,
    coverageGeoJson, updateCoverageParams,
  } = useStore()
  
  const handleFileUpload = (content: string, filename: string) => {
    try {
      const parsed = filename.endsWith('.csv') ? parseSitesCsv(content) : parseSitesGeoJson(content)
      for (const site of parsed) addSite(site)
    } catch (e) { console.error('Failed to parse sites:', e) }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: 320, overflowY: 'auto', borderRight: '1px solid #ddd', background: '#fafafa' }}>
        <div style={{ padding: 12, borderBottom: '1px solid #ddd' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>MeshPlanner</h2>
          <div style={{ fontSize: 11, color: '#888' }}>LoRa Site Planner</div>
        </div>
        
        <div style={{ padding: 8 }}>
          <label>Mode
            <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ width: '100%', marginTop: 4 }}>
              <option value="coverage">Single Coverage</option>
              <option value="optimize">Optimize</option>
            </select>
          </label>
        </div>
        
        <BboxSelector onBboxChange={setBbox} />
        
        <div style={{ borderTop: '1px solid #ddd', padding: 8 }}>
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
      
      <div style={{ flex: 1, position: 'relative' }}>
        <MeshMap
          sites={sites}
          selectedSiteNames={selectedSiteNames}
          coverageGeoJson={coverageGeoJson ?? undefined}
        />
      </div>
    </div>
  )
}
