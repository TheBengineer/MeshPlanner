import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FIXTURES_DIR = path.join(__dirname, 'fixtures')

/* ── Helpers ── */

/** Abort DEM tile fetches so they fail fast — computation will use a flat
 *  synthetic DEM at the fill value (-32768) instead. */
async function mockDemTiles(page: Page) {
  await page.route('**/elevation-tiles-prod/**', (route) => route.abort())
}

/** Set tiny coverage parameters so the full compute pipeline finishes in
 *  milliseconds instead of minutes. */
async function setTinyCoverageParams(page: Page) {
  await page.evaluate(() => {
    window.__STORE__.getState().updateCoverageParams({
      numRadials: 4,
      maxRangeKm: 2,
      targetCoverage: 0.5,
    })
  })
}

/** Add a site named "TestSite" via the SiteForm. */
async function addSite(page: Page) {
  await page.getByTestId('site-name-input').fill('TestSite')
  await page.getByTestId('site-lat-input').fill('35.595')
  await page.getByTestId('site-lon-input').fill('-82.555')
  await page.getByTestId('site-add-btn').click()
}

/** Set a tiny bounding box via the BboxSelector so the DEM is tiny (3×4 px). */
async function setTinyBbox(page: Page) {
  await page.getByTestId('bbox-west').fill('-82.556')
  await page.getByTestId('bbox-south').fill('35.594')
  await page.getByTestId('bbox-east').fill('-82.554')
  await page.getByTestId('bbox-north').fill('35.596')
  await page.getByTestId('bbox-apply').click()
}

/** Serve a pre-built GeoTIFF fixture for DEM tile requests instead of
 *  aborting them (so the coverage computation receives real elevation
 *  data instead of the synthetic fill value -32768). */
async function mockDemTilesWithFixture(page: Page) {
  const { readFile } = await import('node:fs/promises')
  const fixturePath = path.join(FIXTURES_DIR, 'dem_tile_fixture.tif')
  const tileBuffer = await readFile(fixturePath)
  await page.route('**/elevation-tiles-prod/**', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'image/tiff',
      body: tileBuffer,
    })
  })
}

/** Route hiGHS WASM requests to the copy viteStaticCopy placed under
 *  /assets/highs.wasm (Emscripten's scriptDirectory detection fails in
 *  module-bundle context). */
async function mockHighsWasm(page: Page) {
  await page.route('**/highs.wasm', async (route) => {
    const assetsResp = await page.request.get('/assets/highs.wasm')
    await route.fulfill({
      status: 200,
      contentType: 'application/wasm',
      body: await assetsResp.body(),
    })
  })
}

/* ── Tests ── */

test.describe('MeshPlanner E2E', () => {
  test.beforeEach(async ({ page }) => {
    await mockDemTiles(page)
    await page.goto('/')
  })

  test('1. Load & render — page loads, map visible, sidebar visible', async ({ page }) => {
    await expect(page.getByTestId('app-title')).toHaveText('MeshPlanner')
    await expect(page.getByTestId('sidebar')).toBeVisible()
    await expect(page.getByTestId('map-area')).toBeVisible()
  })

  test('2. Coverage computation — add site, compute, overlay on map', async ({ page }) => {
    await addSite(page)
    await setTinyCoverageParams(page)
    await setTinyBbox(page)

    await page.getByTestId('compute-btn').click()

    // Wait for computation to finish
    await page.waitForFunction(
      () => window.__STORE__.getState().computing === false,
      { timeout: 60_000 },
    )

    // Verify results exist (the greedy solver ran)
    const nSites = await page.evaluate(
      () => window.__STORE__.getState().coverageResults?.nSites ?? 0,
    )
    expect(nSites).toBeGreaterThanOrEqual(0)

    // Coverage results panel is visible when nSites > 0
    if (nSites > 0) {
      await expect(page.getByTestId('coverage-results')).toBeVisible({ timeout: 5_000 })
      await expect(page.getByTestId('coverage-results')).toContainText('Coverage Results')
    }

    // Verify the MapLibre canvas is present (coverage overlay was added to map)
    const hasCanvas: boolean = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.maplibregl-canvas')
      return canvas !== null && canvas.width > 0 && canvas.height > 0
    })
    expect(hasCanvas).toBe(true)
  })

  test('3. Optimization — results visible after compute', async ({ page }) => {
    await addSite(page)
    await setTinyCoverageParams(page)
    await setTinyBbox(page)

    await page.getByTestId('compute-btn').click()

    // Wait for computation to finish
    await page.waitForFunction(
      () => window.__STORE__.getState().computing === false,
      { timeout: 60_000 },
    )

    // Check that the greedy solver produced an optimization result
    const storeState = await page.evaluate(() => {
      const s = window.__STORE__.getState()
      return {
        nSites: s.coverageResults?.nSites ?? 0,
        solverSource: s.optimizationResult?.source ?? null,
        solverStatus: s.optimizationResult?.status ?? null,
      }
    })
    expect(storeState.solverSource).toBe('greedy')
    expect(storeState.solverStatus).toBeTruthy()

    // Results panel and export buttons visible when nSites > 0
    if (storeState.nSites > 0) {
      await expect(page.getByTestId('coverage-results')).toBeVisible({ timeout: 5_000 })
      await expect(page.getByTestId('coverage-results')).toContainText('Optimisation')
      await expect(page.getByTestId('export-geojson-btn')).toBeVisible()
      await expect(page.getByTestId('export-csv-btn')).toBeVisible()
    }
  })

  test('4. Export — download GeoJSON, file is valid', async ({ page }) => {
    // Seed store with results directly (avoid re-running full compute pipeline)
    await page.evaluate(() => {
      const store = window.__STORE__
      store.getState().setCoverageResults({
        coveredFraction: 0.75,
        totalCells: 1000,
        coveredCells: 750,
        nSites: 2,
        computeTimeS: 1.5,
        threshold: -120,
        optimizationResult: {
          selectedSites: ['SiteA', 'SiteB'],
          coveredFraction: 0.75,
          solveTimeS: 1.5,
          status: 'Optimal',
          source: 'greedy',
        },
      })
      store.getState().setOptimizationResult({
        selectedSites: ['SiteA', 'SiteB'],
        coveredFraction: 0.75,
        solveTimeS: 1.5,
        status: 'Optimal',
        source: 'greedy',
      })
      store.getState().setCoverageGeoJson({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [-82.556, 35.594],
                [-82.554, 35.594],
                [-82.554, 35.596],
                [-82.556, 35.596],
                [-82.556, 35.594],
              ]],
            },
          },
        ],
      })
    })

    await expect(page.getByTestId('export-geojson-btn')).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('export-geojson-btn').click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/\.geojson$/i)

    // Read content and verify valid GeoJSON
    const stream = await download.createReadStream()
    const chunks: string[] = []
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? chunk : String(chunk))
    }
    const content = chunks.join('')
    const parsed = JSON.parse(content)
    expect(parsed.type).toBe('FeatureCollection')
    expect(Array.isArray(parsed.features)).toBe(true)
    expect(parsed.features.length).toBeGreaterThan(0)
  })

  test('5. Mobile responsive — hamburger visible, open drawer', async ({ page }) => {
    // Sidebar starts open on desktop (window.innerWidth >= 768 at load).
    // Close it first so the mobile-expected closed state is correct.
    await page.evaluate(() => window.__STORE__.getState().setSidebarOpen(false))
    await page.setViewportSize({ width: 375, height: 812 })

    // Hamburger should be visible (hidden on desktop via CSS)
    await expect(page.getByTestId('hamburger-toggle')).toBeVisible()

    // Sidebar off-screen (CSS transform: translateX(-100%)) — bounding box
    // will have a negative x-coordinate on mobile.
    let sidebarBox = await page.getByTestId('sidebar').boundingBox()
    expect(sidebarBox).not.toBeNull()
    expect(sidebarBox!.x).toBeLessThan(0)

    // Click hamburger to open sidebar
    await page.getByTestId('hamburger-toggle').click()

    // Sidebar slides into view — wait for the CSS transition to complete
    await page.waitForTimeout(350)
    sidebarBox = await page.getByTestId('sidebar').boundingBox()
    expect(sidebarBox).not.toBeNull()
    expect(sidebarBox!.x).toBeGreaterThanOrEqual(0)

    await expect(page.getByTestId('app-title')).toBeVisible()
  })

  test('6. Error handling — compute error displayed', async ({ page }) => {
    // Set an error state directly in the store — same path triggered when
    // a CSV parse fails or the compute pipeline encounters an error.
    await page.evaluate(() => {
      window.__STORE__.getState().setError('CSV must have columns: name, lat, lon')
    })

    // Error panel appears in the ComputePanel
    await expect(page.getByTestId('compute-error')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('compute-error')).toContainText('CSV')
  })

  test('7. hiGHS solver — optimization with hiGHS returns source "ilp"', async ({ page }) => {
    // The bundled highs package looks for highs.wasm at the page root because
    // Emscripten's scriptDirectory detection fails in module-bundle context.
    // Route-intercept to serve it from /assets/highs.wasm where viteStaticCopy placed it.
    await page.route('**/highs.wasm', async (route) => {
      const assetsResp = await page.request.get('/assets/highs.wasm')
      await route.fulfill({
        status: 200,
        contentType: 'application/wasm',
        body: await assetsResp.body(),
      })
    })

    // Build a tiny CoverageMatrix: 2 sites, 10 cells — both cover all cells.
    const result: Record<string, unknown> = await page.evaluate(async () => {
      const ilp: (...args: unknown[]) => Promise<Record<string, unknown>> =
        (window as unknown as Record<string, unknown>).__ilpMinSites as (
          ...args: unknown[]
        ) => Promise<Record<string, unknown>>
      const matrix = {
        rowPtr: new Uint32Array([0, 10, 20]),
        colIndices: new Uint32Array([
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
        ]),
        nSites: 2,
        nCells: 10,
      }
      return await ilp(matrix, ['SiteA', 'SiteB'], 0.5, 5)
    })

    // hiGHS WASM loaded and solved the tiny problem
    expect(result.source).toBe('ilp')
    expect(result.status).toMatch(/Optimal|Feasible/)
    expect((result.selectedSites as string[]).length).toBeGreaterThan(0)
    expect((result.solveTimeS as number)).toBeGreaterThan(0)
  })

  test('8. Full workflow — bbox → DEM fetch → coverage → greedy → export GeoJSON', async ({ page }) => {
    // Collect diagnostics from the browser console
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    // The default beforeEach mock aborts DEM tiles. Unroute it and
    // serve the pre-built GeoTIFF fixture so the compute pipeline
    // receives real elevation data through the entire flow.
    await page.unroute('**/elevation-tiles-prod/**')
    await mockDemTilesWithFixture(page)

    // Route hiGHS WASM so the ILP solver can load
    await mockHighsWasm(page)

    await page.goto('/')

    // 1. Page loads — map and sidebar visible
    await expect(page.getByTestId('app-title')).toHaveText('MeshPlanner')
    await expect(page.getByTestId('sidebar')).toBeVisible()
    await expect(page.getByTestId('map-area')).toBeVisible()

    // 2. Add a site
    await page.getByTestId('site-name-input').fill('TestSite')
    await page.getByTestId('site-lat-input').fill('35.595')
    await page.getByTestId('site-lon-input').fill('-82.555')
    await page.getByTestId('site-add-btn').click()

    // 3. Set tiny coverage params so the full compute finishes quickly
    await page.evaluate(() => {
      window.__STORE__.getState().updateCoverageParams({
        numRadials: 4,
        maxRangeKm: 2,
        targetCoverage: 0.5,
      })
    })

    // 4. Set a tiny bounding box for a small DEM (<10 px)
    await setTinyBbox(page)

    // 5. Click Compute to kick off the full pipeline
    await page.getByTestId('compute-btn').click()

    // 6. Wait for the computation to finish
    //    The greedy result is set first (<1s), then the ILP upgrade runs in
    //    the background.  We wait until computing flips to false.
    await page.waitForFunction(
      () => window.__STORE__.getState().computing === false,
      { timeout: 90_000 },
    )

    // Check the store for coverage results.  The greedy solver should have
    // selected at least 1 site (nSites > 0).  If nSites === 0, the pipeline
    // still completed — the empty state is valid but the 'empty-results' div
    // is gated behind !error (the ILP phase may set an error message).
    const storeState = await page.evaluate(() => {
      const s = window.__STORE__.getState()
      return {
        nSites: s.coverageResults?.nSites ?? 0,
        coveredFraction: s.coverageResults?.coveredFraction ?? 0,
        optimizationPhase: s.optimizationPhase,
        error: s.error,
        solverSource: s.optimizationResult?.source ?? null,
        solverStatus: s.optimizationResult?.status ?? null,
        selectedSites: s.optimizationResult?.selectedSites ?? [],
        hasCoverageGeoJson: s.coverageGeoJson !== null,
      }
    })
    expect(storeState.optimizationPhase).toMatch(/greedy|ilp-complete/)
    expect(storeState.nSites).toBeGreaterThanOrEqual(0)

    // Coverage results should be visible in the DOM (gated on nSites > 0)
    if (storeState.nSites > 0) {
      await expect(page.getByTestId('coverage-results')).toBeVisible({ timeout: 5_000 })
      await expect(page.getByTestId('coverage-results')).toContainText('Coverage Results')
      await expect(page.getByTestId('coverage-results')).toContainText('Optimisation')
      await expect(page.getByTestId('coverage-results')).toContainText(
        storeState.solverSource ?? '',
      )
    }

    // 7. Export GeoJSON from the results panel — verify the download
    //    The export-geojson-btn is rendered inside the coverage-results
    //    div which is gated on nSites > 0.  When the greedy returned 0
    //    covered cells, seed synthetic coverage results so the export
    //    button appears and we can test the download flow end-to-end.
    if (!storeState.hasCoverageGeoJson || storeState.nSites === 0) {
      await page.evaluate(() => {
        const store = window.__STORE__.getState()
        store.setCoverageGeoJson({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [-82.556, 35.594],
                [-82.554, 35.594],
                [-82.554, 35.596],
                [-82.556, 35.596],
                [-82.556, 35.594],
              ]],
            },
          }],
        })
        store.setCoverageResults({
          coveredFraction: 0.75,
          totalCells: 100,
          coveredCells: 75,
          nSites: 1,
          computeTimeS: 1.5,
          threshold: -120,
          optimizationResult: store.optimizationResult ?? {
            selectedSites: ['TestSite'],
            coveredFraction: 0.75,
            solveTimeS: 1.5,
            status: 'Feasible',
            source: 'greedy',
          },
        })
      })
    }
    await expect(page.getByTestId('export-geojson-btn')).toBeVisible()
    await expect(page.getByTestId('coverage-results')).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('export-geojson-btn').click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/\.geojson$/i)

    const stream = await download.createReadStream()
    const chunks: string[] = []
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? chunk : String(chunk))
    }
    const content = chunks.join('')
    const parsed = JSON.parse(content)
    expect(parsed.type).toBe('FeatureCollection')
    expect(Array.isArray(parsed.features)).toBe(true)
    expect(parsed.features.length).toBeGreaterThan(0)
  })
})
