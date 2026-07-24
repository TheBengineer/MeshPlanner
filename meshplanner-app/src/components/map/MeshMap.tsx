import { useRef, useCallback, useState, useEffect } from 'react'
import Map, { Layer, Source, Marker } from 'react-map-gl/maplibre'
import type {
  MapRef,
  ViewStateChangeEvent,
  MapLayerMouseEvent,
  MapLayerTouchEvent,
  MarkerDragEvent,
} from 'react-map-gl/maplibre'
import type { StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Bbox, CandidateSite } from '@/lib/types'
import type { CoverageImageResult } from '@/lib/render/coverage-image'
import { useStore } from '@/store'

interface MeshMapProps {
  sites?: CandidateSite[]
  selectedSiteNames?: string[]
  coverageImage?: CoverageImageResult | null
  bbox?: Bbox | null
  onBboxSelect?: (bbox: Bbox) => void
  onMapClick?: (lat: number, lon: number) => void
  /** When true, map click places a new site instead of normal click behavior */
  placing?: boolean
  /** Called when user clicks map in placing mode */
  onPlaceSite?: (lat: number, lon: number) => void
  /** Called when Escape is pressed in placing mode */
  onCancelPlacing?: () => void
  /** Called when a marker is dragged to a new position */
  onUpdateSitePosition?: (name: string, lat: number, lon: number) => void
  style?: React.CSSProperties
}

const LONG_PRESS_MS = 500

const TOPO_STYLE: StyleSpecification = {
  version: 8,
  name: 'OpenTopoMap',
  sources: {
    topo: {
      type: 'raster',
      tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenTopoMap (CC-BY-SA)',
      maxzoom: 17,
    },
  },
  layers: [
    { id: 'topo', type: 'raster', source: 'topo' },
  ],
}

export function MeshMap({
  sites = [],
  selectedSiteNames = [],
  coverageImage: coverageImg,
  bbox: externalBbox,
  onBboxSelect,
  onMapClick,
  placing = false,
  onPlaceSite,
  onCancelPlacing,
  onUpdateSitePosition,
  style,
}: MeshMapProps) {
  const mapRef = useRef<MapRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [viewport, setViewport] = useState({
    latitude: 35.6,
    longitude: -82.5,
    zoom: 10,
  })
  const defaultBbox: Bbox = { west: -82.6, south: 35.5, east: -82.4, north: 35.7 }
  const [bbox, setBbox] = useState<Bbox | null>(defaultBbox)
  const [drawing, setDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState<{
    lat: number
    lng: number
  } | null>(null)

  /* ── Touch long-press bbox drawing state ── */
  const [touchDrawing, setTouchDrawing] = useState(false)
  const touchDrawingRef = useRef(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartPoint = useRef<{ x: number; y: number } | null>(null)
  const touchDrawStart = useRef<{ lat: number; lng: number } | null>(null)

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  useEffect(() => clearLongPress, [clearLongPress])

  /* ── Coverage heatmap image overlay ── */
  const prevCoverageImgRef = useRef<CoverageImageResult | null>(null)
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    if (prevCoverageImgRef.current) {
      try {
        map.removeLayer('coverage-heatmap')
        map.removeSource('coverage-heatmap')
      } catch { /* already removed */ }
    }
    prevCoverageImgRef.current = coverageImg ?? null
    if (!coverageImg) return
    const img = new window.Image()
    img.onload = () => {
      try {
        map.addSource('coverage-heatmap', {
          type: 'image' as const,
          url: coverageImg.url,
          coordinates: coverageImg.coordinates,
        })
        map.addLayer({
          id: 'coverage-heatmap',
          type: 'raster' as const,
          source: 'coverage-heatmap',
          paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest' },
        })
      } catch (e) {
        console.warn('Failed to add coverage heatmap:', e)
      }
    }
    img.src = coverageImg.url
  }, [coverageImg])

  /* ── Sync external bbox (from sidebar) into local state ── */
  useEffect(() => {
    if (externalBbox) setBbox(externalBbox)
  }, [externalBbox])

  /* ── Sync initial default bbox to store on mount ── */
  useEffect(() => {
    if (!externalBbox) onBboxSelect?.(defaultBbox)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Escape key cancels placing mode ── */
  useEffect(() => {
    if (!placing) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancelPlacing?.()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [placing, onCancelPlacing])

  /* ── Update cursor on the map container ── */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.style.cursor = placing ? 'crosshair' : ''
  }, [placing])

  /* ── Mouse handlers (desktop Shift+Click bbox) ── */

  const handleMoveEnd = useCallback((e: ViewStateChangeEvent) => {
    const vp = e.viewState
    setViewport(vp)
    useStore.getState().setViewport({ latitude: vp.latitude, longitude: vp.longitude, zoom: vp.zoom })
  }, [])

  const handleMouseDown = useCallback(
    (e: MapLayerMouseEvent) => {
      if (e.originalEvent.shiftKey && !placing) {
        setDrawing(true)
        setDrawStart({ lat: e.lngLat.lat, lng: e.lngLat.lng })
      }
    },
    [placing],
  )

  const handleMouseUp = useCallback(
    (e: MapLayerMouseEvent) => {
      if (drawing && drawStart) {
        const ne = {
          lat: Math.max(drawStart.lat, e.lngLat.lat),
          lng: Math.max(drawStart.lng, e.lngLat.lng),
        }
        const sw = {
          lat: Math.min(drawStart.lat, e.lngLat.lat),
          lng: Math.min(drawStart.lng, e.lngLat.lng),
        }
        const newBbox: Bbox = {
          west: sw.lng,
          south: sw.lat,
          east: ne.lng,
          north: ne.lat,
        }
        setBbox(newBbox)
        onBboxSelect?.(newBbox)
        setDrawing(false)
        setDrawStart(null)
      }
    },
    [drawing, drawStart, onBboxSelect],
  )

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (drawing) return
      // Skip click if user just finished dragging a marker
      if (draggingRef.current) {
        draggingRef.current = false
        return
      }
      if (placing) {
        onPlaceSite?.(e.lngLat.lat, e.lngLat.lng)
        return
      }
      onMapClick?.(e.lngLat.lat, e.lngLat.lng)
    },
    [drawing, placing, onPlaceSite, onMapClick],
  )

  /* ── Marker drag handlers ── */
  const handleDragStart = useCallback(() => {
    draggingRef.current = true
    setDragging(true)
  }, [])

  const handleDrag = useCallback(
    (name: string, e: MarkerDragEvent) => {
      onUpdateSitePosition?.(name, e.lngLat.lat, e.lngLat.lng)
    },
    [onUpdateSitePosition],
  )

  const handleDragEnd = useCallback(
    (name: string, e: MarkerDragEvent) => {
      onUpdateSitePosition?.(name, e.lngLat.lat, e.lngLat.lng)
      setDragging(false)
      // draggingRef stays true — handleClick will consume and suppress it
    },
    [onUpdateSitePosition],
  )

  /* ── Touch handlers (mobile long-press + drag bbox) ── */

  const handleTouchStart = useCallback(
    (e: MapLayerTouchEvent) => {
      if (placing) return
      const touch = e.originalEvent.changedTouches?.[0]
      if (!touch) return
      touchStartPoint.current = { x: touch.clientX, y: touch.clientY }
      longPressTimer.current = setTimeout(() => {
        touchDrawingRef.current = true
        setTouchDrawing(true)
        touchDrawStart.current = { lat: e.lngLat.lat, lng: e.lngLat.lng }
        setDrawing(true)
        setDrawStart({ lat: e.lngLat.lat, lng: e.lngLat.lng })
      }, LONG_PRESS_MS)
    },
    [placing],
  )

  const handleTouchMove = useCallback(
    (e: MapLayerTouchEvent) => {
      const touch = e.originalEvent.changedTouches?.[0]
      if (!touch) return

      if (touchDrawingRef.current) {
        // In drawing mode — prevent map pan/zoom
        e.originalEvent.preventDefault()
        return
      }

      // Cancel long-press if finger moved > 10px from start
      if (touchStartPoint.current) {
        const dx = touch.clientX - touchStartPoint.current.x
        const dy = touch.clientY - touchStartPoint.current.y
        if (dx * dx + dy * dy > 100) {
          clearLongPress()
          touchStartPoint.current = null
        }
      }
    },
    [clearLongPress],
  )

  const handleTouchEnd = useCallback(
    (e: MapLayerTouchEvent) => {
      clearLongPress()
      touchStartPoint.current = null

      if (touchDrawingRef.current && touchDrawStart.current) {
        touchDrawingRef.current = false
        setTouchDrawing(false)
        const endLat = e.lngLat.lat
        const endLng = e.lngLat.lng
        const ne = {
          lat: Math.max(touchDrawStart.current.lat, endLat),
          lng: Math.max(touchDrawStart.current.lng, endLng),
        }
        const sw = {
          lat: Math.min(touchDrawStart.current.lat, endLat),
          lng: Math.min(touchDrawStart.current.lng, endLng),
        }
        const newBbox: Bbox = {
          west: sw.lng,
          south: sw.lat,
          east: ne.lng,
          north: ne.lat,
        }
        setBbox(newBbox)
        onBboxSelect?.(newBbox)
        setDrawing(false)
        setDrawStart(null)
        touchDrawStart.current = null
      }
    },
    [onBboxSelect, clearLongPress],
  )

  /* ── Bbox corner drag handlers ── */
  const updateBboxCorner = useCallback(
    (corner: string, lat: number, lng: number) => {
      setBbox((prev) => {
        if (!prev) return prev
        let { west, south, east, north } = prev
        switch (corner) {
          case 'sw': west = lng; south = lat; break
          case 'nw': west = lng; north = lat; break
          case 'se': east = lng; south = lat; break
          case 'ne': east = lng; north = lat; break
        }
        // Clamp to valid bounds and ensure min size
        west = Math.max(-180, Math.min(west, east - 0.001))
        east = Math.min(180, Math.max(east, west + 0.001))
        south = Math.max(-90, Math.min(south, north - 0.001))
        north = Math.min(90, Math.max(north, south + 0.001))
        return { west, south, east, north }
      })
    },
    [],
  )

  const handleBboxCornerDrag = useCallback(
    (_corner: string, _e: MarkerDragEvent) => {
      // position updated in onDragEnd after drag completes
    },
    [],
  )

  const handleBboxCornerDragEnd = useCallback(
    (corner: string, e: MarkerDragEvent) => {
      setBbox((prev) => {
        if (!prev) return prev
        let { west, south, east, north } = prev
        switch (corner) {
          case 'sw': west = e.lngLat.lng; south = e.lngLat.lat; break
          case 'nw': west = e.lngLat.lng; north = e.lngLat.lat; break
          case 'se': east = e.lngLat.lng; south = e.lngLat.lat; break
          case 'ne': east = e.lngLat.lng; north = e.lngLat.lat; break
        }
        west = Math.max(-180, Math.min(west, east - 0.001))
        east = Math.min(180, Math.max(east, west + 0.001))
        south = Math.max(-90, Math.min(south, north - 0.001))
        north = Math.min(90, Math.max(north, south + 0.001))
        const next = { west, south, east, north }
        // Use queueMicrotask to break out of React's render cycle
        queueMicrotask(() => onBboxSelect?.(next))
        return next
      })
      setDragging(false)
    },
    [onBboxSelect],
  )

  const selectedSet = new Set(selectedSiteNames)

  /* ── Bbox corner positions ── */
  const bboxCorners = bbox && !drawing
    ? [
        { id: 'sw', lat: bbox.south, lng: bbox.west },
        { id: 'nw', lat: bbox.north, lng: bbox.west },
        { id: 'se', lat: bbox.south, lng: bbox.east },
        { id: 'ne', lat: bbox.north, lng: bbox.east },
      ]
    : []

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        cursor: placing ? 'crosshair' : undefined,
      }}
    >
      <Map
        ref={mapRef}
        {...viewport}
        dragPan={!touchDrawing && !dragging}
        onMoveEnd={handleMoveEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        mapStyle={TOPO_STYLE}
        attributionControl={true}
        style={style ?? { width: '100%', height: '100%' }}
      >
        {/* Site markers */}
        {sites.map((site) => {
          const isSelected = selectedSet.has(site.name)
          return (
            <Marker
              key={site.name}
              latitude={site.latitude}
              longitude={site.longitude}
              draggable
              onDragStart={handleDragStart}
              onDrag={(e) => handleDrag(site.name, e)}
              onDragEnd={(e) => handleDragEnd(site.name, e)}
              style={{ zIndex: placing ? 10 : undefined, cursor: placing ? 'grab' : 'pointer' }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: isSelected ? '#e74c3c' : '#3498db',
                  border: '3px solid white',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                  cursor: 'inherit',
                }}
              />
            </Marker>
          )
        })}

        {/* Bbox rectangle — outline only */}
        {bbox && !drawing && (
          <Source
            id="bbox"
            type="geojson"
            data={{
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [bbox.west, bbox.south],
                    [bbox.east, bbox.south],
                    [bbox.east, bbox.north],
                    [bbox.west, bbox.north],
                    [bbox.west, bbox.south],
                  ],
                ],
              },
            }}
          >
            <Layer
              id="bbox-outline"
              type="line"
              paint={{ 'line-color': '#3388ff', 'line-width': 2 }}
            />
          </Source>
        )}

        {/* Bbox corner handles — draggable to resize */}
        {bboxCorners.map((c) => (
          <Marker
            key={c.id}
            latitude={c.lat}
            longitude={c.lng}
            draggable
            onDragStart={handleDragStart}
            onDragEnd={(e) => handleBboxCornerDragEnd(c.id, e)}
            style={{ zIndex: 5, cursor: 'nwse-resize' }}
          >
          <div
            style={{
              width: 14,
              height: 14,
              background: '#3388ff',
              border: '2px solid white',
              borderRadius: 2,
              boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
              cursor: 'inherit',
              margin: '-7px 0 0 -7px',
              transform: 'rotate(45deg)',
            }}
          />
          </Marker>
        ))}

      </Map>
    </div>
  )
}
