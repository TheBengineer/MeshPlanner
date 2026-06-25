import { useRef, useCallback, useState, useEffect } from 'react'
import Map, { Layer, Source, Marker } from 'react-map-gl/maplibre'
import type {
  MapRef,
  ViewStateChangeEvent,
  MapLayerMouseEvent,
  MapLayerTouchEvent,
} from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Bbox, CandidateSite } from '@/lib/types'

interface MeshMapProps {
  sites?: CandidateSite[]
  selectedSiteNames?: string[]
  coverageGeoJson?: GeoJSON.FeatureCollection
  onBboxSelect?: (bbox: Bbox) => void
  onMapClick?: (lat: number, lon: number) => void
  style?: React.CSSProperties
}

const LONG_PRESS_MS = 500

export function MeshMap({
  sites = [],
  selectedSiteNames = [],
  coverageGeoJson,
  onBboxSelect,
  onMapClick,
  style,
}: MeshMapProps) {
  const mapRef = useRef<MapRef>(null)
  const [viewport, setViewport] = useState({
    latitude: 35.6,
    longitude: -82.5,
    zoom: 10,
  })
  const [bbox, setBbox] = useState<Bbox | null>(null)
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

  /* ── Mouse handlers (desktop Shift+Click bbox) ── */

  const handleMoveEnd = useCallback((e: ViewStateChangeEvent) => {
    setViewport(e.viewState)
  }, [])

  const handleMouseDown = useCallback(
    (e: MapLayerMouseEvent) => {
      if (e.originalEvent.shiftKey) {
        setDrawing(true)
        setDrawStart({ lat: e.lngLat.lat, lng: e.lngLat.lng })
      }
    },
    [],
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
      if (!drawing) {
        onMapClick?.(e.lngLat.lat, e.lngLat.lng)
      }
    },
    [drawing, onMapClick],
  )

  /* ── Touch handlers (mobile long-press + drag bbox) ── */

  const handleTouchStart = useCallback(
    (e: MapLayerTouchEvent) => {
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
    [],
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

  const selectedSet = new Set(selectedSiteNames)

  return (
    <Map
      ref={mapRef}
      {...viewport}
      dragPan={!touchDrawing}
      onMoveEnd={handleMoveEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
      attributionControl={true}
      style={style ?? { width: '100%', height: '100%' }}
    >
      {/* Site markers */}
      {sites.map((site) => (
        <Marker
          key={site.name}
          latitude={site.latitude}
          longitude={site.longitude}
          color={selectedSet.has(site.name) ? '#e74c3c' : '#3498db'}
        />
      ))}

      {/* Bbox rectangle */}
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
            id="bbox-fill"
            type="fill"
            paint={{ 'fill-color': '#3388ff', 'fill-opacity': 0.1 }}
          />
          <Layer
            id="bbox-outline"
            type="line"
            paint={{ 'line-color': '#3388ff', 'line-width': 2 }}
          />
        </Source>
      )}

      {/* Coverage heatmap overlay */}
      {coverageGeoJson && (
        <Source id="coverage" type="geojson" data={coverageGeoJson}>
          <Layer
            id="coverage-fill"
            type="fill"
            paint={{ 'fill-color': '#e74c3c', 'fill-opacity': 0.3 }}
          />
        </Source>
      )}
    </Map>
  )
}
