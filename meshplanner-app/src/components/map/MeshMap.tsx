import { useRef, useCallback, useState } from 'react'
import Map, { Layer, Source, Marker } from 'react-map-gl/maplibre'
import type { MapRef, ViewStateChangeEvent, MapLayerMouseEvent } from 'react-map-gl/maplibre'
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
      // Only fire onMapClick if not drawing a bbox
      if (!drawing) {
        onMapClick?.(e.lngLat.lat, e.lngLat.lng)
      }
    },
    [drawing, onMapClick],
  )

  const selectedSet = new Set(selectedSiteNames)

  return (
    <Map
      ref={mapRef}
      {...viewport}
      onMoveEnd={handleMoveEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
      attributionControl={true}
      style={style ?? { width: '100%', height: '500px' }}
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
