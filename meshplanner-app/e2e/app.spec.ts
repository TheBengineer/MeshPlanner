import { test, expect } from '@playwright/test'

test('app loads and shows title', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toHaveText('MeshPlanner')
})

test('site can be added via map click', async ({ page }) => {
  await page.goto('/')
  await page.locator('.map-area canvas').click()
  await expect(page.locator('.sidebar')).toContainText('Site 1')
})

test('bbox selector shows input fields', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.sidebar-section').first()).toBeVisible()
})
