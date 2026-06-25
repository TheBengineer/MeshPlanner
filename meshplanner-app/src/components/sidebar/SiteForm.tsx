import { useState } from 'react'
import type { CandidateSite } from '@/lib/types'

interface SiteFormProps {
  onAddSite: (site: CandidateSite) => void
}

export function SiteForm({ onAddSite }: SiteFormProps) {
  const [name, setName] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const latNum = parseFloat(lat)
    const lonNum = parseFloat(lon)
    if (!name || isNaN(latNum) || isNaN(lonNum)) return
    if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) return
    onAddSite({ name: name.trim(), latitude: latNum, longitude: lonNum })
    setName(''); setLat(''); setLon('')
  }

  return (
    <form data-testid="site-form" onSubmit={handleSubmit} style={{ padding: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      <input data-testid="site-name-input" placeholder="Name" value={name} onChange={e => setName(e.target.value)} size={12} required />
      <input data-testid="site-lat-input" placeholder="Latitude" value={lat} onChange={e => setLat(e.target.value)} size={8} required />
      <input data-testid="site-lon-input" placeholder="Longitude" value={lon} onChange={e => setLon(e.target.value)} size={8} required />
      <button data-testid="site-add-btn" type="submit" style={{ fontSize: 12 }}>+ Add</button>
    </form>
  )
}
