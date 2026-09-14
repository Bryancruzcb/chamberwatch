import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'

test('lists the lots next to drift and depth by wafer position', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lots')
  await expect(page.locator('table.lots tbody tr')).toHaveCount(10)
  await expect(page.getByRole('img', { name: /^Mean drift score by wafer position/ }).locator('[data-kind="dot"]')).toHaveCount(10)
  await expect(page.getByRole('img', { name: /^Depth loss by wafer position/ }).locator('[data-kind="dot"]')).toHaveCount(20)
})

test('opens a lot on the channel that left the band', async ({ page }) => {
  const api = await serveApi(page)
  await page.goto('/lots')
  await page.getByRole('link', { name: 'Lot 6', exact: true }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lot 6')
  await expect(page.getByRole('heading', { level: 2, name: 'PlatenRFTuningCapacitor' })).toBeVisible()
  await expect(page.locator('.panel-head .badge-critical')).toHaveText('Out of band')
  const chart = page.getByRole('img', { name: /^SF6 phase mean of PlatenRFTuningCapacitor by wafer position/ })
  await expect(chart.locator('[data-kind="dot"]')).toHaveCount(10)

  await page.getByRole('group', { name: 'Phase' }).getByRole('button', { name: 'C4F8' }).click()

  await expect(page).toHaveURL(/phase=C4F8/)
  await expect.poll(() => api.requests.some((path) => path.startsWith('/api/lots/6/drift') && path.includes('phase=C4F8'))).toBe(true)
})
