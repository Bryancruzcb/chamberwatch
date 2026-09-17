import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'

test.beforeEach(async ({ page }) => {
  await serveApi(page)
})

test('lists every public wafer and narrows to the flagged ones', async ({ page }) => {
  await page.goto('/')
  const rows = page.locator('table tbody tr')

  await expect(rows).toHaveCount(96)
  await page.getByRole('button', { name: 'Flagged', exact: true }).click()

  await expect(rows).toHaveCount(15)
  await expect(page).toHaveURL(/flagged=true/)
})

test('filters to one lot', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Lot').selectOption('6')

  await expect(page.locator('table tbody tr')).toHaveCount(10)
  await expect(page).toHaveURL(/lot=6/)
})

test('orders flagged wafers by persistent z and opens one', async ({ page }) => {
  await page.goto('/?flagged=true&order=z')

  await expect(page.locator('table tbody tr').first()).toContainText('Day_2024_08_01_Wafer_06')
  await page.getByRole('link', { name: 'Day_2024_08_01_Wafer_05' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Day_2024_08_01_Wafer_05')
})

test('switches to the simulated lots and opens a wafer with a known fault', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Simulated' }).click()
  const rows = page.locator('table tbody tr')

  await expect(page).toHaveURL(/source=SYNTHETIC/)
  await expect(rows).toHaveCount(40)
  await expect(page.getByLabel('Lot').locator('option')).toHaveCount(12)
  await page.getByLabel('Lot').selectOption({ label: 'Lot 901, 5 flagged' })

  await expect(rows).toHaveCount(10)
  await page.getByRole('link', { name: 'SIM-s7-L901-W07' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SIM-s7-L901-W07')
  await expect(page.locator('.breadcrumb').getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/?source=SYNTHETIC')
  await expect(page.getByRole('link', { name: 'Measured depth' })).toHaveCount(0)
})
