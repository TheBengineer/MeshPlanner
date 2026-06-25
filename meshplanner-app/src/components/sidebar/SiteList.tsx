import type { CandidateSite } from '@/lib/types'

interface SiteListProps {
  sites: CandidateSite[]
  selectedNames: string[]
  onToggleSite: (name: string) => void
  onDeleteSite: (name: string) => void
  onClearAll: () => void
}

export function SiteList({ sites, selectedNames, onToggleSite, onDeleteSite, onClearAll }: SiteListProps) {
  if (sites.length === 0) {
    return <div style={{ padding: 8, color: '#888' }}>No sites loaded. Upload a CSV/GeoJSON file or add manually.</div>
  }
  
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px' }}>
        <strong>{sites.length} site(s)</strong>
        <button onClick={onClearAll} style={{ fontSize: 11 }}>Clear All</button>
      </div>
      {sites.map(site => (
        <div key={site.name} style={{ display: 'flex', alignItems: 'center', padding: '2px 8px', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={selectedNames.includes(site.name)}
            onChange={() => onToggleSite(site.name)}
            style={{ marginRight: 6 }}
          />
          <span style={{ flex: 1 }}>{site.name}</span>
          <span style={{ color: '#888', fontSize: 11 }}>{site.latitude.toFixed(3)}, {site.longitude.toFixed(3)}</span>
          <button onClick={() => onDeleteSite(site.name)} style={{ fontSize: 11, marginLeft: 4, color: '#c00' }}>✕</button>
        </div>
      ))}
    </div>
  )
}
