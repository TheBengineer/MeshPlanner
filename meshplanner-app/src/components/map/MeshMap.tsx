import { useRef, useCallback, useState, useEffect, useMemo } from 'react'
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

/*
 * Compute the SPLAT! tile region from selected sites and max range.
 * Returns a bbox covering all integer-degree tiles SPLAT! will load.
 */
function tileRegion(sites: { latitude: number; longitude: number }[], rangeKm: number): Bbox | null {
  if (sites.length === 0) return null
  const degPerKm = 1 / 111.0
  let minTileLat = Infinity, maxTileLat = -Infinity
  let minTileLon = Infinity, maxTileLon = -Infinity
  for (const s of sites) {
    const dLat = rangeKm * degPerKm
    const cosLat = Math.cos(s.latitude * Math.PI / 180)
    const dLon = cosLat > 0.01 ? rangeKm * degPerKm / cosLat : rangeKm * degPerKm / 0.01
    minTileLat = Math.min(minTileLat, Math.floor(s.latitude - dLat))
    maxTileLat = Math.max(maxTileLat, Math.floor(s.latitude + dLat))
    minTileLon = Math.min(minTileLon, Math.floor(s.longitude - dLon))
    maxTileLon = Math.max(maxTileLon, Math.floor(s.longitude + dLon))
  }
  return {
    west: minTileLon,
    south: minTileLat,
    east: maxTileLon + 1,
    north: maxTileLat + 1,
  }
}

interface MeshMapProps {
  sites?: CandidateSite[]
  selectedSiteNames?: string[]
  coverageImage?: CoverageImageResult | null
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
  const bbox = useStore((s) => s.bbox)
  const setBbox = useStore((s) => s.setBbox)
  const maxRangeKm = useStore((s) => s.coverageParams.maxRangeKm)

  /* ── Auto-compute bbox from selected sites + max range ── */
  const selectedSites = useMemo(
    () => sites.filter((s) => selectedSiteNames.includes(s.name)),
    [sites, selectedSiteNames],
  )
  const autoBbox = useMemo(
    () => tileRegion(selectedSites.length > 0 ? selectedSites : sites, maxRangeKm ?? 30),
    [selectedSites, sites, maxRangeKm],
  )
  const [initialised, setInitialised] = useState(false)
  useEffect(() => {
    if (!initialised && autoBbox) {
      setBbox(autoBbox)
      setInitialised(true)
    }
  }, [autoBbox, setBbox, initialised])
  useEffect(() => {
    if (initialised && autoBbox) setBbox(autoBbox)
  }, [autoBbox, setBbox, initialised])

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

  /* ── Terrain elevation image overlay ── */
  const prevTerrainImgRef = useRef<CoverageImageResult | null>(null)
  const showTerrain = useStore((s) => s.showTerrain)
  const terrainImg = useStore((s) => s.terrainImage)
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    if (prevTerrainImgRef.current) {
      try { map.removeLayer('terrain-layer'); map.removeSource('terrain-layer') }
      catch { /* already removed */ }
    }
    prevTerrainImgRef.current = null
    if (!showTerrain || !terrainImg) return
    prevTerrainImgRef.current = terrainImg as any
    const img = new window.Image()
    img.onload = () => {
      try {
        map.addSource('terrain-layer', {
          type: 'image' as const,
          url: terrainImg.url,
          coordinates: terrainImg.coordinates,
        })
        map.addLayer({
          id: 'terrain-layer',
          type: 'raster' as const,
          source: 'terrain-layer',
          paint: { 'raster-opacity': 0.6, 'raster-resampling': 'nearest' },
        })
      } catch (e) { console.warn('Failed to add terrain layer:', e) }
    }
    img.src = terrainImg.url
  }, [showTerrain, terrainImg])

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

  /* ── Map event handlers ── */
  const handleMoveEnd = useCallback((e: ViewStateChangeEvent) => {
    const vp = e.viewState
    setViewport(vp)
    useStore.getState().setViewport({ latitude: vp.latitude, longitude: vp.longitude, zoom: vp.zoom })
  }, [])

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
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
    [placing, onPlaceSite, onMapClick],
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
    },
    [onUpdateSitePosition],
  )

  const selectedSet = new Set(selectedSiteNames)

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
        dragPan={!dragging}
        onMoveEnd={handleMoveEnd}
        onClick={handleClick}
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

        {/* Bbox rectangle — display-only, matches SPLAT! tile region */}
        {bbox && (
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
              paint={{ 'line-color': '#3388ff', 'line-width': 2, 'line-dasharray': [4, 3] }}
            />
          </Source>
        )}
      </Map>
    </div>
  )
}
