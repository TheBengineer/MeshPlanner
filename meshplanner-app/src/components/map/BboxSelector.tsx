import { useState } from 'react'
import type { Bbox } from '@/lib/types'

interface BboxSelectorProps {
  onBboxChange: (bbox: Bbox) => void
  initialBbox?: Bbox
}

export function BboxSelector({ onBboxChange, initialBbox }: BboxSelectorProps) {
  const [west, setWest] = useState(String(initialBbox?.west ?? -82.6))
  const [south, setSouth] = useState(String(initialBbox?.south ?? 35.5))
  const [east, setEast] = useState(String(initialBbox?.east ?? -82.4))
  const [north, setNorth] = useState(String(initialBbox?.north ?? 35.7))

  const handleApply = () => {
    const bbox: Bbox = {
      west: parseFloat(west),
      south: parseFloat(south),
      east: parseFloat(east),
      north: parseFloat(north),
    }
    if (bbox.west < bbox.east && bbox.south < bbox.north) {
      onBboxChange(bbox)
    }
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 4,
        padding: 8,
      }}
    >
      <label>
        West
        <input value={west} onChange={(e) => setWest(e.target.value)} size={8} />
      </label>
      <label>
        South
        <input value={south} onChange={(e) => setSouth(e.target.value)} size={8} />
      </label>
      <label>
        East
        <input value={east} onChange={(e) => setEast(e.target.value)} size={8} />
      </label>
      <label>
        North
        <input value={north} onChange={(e) => setNorth(e.target.value)} size={8} />
      </label>
      <button onClick={handleApply} style={{ gridColumn: '1 / -1' }}>
        Apply
      </button>
    </div>
  )
}
