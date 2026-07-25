import { useState } from 'react'
import type { CandidateSite } from '@/lib/types'

interface SiteListProps {
  sites: CandidateSite[]
  selectedNames: string[]
  onToggleSite: (name: string) => void
  onDeleteSite: (name: string) => void
  onClearAll: () => void
  onRenameSite: (oldName: string, newName: string) => void
}

export function SiteList({ sites, selectedNames, onToggleSite, onDeleteSite, onClearAll, onRenameSite }: SiteListProps) {
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const startEditing = (name: string) => {
    setEditingName(name)
    setEditValue(name)
  }

  const commitRename = (oldName: string) => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== oldName) {
      onRenameSite(oldName, trimmed)
    }
    setEditingName(null)
    setEditValue('')
  }

  const cancelEditing = () => {
    setEditingName(null)
    setEditValue('')
  }

  if (sites.length === 0) {
    return (
      <div
        data-testid="site-list-empty"
        role="status"
        aria-live="polite"
        style={{ padding: 8, color: '#888' }}
      >
        No sites loaded. Upload a CSV/GeoJSON file or add manually.
      </div>
    )
  }

  return (
    <div data-testid="site-list" role="region" aria-label="Site list">
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px' }}>
        <strong>{sites.length} site(s)</strong>
        <button
          onClick={onClearAll}
          aria-label="Clear all sites"
          style={{ fontSize: 11 }}
          type="button"
        >
          Clear All
        </button>
      </div>
      {sites.map(site => (
        <div
          key={site.name}
          data-testid={`site-item-${site.name}`}
          style={{ display: 'flex', alignItems: 'center', padding: '2px 8px', fontSize: 13 }}
        >
          <input
            type="checkbox"
            checked={selectedNames.includes(site.name)}
            onChange={() => onToggleSite(site.name)}
            aria-label={`Include site ${site.name} in computation`}
            style={{ marginRight: 6 }}
          />
          {editingName === site.name ? (
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => commitRename(site.name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(site.name)
                if (e.key === 'Escape') cancelEditing()
              }}
              autoFocus
              style={{ flex: 1, fontSize: 13, padding: '1px 4px' }}
              aria-label="Edit site name"
            />
          ) : (
            <span
              style={{ flex: 1, cursor: 'pointer' }}
              onClick={() => startEditing(site.name)}
              title="Click to rename"
            >
              {site.name}
            </span>
          )}
          <span style={{ color: '#888', fontSize: 11 }}>
            {site.latitude.toFixed(3)}, {site.longitude.toFixed(3)}
          </span>
          <button
            data-testid={`delete-site-${site.name}`}
            onClick={() => onDeleteSite(site.name)}
            aria-label={`Delete site ${site.name}`}
            style={{ fontSize: 11, marginLeft: 4, color: '#c00' }}
            type="button"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
