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
 * Compute the coverage-area bounding box from selected sites and max range.
 * No tile snapping — responds to every range change. The DEM fetch in
 * ComputePanel internally snaps to degree boundaries for SPLAT! pages.
 */
function rangeBbox(sites: { latitude: number; longitude: number }[], rangeKm: number): Bbox | null {
  if (sites.length === 0) return null
  const degPerKm = 1 / 111.0
  let minLat = Infinity, maxLat = -Infinity
  let minLon = Infinity, maxLon = -Infinity
  for (const s of sites) {
    const dLat = rangeKm * degPerKm
    const cosLat = Math.cos(s.latitude * Math.PI / 180)
    const dLon = cosLat > 0.01 ? rangeKm * degPerKm / cosLat : rangeKm * degPerKm / 0.01
    minLat = Math.min(minLat, s.latitude - dLat)
    maxLat = Math.max(maxLat, s.latitude + dLat)
    minLon = Math.min(minLon, s.longitude - dLon)
    maxLon = Math.max(maxLon, s.longitude + dLon)
  }
  return { west: minLon, south: minLat, east: maxLon, north: maxLat }
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
  /** When true, map click creates a required-coverage site */
  coordPlacing?: boolean
  /** Called when user clicks map in coordPlacing mode */
  onPlaceCoordSite?: (lat: number, lon: number) => void
  /** Called when Escape is pressed in coordPlacing mode */
  onCancelCoordPlacing?: () => void
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
  coordPlacing = false,
  onPlaceCoordSite,
  onCancelCoordPlacing,
  onUpdateSitePosition,
  style,
}: MeshMapProps) {
  const mapRef = useRef<MapRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const storeViewport = useStore((s) => s.viewport)
  const [viewport, setViewport] = useState({
    latitude: storeViewport.latitude,
    longitude: storeViewport.longitude,
    zoom: storeViewport.zoom,
  })
  const bbox = useStore((s) => s.bbox)
  const setBbox = useStore((s) => s.setBbox)
  const coverageZone = useStore((s) => s.coverageZone)
  const setCoverageZone = useStore((s) => s.setCoverageZone)
  const maxRangeKm = useStore((s) => s.coverageParams.maxRangeKm)
  const hilltopCandidates = useStore((s) => s.hilltopCandidates)
  const meshPlanResult = useStore((s) => s.meshPlanResult)
  const meshPlanPhase = useStore((s) => s.meshPlanPhase)
  const buildingFootprints = useStore((s) => s.buildingFootprints)
  const showBuildings = useStore((s) => s.showBuildings)

  /* ── Auto-compute bbox from selected sites + max range ── */
  const selectedSites = useMemo(
    () => sites.filter((s) => selectedSiteNames.includes(s.name)),
    [sites, selectedSiteNames],
  )
  const autoBbox = useMemo(
    () => rangeBbox(selectedSites.length > 0 ? selectedSites : sites, maxRangeKm ?? 30),
    [selectedSites, sites, maxRangeKm],
  )
  const mstGeoJson = useMemo(() => {
    if (!meshPlanResult?.mstEdges?.length || !meshPlanResult.selectedCandidates) return null
    const features = meshPlanResult.mstEdges.map((edge) => {
      const src = meshPlanResult.selectedCandidates[edge.sourceIdx]
      const tgt = meshPlanResult.selectedCandidates[edge.targetIdx]
      if (!src || !tgt) return null
      return {
        type: 'Feature' as const,
        properties: { marginDb: edge.marginDb ?? -1 },
        geometry: {
          type: 'LineString' as const,
          coordinates: [[src.lon, src.lat], [tgt.lon, tgt.lat]],
        },
      }
    }).filter((f): f is NonNullable<typeof f> => f !== null)
    return { type: 'FeatureCollection' as const, features }
  }, [meshPlanResult])
  const buildingsGeoJson = useMemo(() => {
    if (!buildingFootprints || buildingFootprints.length === 0) return null
    const features = buildingFootprints.map((ring) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'Polygon' as const,
        coordinates: [ring],
      },
    }))
    return { type: 'FeatureCollection' as const, features }
  }, [buildingFootprints])
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

  /* ── Auto-init coverage zone from bbox on first creation ── */
  const czInitialised = useRef(false)
  useEffect(() => {
    if (!czInitialised.current && bbox && !coverageZone) {
      czInitialised.current = true
      setCoverageZone([
        [bbox.west, bbox.south],
        [bbox.east, bbox.south],
        [bbox.east, bbox.north],
        [bbox.west, bbox.north],
      ])
    }
  }, [bbox, coverageZone, setCoverageZone])

  /* ── Center on site when triggerCenterOnSite is called ── */
  const centerOnSite = useStore((s) => s.centerOnSite)
  const sitesStore = useStore((s) => s.sites)
  const selectedNames = useStore((s) => s.selectedSiteNames)
  useEffect(() => {
    if (centerOnSite === 0) return
    const first = sitesStore.find((s) => selectedNames.includes(s.name)) ?? sitesStore[0]
    if (first) mapRef.current?.getMap()?.flyTo({ center: [first.longitude, first.latitude], zoom: Math.max(viewport.zoom, 9) })
  }, [centerOnSite]) // eslint-disable-line react-hooks/exhaustive-deps

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

  /* ── Escape key cancels placing or coordPlacing mode ── */
  useEffect(() => {
    if (!placing && !coordPlacing) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancelPlacing?.()
        onCancelCoordPlacing?.()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [placing, coordPlacing, onCancelPlacing, onCancelCoordPlacing])

  /* ── Update cursor on the map container ── */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.style.cursor = (placing || coordPlacing) ? 'crosshair' : ''
  }, [placing, coordPlacing])

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
      if (coordPlacing) {
        onPlaceCoordSite?.(e.lngLat.lat, e.lngLat.lng)
        return
      }
      onMapClick?.(e.lngLat.lat, e.lngLat.lng)
    },
    [placing, coordPlacing, onPlaceSite, onPlaceCoordSite, onMapClick],
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
        cursor: (placing || coordPlacing) ? 'crosshair' : undefined,
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
        {/* Site markers — color by siteType, selected overrides to red */}
        {sites.map((site) => {
          const isSelected = selectedSet.has(site.name)
          const baseColor = site.siteType === 'existing' ? '#27ae60'
            : site.siteType === 'required-coverage' ? '#f39c12'
            : '#3498db'
          const size = site.siteType === 'required-coverage' ? 28 : 22
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
              <div style={{ position: 'relative', cursor: 'inherit' }}>
                <div
                  style={{
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    background: isSelected ? '#e74c3c' : baseColor,
                    border: '3px solid white',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                    cursor: 'inherit',
                  }}
                />
                <div
                  style={{
                    fontSize: 10,
                    color: '#000',
                    textShadow: '0 0 2px rgba(255,255,255,0.8), 0 1px 2px rgba(255,255,255,0.5)',
                    whiteSpace: 'nowrap',
                    position: 'absolute',
                    top: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    pointerEvents: 'none',
                  }}
                >
                  {site.name}
                </div>
              </div>
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

        {/* Coverage zone polygon — editable, defines desired coverage area */}
        {coverageZone && coverageZone.length >= 3 && (
          <Source
            id="coverage-zone"
            type="geojson"
            data={{
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [[...coverageZone, coverageZone[0]]],
              },
            }}
          >
            <Layer
              id="coverage-zone-fill"
              type="fill"
              paint={{
                'fill-color': '#3388ff',
                'fill-opacity': 0.08,
              }}
            />
            <Layer
              id="coverage-zone-outline"
              type="line"
              paint={{
                'line-color': '#3388ff',
                'line-width': 2,
                'line-dasharray': [4, 3],
              }}
            />
          </Source>
        )}

        {/* Coverage zone vertex handles — draggable */}
        {coverageZone && coverageZone.length >= 3 && coverageZone.map((coord, i) => (
          <Marker
            key={`cz-vertex-${i}`}
            latitude={coord[1]}
            longitude={coord[0]}
            draggable
            onDragStart={handleDragStart}
            onDrag={(e: MarkerDragEvent) => {
              const next = [...coverageZone]
              next[i] = [e.lngLat.lng, e.lngLat.lat]
              setCoverageZone(next)
            }}
            onDragEnd={(e: MarkerDragEvent) => {
              const next = [...coverageZone]
              next[i] = [e.lngLat.lng, e.lngLat.lat]
              setCoverageZone(next)
              setDragging(false)
            }}
            style={{ zIndex: 5, cursor: 'grab' }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: '#3388ff',
                border: '2px solid white',
                boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                cursor: 'inherit',
              }}
            />
          </Marker>
        ))}

        {/* ── Hilltop candidates (scout phase) ── */}
        {meshPlanPhase === 'scout' && hilltopCandidates.length > 0 && hilltopCandidates.map((c, i) => (
          <Marker
            key={`hilltop-${i}`}
            latitude={c.lat}
            longitude={c.lon}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#999',
                border: '1px solid #ccc',
              }}
            />
          </Marker>
        ))}

        {/* ── Selected mesh plan site markers ── */}
        {meshPlanResult?.selectedCandidates && meshPlanResult.selectedCandidates.map((c, i) => (
          <Marker
            key={`mesh-selected-${i}`}
            latitude={c.lat}
            longitude={c.lon}
          >
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: '#e74c3c',
                border: '3px solid white',
                boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
              }}
            />
          </Marker>
        ))}

        {/* ── MST edges ── */}
        {mstGeoJson && (
          <Source id="mesh-edges" type="geojson" data={mstGeoJson}>
            <Layer
              id="mesh-edges-line"
              type="line"
              paint={{
                'line-color': [
                  'case',
                  ['>=', ['get', 'marginDb'], 10], '#67ea94',
                  ['>=', ['get', 'marginDb'], 3], '#f5c518',
                  '#ff5c5c',
                ],
                'line-width': 2.5,
                'line-dasharray': [2, 1.5],
              }}
            />
          </Source>
        )}

        {/* ── Gap analysis overlay ── */}
        {meshPlanResult && bbox && (
          <Source
            id="mesh-gap"
            type="geojson"
            data={{
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [[
                  [bbox.west, bbox.south],
                  [bbox.east, bbox.south],
                  [bbox.east, bbox.north],
                  [bbox.west, bbox.north],
                  [bbox.west, bbox.south],
                ]],
              },
            }}
          >
            <Layer
              id="mesh-gap-fill"
              type="fill"
              paint={{
                'fill-color': '#ff0000',
                'fill-opacity': 0.15,
              }}
            />
          </Source>
        )}

        {/* ── Building footprints ── */}
        {showBuildings && buildingsGeoJson && (
          <Source id="buildings-source" type="geojson" data={buildingsGeoJson}>
            <Layer
              id="buildings-layer-fill"
              type="fill"
              paint={{
                'fill-color': '#e67e22',
                'fill-opacity': 0.3,
              }}
            />
            <Layer
              id="buildings-layer-outline"
              type="line"
              paint={{
                'line-color': '#d35400',
                'line-width': 1,
              }}
            />
          </Source>
        )}
      </Map>

      {/* ── Site type legend ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          background: 'rgba(255,255,255,0.95)',
          borderRadius: 8,
          padding: '8px 12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 12,
          lineHeight: '20px',
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#27ae60', border: '2px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.15)', flexShrink: 0 }} />
          <span style={{ color: '#333' }}>Existing LoRa Node</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#f39c12', border: '2px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.15)', flexShrink: 0 }} />
          <span style={{ color: '#333' }}>Requires Coverage</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#3498db', border: '2px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.15)', flexShrink: 0 }} />
          <span style={{ color: '#333' }}>Relay Candidate</span>
        </div>
      </div>
    </div>
  )
}
