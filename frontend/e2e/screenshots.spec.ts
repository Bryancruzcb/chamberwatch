import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'

// Writes the README screenshots from the built app and the captured API responses. Skipped unless asked for:
//   npm run build && SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
const OUT = join(import.meta.dirname, '..', '..', 'docs', 'images')

test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to write the README screenshots')
test.use({ viewport: { width: 1280, height: 960 }, colorScheme: 'light' })

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true })
})

test('the run page of a flagged public wafer', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')

  await expect(page.locator('figure.chart svg [data-kind="excursion"]').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: join(OUT, 'run-55.png') })
})

test('the lots page with drift and depth by wafer position', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots')

  await expect(page.getByRole('img', { name: /^Depth loss by wafer position/ }).locator('[data-kind="dot"]')).toHaveCount(20)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: join(OUT, 'lots.png'), fullPage: true })
})

test('a simulated run with its injected fault', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/253')

  await expect(page.getByRole('region', { name: 'Injected fault' })).toBeVisible()
  await expect(page.locator('figure.chart svg')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: join(OUT, 'simulated-run.png') })
})
