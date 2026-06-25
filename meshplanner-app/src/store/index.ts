import { create } from "zustand"
import type { Bbox, CandidateSite, LoraParams, LinkBudget, CoverageRaster, OptimizationResult } from "@/lib/types"
import { DEFAULT_LORA_PARAMS } from "@/lib/constants"
import { calculateLinkBudget } from "@/lib/math/link-budget"

/* ── Sites slice ── */

export interface SitesSlice {
  sites: CandidateSite[]
  selectedSiteNames: string[]
  addSite: (site: CandidateSite) => void
  removeSite: (name: string) => void
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
}

/* ── Params slice ── */

export interface ParamsSlice {
  params: LoraParams
  coverageParams: CoverageParams
  linkBudget: LinkBudget | null
  updateParams: (partial: Partial<LoraParams>) => void
  updateCoverageParams: (partial: Partial<CoverageParams>) => void
  recalcLinkBudget: (pathLossDb?: number) => void
}

/* ── Map / Bbox slice ── */

export interface MapSlice {
  bbox: Bbox | null
  coverageGeoJson: GeoJSON.FeatureCollection | null
  setBbox: (bbox: Bbox | null) => void
  setCoverageGeoJson: (gj: GeoJSON.FeatureCollection | null) => void
}

/* ── UI slice ── */

export type AppMode = "single" | "batch" | "optimize"

export interface UISlice {
  mode: AppMode
  sidebarOpen: boolean
  computing: boolean
  progress: { current: number; total: number; label: string } | null
  setMode: (mode: AppMode) => void
  setSidebarOpen: (open: boolean) => void
  setComputing: (v: boolean) => void
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
  sites: [],
  selectedSiteNames: [],

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
  },
  linkBudget: null,

  updateParams: (partial) =>
    set((s) => {
      const params = { ...s.params, ...partial }
      return { params, linkBudget: null }
    }),

  updateCoverageParams: (partial) =>
    set((s) => ({
      coverageParams: { ...s.coverageParams, ...partial },
    })),

  recalcLinkBudget: (pathLossDb = 140) =>
    set((s) => ({
      linkBudget: calculateLinkBudget(s.params, pathLossDb),
    })),

  /* Map */
  bbox: null,
  coverageGeoJson: null,

  setBbox: (bbox) => set({ bbox }),
  setCoverageGeoJson: (gj) => set({ coverageGeoJson: gj }),

  /* UI */
  mode: "single",
  sidebarOpen: window.innerWidth >= 768,
  computing: false,
  progress: null,

  setMode: (mode) => set({ mode }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setComputing: (v) => set({ computing: v }),
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
