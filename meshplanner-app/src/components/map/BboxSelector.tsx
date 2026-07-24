import { useState, useEffect } from 'react'
import type { Bbox } from '@/lib/types'

interface BboxSelectorProps {
  bbox: Bbox | null
  onBboxChange: (bbox: Bbox) => void
}

export function BboxSelector({ bbox, onBboxChange }: BboxSelectorProps) {
  const [west, setWest] = useState(String(bbox?.west ?? -82.6))
  const [south, setSouth] = useState(String(bbox?.south ?? 35.5))
  const [east, setEast] = useState(String(bbox?.east ?? -82.4))
  const [north, setNorth] = useState(String(bbox?.north ?? 35.7))

  /* Sync from external bbox (e.g. corner drag on map) */
  useEffect(() => {
    if (bbox) {
      setWest(String(bbox.west))
      setSouth(String(bbox.south))
      setEast(String(bbox.east))
      setNorth(String(bbox.north))
    }
  }, [bbox])

  const handleApply = () => {
    // Snap to nearest integer degree tile using the midpoint of the inputs
    const w = parseFloat(west)
    const s = parseFloat(south)
    const e2 = parseFloat(east)
    const n = parseFloat(north)
    if (w < e2 && s < n) {
      const midLat = (s + n) / 2
      const midLng = (w + e2) / 2
      const snapped: Bbox = {
        west: Math.floor(midLng),
        south: Math.floor(midLat),
        east: Math.ceil(midLng),
        north: Math.ceil(midLat),
      }
      // Ensure 1°×1°
      if (snapped.east - snapped.west > 1) snapped.east = snapped.west + 1
      if (snapped.north - snapped.south > 1) snapped.north = snapped.south + 1
      onBboxChange(snapped)
      setWest(String(snapped.west))
      setSouth(String(snapped.south))
      setEast(String(snapped.east))
      setNorth(String(snapped.north))
    }
  }

  return (
    <div
      data-testid="bbox-selector"
      role="group"
      aria-label="Bounding box coordinates"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 4,
        padding: 8,
      }}
    >
      <label>
        West
        <input data-testid="bbox-west" value={west} onChange={(e) => setWest(e.target.value)} size={8} aria-label="Bounding box west longitude" />
      </label>
      <label>
        South
        <input data-testid="bbox-south" value={south} onChange={(e) => setSouth(e.target.value)} size={8} aria-label="Bounding box south latitude" />
      </label>
      <label>
        East
        <input data-testid="bbox-east" value={east} onChange={(e) => setEast(e.target.value)} size={8} aria-label="Bounding box east longitude" />
      </label>
      <label>
        North
        <input data-testid="bbox-north" value={north} onChange={(e) => setNorth(e.target.value)} size={8} aria-label="Bounding box north latitude" />
      </label>
      <button
        data-testid="bbox-apply"
        onClick={handleApply}
        aria-label="Apply bounding box"
        style={{ gridColumn: '1 / -1' }}
        type="button"
      >
        Apply
      </button>
    </div>
  )
}
