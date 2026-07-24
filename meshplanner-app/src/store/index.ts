import { create } from "zustand"
import type { Bbox, CandidateSite, LoraParams, LinkBudget, CoverageRaster, OptimizationResult } from "@/lib/types"
import type { CoverageImageResult } from "@/lib/render/coverage-image"
import type { TerrainImageResult } from "@/lib/render/terrain-image"
import { DEFAULT_LORA_PARAMS } from "@/lib/constants"
import { calculateLinkBudget } from "@/lib/math/link-budget"

/* ── Sites slice ── */

export interface SitesSlice {
  sites: CandidateSite[]
  selectedSiteNames: string[]
  addSite: (site: CandidateSite) => void
  removeSite: (name: string) => void
  updateSitePosition: (name: string, lat: number, lon: number) => void
  toggleSite: (name: string) => void
  toggleSiteSelection: (name: string) => void
  clearSites: () => void
  loadSites: (sites: CandidateSite[]) => void
}

/* ── Coverage compute params ── */

export interface CoverageParams {
  maxRangeKm: number
  numRadials: number
  threshold: number
  targetCoverage: number
  highRes?: boolean
  clutterHeightM?: number
  situationFraction?: number
  timeFraction?: number
  debugTerrain?: boolean
}

/* ── Params slice ── */

export interface ParamsSlice {
  params: LoraParams
  coverageParams: CoverageParams
  /** Flat key-value store mirroring all user-configurable settings for easy serialization. */
  settings: Record<string, any>
  linkBudget: LinkBudget | null
  updateParams: (partial: Partial<LoraParams>) => void
  updateCoverageParams: (partial: Partial<CoverageParams>) => void
  /** Update a single setting by key (syncs to typed fields automatically). */
  setSetting: (key: string, value: any) => void
  recalcLinkBudget: (pathLossDb?: number) => void
}

/* ── Map / Bbox slice ── */

export interface MapSlice {
  bbox: Bbox | null
  coverageGeoJson: GeoJSON.FeatureCollection | null
  coverageImage: CoverageImageResult | null
  terrainImage: TerrainImageResult | null
  viewport: { latitude: number; longitude: number; zoom: number }
  centerOnSite: number
  setBbox: (bbox: Bbox | null) => void
  setCoverageGeoJson: (gj: GeoJSON.FeatureCollection | null) => void
  setCoverageImage: (img: CoverageImageResult | null) => void
  setTerrainImage: (img: TerrainImageResult | null) => void
  setViewport: (vp: { latitude: number; longitude: number; zoom: number }) => void
  triggerCenterOnSite: () => void
}

/* ── UI slice ── */

export type AppMode = "single" | "batch" | "optimize"

export interface UISlice {
  mode: AppMode
  sidebarOpen: boolean
  computing: boolean
  placing: boolean
  colormap: string
  showTerrain: boolean
  progress: { current: number; total: number; label: string } | null
  setMode: (mode: AppMode) => void
  setSidebarOpen: (open: boolean) => void
  setComputing: (v: boolean) => void
  setPlacing: (v: boolean) => void
  setColormap: (v: string) => void
  setShowTerrain: (v: boolean) => void
  setProgress: (p: { current: number; total: number; label: string } | null) => void
}

/* ── Results slice ── */

export type OptimizationPhase =
  | 'idle'
  | 'computing'
  | 'greedy'
  | 'ilp-loading'
  | 'ilp-complete'
  | 'error'

export interface CoverageResults {
  coveredFraction: number
  totalCells: number
  coveredCells: number
  nSites: number
  computeTimeS: number
  threshold: number
  optimizationResult?: OptimizationResult | null
}

export interface ResultsSlice {
  coverageResults: CoverageResults | null
  optimizationResult: OptimizationResult | null
  optimizationPhase: OptimizationPhase
  greedyResult: OptimizationResult | null
  improvement: number | null
  error: string | null
  setCoverageResults: (r: CoverageResults | null) => void
  setOptimizationResult: (r: OptimizationResult | null) => void
  setOptimizationPhase: (p: OptimizationPhase) => void
  setGreedyResult: (r: OptimizationResult | null) => void
  setImprovement: (i: number | null) => void
  setError: (e: string | null) => void
}

/* ── Combined store ── */

export type AppStore = SitesSlice & ParamsSlice & MapSlice & UISlice & ResultsSlice

export const useStore = create<AppStore>((set, get) => ({
  /* Sites */
  sites: [{ name: 'Site 1', latitude: 35.5950145, longitude: -82.5550532 }],
  selectedSiteNames: ['Site 1'],

  addSite: (site) =>
    set((s) => ({
      sites: [...s.sites, site],
      selectedSiteNames: [...s.selectedSiteNames, site.name],
    })),

  removeSite: (name) =>
    set((s) => ({
      sites: s.sites.filter((x) => x.name !== name),
      selectedSiteNames: s.selectedSiteNames.filter((x) => x !== name),
    })),

  updateSitePosition: (name, lat, lon) =>
    set((s) => ({
      sites: s.sites.map((site) =>
        site.name === name ? { ...site, latitude: lat, longitude: lon } : site,
      ),
    })),

  toggleSite: (name) =>
    set((s) => ({
      selectedSiteNames: s.selectedSiteNames.includes(name)
        ? s.selectedSiteNames.filter((x) => x !== name)
        : [...s.selectedSiteNames, name],
    })),

  toggleSiteSelection: (name) => set((s) => ({
    selectedSiteNames: s.selectedSiteNames.includes(name)
      ? s.selectedSiteNames.filter((x) => x !== name)
      : [...s.selectedSiteNames, name],
  })),

  clearSites: () => set({ sites: [], selectedSiteNames: [] }),

  loadSites: (sites) =>
    set({ sites, selectedSiteNames: sites.map((x) => x.name) }),

  /* Params */
  params: DEFAULT_LORA_PARAMS,
  coverageParams: {
    maxRangeKm: 30,
    numRadials: 360,
    threshold: -120,
    targetCoverage: 0.95,
    clutterHeightM: 1.0,
    situationFraction: 95,
    timeFraction: 95,
    debugTerrain: false,
  },
  settings: {
    ...DEFAULT_LORA_PARAMS,
    maxRangeKm: 30,
    numRadials: 360,
    threshold: -120,
    targetCoverage: 0.95,
    clutterHeightM: 1.0,
    situationFraction: 95,
    timeFraction: 95,
    debugTerrain: false,
    showTerrain: false,
    colormap: 'plasma',
  },
  linkBudget: null,

  updateParams: (partial) =>
    set((s) => {
      const params = { ...s.params, ...partial }
      return { params, linkBudget: null, settings: { ...s.settings, ...partial } }
    }),

  updateCoverageParams: (partial) =>
    set((s) => ({
      coverageParams: { ...s.coverageParams, ...partial },
      settings: { ...s.settings, ...partial },
    })),

  setSetting: (key, value) =>
    set((s) => {
      // Update settings map and sync to the appropriate typed field
      const settings = { ...s.settings, [key]: value }
      // Check if it's a LoraParams field
      const loraKeys: (keyof LoraParams)[] = ['frequencyMhz', 'spreadingFactor', 'txPowerDbm', 'txHeightM', 'rxHeightM', 'txAntennaGainDbi', 'rxAntennaGainDbi', 'rxSensitivityDbm', 'bandwidthHz', 'requiredMarginDb', 'cableLossTxDb', 'cableLossRxDb', 'climate', 'polarization', 'groundPermittivity', 'groundConductivity', 'surfaceRefractivity']
      if ((loraKeys as string[]).includes(key)) {
        return { settings, params: { ...s.params, [key]: value }, linkBudget: null }
      }
      // Otherwise treat it as a coverage param
      return { settings, coverageParams: { ...s.coverageParams, [key]: value } }
    }),

  recalcLinkBudget: (pathLossDb = 140) =>
    set((s) => ({
      linkBudget: calculateLinkBudget(s.params, pathLossDb),
    })),

  /* Map */
  bbox: null,
  coverageGeoJson: null,
  coverageImage: null,
  terrainImage: null,
  viewport: { latitude: 35.6, longitude: -82.5, zoom: 10 },
  centerOnSite: 0,

  setBbox: (bbox) => set({ bbox }),
  setCoverageGeoJson: (gj) => set({ coverageGeoJson: gj }),
  setCoverageImage: (img) => set({ coverageImage: img }),
  setTerrainImage: (img) => set({ terrainImage: img }),
  setViewport: (vp) => set({ viewport: vp }),
  triggerCenterOnSite: () => set((s) => ({ centerOnSite: s.centerOnSite + 1 })),

  /* UI */
  mode: "single",
  sidebarOpen: window.innerWidth >= 768,
  computing: false,
  placing: false,
  colormap: 'plasma',
  showTerrain: false,
  progress: null,

  setMode: (mode) => set({ mode }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setComputing: (v) => set({ computing: v }),
  setPlacing: (v) => set({ placing: v }),
  setColormap: (v) => set((s) => ({ colormap: v, settings: { ...s.settings, colormap: v } })),
  setShowTerrain: (v) => set((s) => ({ showTerrain: v, settings: { ...s.settings, showTerrain: v } })),
  setProgress: (p) => set({ progress: p }),

  /* Results */
  coverageResults: null,
  optimizationResult: null,
  optimizationPhase: 'idle',
  greedyResult: null,
  improvement: null,
  error: null,

  setCoverageResults: (r) => set({ coverageResults: r }),
  setOptimizationResult: (r) => set({ optimizationResult: r }),
  setOptimizationPhase: (p) => set({ optimizationPhase: p }),
  setGreedyResult: (r) => set({ greedyResult: r }),
  setImprovement: (i) => set({ improvement: i }),
  setError: (e) => set({ error: e }),
}))

/* ── Expose store on window for E2E test access ── */
declare global {
  interface Window { __STORE__: typeof useStore }
}
if (typeof window !== "undefined") {
  (window as any).__STORE__ = useStore
}
