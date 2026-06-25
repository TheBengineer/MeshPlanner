# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: app.spec.ts >> MeshPlanner E2E >> 7. hiGHS solver — optimization with hiGHS returns source "ilp"
- Location: e2e/app.spec.ts:202:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "ilp"
Received: "greedy_fallback"
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - heading "MeshPlanner" [level=2] [ref=e6]
      - paragraph [ref=e7]: LoRa Site Planner
    - generic [ref=e9]:
      - text: Mode
      - combobox "Mode" [ref=e10]:
        - option "Single Coverage" [selected]
        - option "Optimize"
    - generic [ref=e11]:
      - generic [ref=e12]:
        - text: West
        - textbox "West" [ref=e13]: "-82.6"
      - generic [ref=e14]:
        - text: South
        - textbox "South" [ref=e15]: "35.5"
      - generic [ref=e16]:
        - text: East
        - textbox "East" [ref=e17]: "-82.4"
      - generic [ref=e18]:
        - text: North
        - textbox "North" [ref=e19]: "35.7"
      - button "Apply" [ref=e20] [cursor=pointer]
    - generic [ref=e21]:
      - generic [ref=e22]: Sites
      - generic [ref=e23]:
        - textbox "Name" [ref=e24]
        - textbox "Latitude" [ref=e25]
        - textbox "Longitude" [ref=e26]
        - button "+ Add" [ref=e27] [cursor=pointer]
      - button "Upload CSV/GeoJSON" [ref=e29] [cursor=pointer]
      - generic [ref=e30]: No sites loaded. Upload a CSV/GeoJSON file or add manually.
    - button "Compute Coverage" [disabled] [ref=e32] [cursor=pointer]
    - generic [ref=e33]:
      - generic [ref=e34]: LoRa Parameters
      - generic [ref=e35]:
        - text: Band
        - combobox "Band" [ref=e36]:
          - option "US915 (915 MHz)" [selected]
          - option "EU868 (868 MHz)"
          - option "AU915 (915 MHz)"
          - option "AS923 (923 MHz)"
          - option "CN470 (470 MHz)"
          - option "IN865 (865 MHz)"
          - option "KR920 (920 MHz)"
      - generic [ref=e37]:
        - text: Spreading Factor
        - combobox "Spreading Factor" [ref=e38]:
          - option "SF7" [selected]
          - option "SF8"
          - option "SF9"
          - option "SF10"
          - option "SF11"
          - option "SF12"
      - generic [ref=e39]:
        - text: "TX Power: 20 dBm"
        - slider [ref=e40]: "20"
      - generic [ref=e41]:
        - text: "Max Range: 30 km"
        - slider [ref=e42]: "30"
      - generic [ref=e43]:
        - text: "Threshold: -120 dBm"
        - slider [ref=e44]: "-120"
      - generic [ref=e45]:
        - generic [ref=e46]: Link Budget (140 dB loss)
        - generic [ref=e47]: "EIRP: 22.5 dBm | RX: -118 dBm"
        - generic [ref=e48]:
          - text: "Margin:"
          - generic [ref=e49]: 14 dB
      - generic [ref=e50]:
        - generic [ref=e51]: Optimization
        - generic [ref=e52]:
          - text: Mode
          - combobox "Mode" [ref=e53]:
            - option "Min Sites" [selected]
            - option "Max Coverage"
        - generic [ref=e54]:
          - text: "Target: 95%"
          - slider [ref=e55]: "0.95"
      - button "Apply Parameters" [ref=e56] [cursor=pointer]
  - generic [ref=e58]:
    - region "Map" [ref=e59]
    - group [ref=e60]:
      - generic "Toggle attribution" [ref=e61] [cursor=pointer]
      - generic [ref=e62]:
        - link "MapLibre" [ref=e63] [cursor=pointer]:
          - /url: https://maplibre.org/
        - text: "| ©"
        - link "CARTO" [ref=e64] [cursor=pointer]:
          - /url: https://carto.com/about-carto/
        - text: ", ©"
        - link "OpenStreetMap" [ref=e65] [cursor=pointer]:
          - /url: http://www.openstreetmap.org/about/
        - text: contributors
```

# Test source

```ts
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
  198 |     await expect(page.getByTestId('compute-error')).toBeVisible({ timeout: 10000 })
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
> 223 |     expect(result.source).toBe('ilp')
      |                           ^ Error: expect(received).toBe(expected) // Object.is equality
  224 |     expect(result.status).toMatch(/Optimal|Feasible/)
  225 |     expect((result.selectedSites as string[]).length).toBeGreaterThan(0)
  226 |     expect((result.solveTimeS as number)).toBeGreaterThan(0)
  227 |   })
  228 | })
  229 | 
```