import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'
import { stat } from './locators.ts'

test('shows why a flagged wafer was flagged', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Day_2024_08_01_Wafer_05')
  await expect(stat(page, 'Limit flags')).toHaveText('25')
  await expect(stat(page, 'First channel')).toHaveText('PlatenRFLoadCapacitor')
  await expect(page.getByRole('heading', { level: 2, name: 'PlatenRFLoadCapacitor' })).toBeVisible()
  await expect(page.locator('figure.chart svg [data-kind="excursion"]')).toHaveCount(21)
})

test('reads one bucket at a time off the chart from the keyboard', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')
  const chart = page.getByRole('img', { name: /^PlatenRFLoadCapacitor across cycles 1 to 100\./ })
  const readout = page.locator('.readout')

  await chart.focus()
  await expect(readout).toContainText('Cycle')
  const time = await readout.locator('dd').first().textContent()
  await page.keyboard.press('ArrowRight')

  await expect(readout.locator('dd').first()).not.toHaveText(time ?? '')
})

test('zooms to the cycles around the first excursion', async ({ page }) => {
  const api = await serveApi(page)
  await page.goto('/runs/55')
  await page.getByRole('button', { name: 'Cycles 63 to 65' }).click()

  await expect(page).toHaveURL(/from=63&to=65/)
  await expect.poll(() => api.requests.some((path) => path.includes('fromCycle=63') && path.includes('toCycle=65'))).toBe(true)
})

test('relabels a run and says what the refit did', async ({ page }) => {
  const api = await serveApi(page)
  await page.goto('/runs/55')
  await page.getByRole('group', { name: 'Label' }).getByRole('button', { name: 'Good' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Baseline #2 fitted from 31 good runs' })).toBeVisible()
  expect(api.relabels).toEqual([{ label: 'GOOD' }])
})

test('says when a run does not exist', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/9999')

  await expect(page.getByRole('alert')).toHaveText('no run 9999')
})

test('marks a good run the detectors left alone', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/11')

  await expect(page.locator('.page-head')).toContainText('Baseline run')
  await expect(page.locator('.page-head .badge-good')).toHaveText('Clean')
})

test('puts the fault the simulator injected next to what the detectors caught', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/133')
  const panel = page.getByRole('region', { name: 'Injected fault' })

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SIM-s7-L901-W07')
  await expect(page.locator('.page-head .badge-warning')).toHaveText('Degraded')
  await expect(panel).toContainText('Gas flow stuck low')
  await expect(panel).toContainText('Gas5Flow delivers 36% of its flow from 187.9 s to the end of the etch.')
  await expect(panel).toContainText('Yes. Gas5Flow was named first, 1.4 s after the fault began.')
  await expect(stat(page, 'First channel')).toHaveText('Gas5Flow')
})

test('shows no fault panel for a public run', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Day_2024_08_01_Wafer_05')
  await expect(page.getByRole('region', { name: 'Injected fault' })).toHaveCount(0)
})
