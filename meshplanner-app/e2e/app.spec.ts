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

    // Wait for results — the compute pipeline runs with mocked DEM + tiny params
    await expect(page.getByTestId('coverage-results')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('coverage-results')).toContainText('Coverage Results')

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
    await expect(page.getByTestId('coverage-results')).toBeVisible({ timeout: 30_000 })

    // Optimization section rendered
    await expect(page.getByTestId('coverage-results')).toContainText('Optimisation')
    await expect(page.getByTestId('coverage-results')).toContainText('greedy')

    // Export buttons shown
    await expect(page.getByTestId('export-geojson-btn')).toBeVisible()
    await expect(page.getByTestId('export-csv-btn')).toBeVisible()
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

  test('6. Error handling — upload invalid CSV shows error', async ({ page }) => {
    // Click the upload button to make the hidden file input accessible,
    // then set the invalid CSV file.
    await page.getByTestId('upload-btn').click()
    await page.getByTestId('file-input').setInputFiles(
      path.join(FIXTURES_DIR, 'invalid.csv'),
    )

    // Parse error propagates to the ComputePanel's error display.
    // The error is set via zustand store so React re-renders the panel.
    await expect(page.getByTestId('compute-error')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('compute-error')).toContainText('CSV')
  })

  test('7. hiGHS solver — optimization with hiGHS returns source "ilp"', async ({ page }) => {
    // Call the hiGHS ILP solver exposed on window.
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
})
