# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: app.spec.ts >> MeshPlanner E2E >> 6. Error handling — upload invalid CSV shows error
- Location: e2e/app.spec.ts:188:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('compute-error')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByTestId('compute-error')

```

```yaml
- heading "MeshPlanner" [level=2]
- paragraph: LoRa Site Planner
- text: Mode
- combobox "Mode":
  - option "Single Coverage" [selected]
  - option "Optimize"
- text: West
- textbox "West": "-82.6"
- text: South
- textbox "South": "35.5"
- text: East
- textbox "East": "-82.4"
- text: North
- textbox "North": "35.7"
- button "Apply"
- text: Sites
- textbox "Name"
- textbox "Latitude"
- textbox "Longitude"
- button "+ Add"
- button "Upload CSV/GeoJSON"
- text: No sites loaded. Upload a CSV/GeoJSON file or add manually.
- button "Compute Coverage" [disabled]
- text: LoRa Parameters Band
- combobox "Band":
  - option "US915 (915 MHz)" [selected]
  - option "EU868 (868 MHz)"
  - option "AU915 (915 MHz)"
  - option "AS923 (923 MHz)"
  - option "CN470 (470 MHz)"
  - option "IN865 (865 MHz)"
  - option "KR920 (920 MHz)"
- text: Spreading Factor
- combobox "Spreading Factor":
  - option "SF7" [selected]
  - option "SF8"
  - option "SF9"
  - option "SF10"
  - option "SF11"
  - option "SF12"
- text: "TX Power: 20 dBm"
- slider: "20"
- text: "Max Range: 30 km"
- slider: "30"
- text: "Threshold: -120 dBm"
- slider: "-120"
- text: "Link Budget (140 dB loss) EIRP: 22.5 dBm | RX: -118 dBm Margin: 14 dB Optimization Mode"
- combobox "Mode":
  - option "Min Sites" [selected]
  - option "Max Coverage"
- text: "Target: 95%"
- slider: "0.95"
- button "Apply Parameters"
- region "Map"
- group:
  - link "MapLibre":
    - /url: https://maplibre.org/
  - text: "| ©"
  - link "CARTO":
    - /url: https://carto.com/about-carto/
  - text: ", ©"
  - link "OpenStreetMap":
    - /url: http://www.openstreetmap.org/about/
  - text: contributors
```

# Test source

```ts
  98  |     await page.evaluate(() => {
  99  |       const store = window.__STORE__
  100 |       store.getState().setCoverageResults({
  101 |         coveredFraction: 0.75,
  102 |         totalCells: 1000,
  103 |         coveredCells: 750,
  104 |         nSites: 2,
  105 |         computeTimeS: 1.5,
  106 |         threshold: -120,
  107 |         optimizationResult: {
  108 |           selectedSites: ['SiteA', 'SiteB'],
  109 |           coveredFraction: 0.75,
  110 |           solveTimeS: 1.5,
  111 |           status: 'Optimal',
  112 |           source: 'greedy',
  113 |         },
  114 |       })
  115 |       store.getState().setOptimizationResult({
  116 |         selectedSites: ['SiteA', 'SiteB'],
  117 |         coveredFraction: 0.75,
  118 |         solveTimeS: 1.5,
  119 |         status: 'Optimal',
  120 |         source: 'greedy',
  121 |       })
  122 |       store.getState().setCoverageGeoJson({
  123 |         type: 'FeatureCollection',
  124 |         features: [
  125 |           {
  126 |             type: 'Feature',
  127 |             properties: {},
  128 |             geometry: {
  129 |               type: 'Polygon',
  130 |               coordinates: [[
  131 |                 [-82.556, 35.594],
  132 |                 [-82.554, 35.594],
  133 |                 [-82.554, 35.596],
  134 |                 [-82.556, 35.596],
  135 |                 [-82.556, 35.594],
  136 |               ]],
  137 |             },
  138 |           },
  139 |         ],
  140 |       })
  141 |     })
  142 | 
  143 |     await expect(page.getByTestId('export-geojson-btn')).toBeVisible()
  144 | 
  145 |     const downloadPromise = page.waitForEvent('download')
  146 |     await page.getByTestId('export-geojson-btn').click()
  147 |     const download = await downloadPromise
  148 | 
  149 |     expect(download.suggestedFilename()).toMatch(/\.geojson$/i)
  150 | 
  151 |     // Read content and verify valid GeoJSON
  152 |     const stream = await download.createReadStream()
  153 |     const chunks: string[] = []
  154 |     for await (const chunk of stream) {
  155 |       chunks.push(typeof chunk === 'string' ? chunk : String(chunk))
  156 |     }
  157 |     const content = chunks.join('')
  158 |     const parsed = JSON.parse(content)
  159 |     expect(parsed.type).toBe('FeatureCollection')
  160 |     expect(Array.isArray(parsed.features)).toBe(true)
  161 |     expect(parsed.features.length).toBeGreaterThan(0)
  162 |   })
  163 | 
  164 |   test('5. Mobile responsive — hamburger visible, open drawer', async ({ page }) => {
  165 |     await page.setViewportSize({ width: 375, height: 812 })
  166 | 
  167 |     // Hamburger should be visible (hidden on desktop via CSS)
  168 |     await expect(page.getByTestId('hamburger-toggle')).toBeVisible()
  169 | 
  170 |     // Sidebar off-screen (CSS transform: translateX(-100%)) — bounding box
  171 |     // will have a negative x-coordinate on mobile.
  172 |     let sidebarBox = await page.getByTestId('sidebar').boundingBox()
  173 |     expect(sidebarBox).not.toBeNull()
  174 |     expect(sidebarBox!.x).toBeLessThan(0)
  175 | 
  176 |     // Click hamburger to open sidebar
  177 |     await page.getByTestId('hamburger-toggle').click()
  178 | 
  179 |     // Sidebar slides into view — wait for the CSS transition to complete
  180 |     await page.waitForTimeout(350)
  181 |     sidebarBox = await page.getByTestId('sidebar').boundingBox()
  182 |     expect(sidebarBox).not.toBeNull()
  183 |     expect(sidebarBox!.x).toBeGreaterThanOrEqual(0)
  184 | 
  185 |     await expect(page.getByTestId('app-title')).toBeVisible()
  186 |   })
  187 | 
  188 |   test('6. Error handling — upload invalid CSV shows error', async ({ page }) => {
  189 |     // Click the upload button to make the hidden file input accessible,
  190 |     // then set the invalid CSV file.
  191 |     await page.getByTestId('upload-btn').click()
  192 |     await page.getByTestId('file-input').setInputFiles(
  193 |       path.join(FIXTURES_DIR, 'invalid.csv'),
  194 |     )
  195 | 
  196 |     // Parse error propagates to the ComputePanel's error display.
  197 |     // The error is set via zustand store so React re-renders the panel.
> 198 |     await expect(page.getByTestId('compute-error')).toBeVisible({ timeout: 10000 })
      |                                                     ^ Error: expect(locator).toBeVisible() failed
  199 |     await expect(page.getByTestId('compute-error')).toContainText('CSV')
  200 |   })
  201 | 
  202 |   test('7. hiGHS solver — optimization with hiGHS returns source "ilp"', async ({ page }) => {
  203 |     // Call the hiGHS ILP solver exposed on window.
  204 |     // Build a tiny CoverageMatrix: 2 sites, 10 cells — both cover all cells.
  205 |     const result: Record<string, unknown> = await page.evaluate(async () => {
  206 |       const ilp: (...args: unknown[]) => Promise<Record<string, unknown>> =
  207 |         (window as unknown as Record<string, unknown>).__ilpMinSites as (
  208 |           ...args: unknown[]
  209 |         ) => Promise<Record<string, unknown>>
  210 |       const matrix = {
  211 |         rowPtr: new Uint32Array([0, 10, 20]),
  212 |         colIndices: new Uint32Array([
  213 |           0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  214 |           0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  215 |         ]),
  216 |         nSites: 2,
  217 |         nCells: 10,
  218 |       }
  219 |       return await ilp(matrix, ['SiteA', 'SiteB'], 0.5, 5)
  220 |     })
  221 | 
  222 |     // hiGHS WASM loaded and solved the tiny problem
  223 |     expect(result.source).toBe('ilp')
  224 |     expect(result.status).toMatch(/Optimal|Feasible/)
  225 |     expect((result.selectedSites as string[]).length).toBeGreaterThan(0)
  226 |     expect((result.solveTimeS as number)).toBeGreaterThan(0)
  227 |   })
  228 | })
  229 | 
```