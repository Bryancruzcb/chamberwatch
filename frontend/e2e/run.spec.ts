import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'
import { stat } from './locators.ts'

test('shows why a flagged wafer was flagged', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Day_2024_08_01_Wafer_05')
  await expect(stat(page, 'Limit flags')).toHaveText('25')
  await expect(stat(page, 'First channel')).toHaveText('Platen RF load cap')
  await expect(page.getByRole('heading', { level: 2, name: 'Platen RF load cap' })).toBeVisible()
  await expect(page.locator('figure.chart svg [data-kind="excursion"]')).toHaveCount(21)
})

test('puts the measured depth of a flagged wafer next to its flags', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')

  await expect(stat(page, 'Measured depth')).toHaveText('43.69 µm')
  await expect(page.locator('.stat').filter({ hasText: 'Measured depth' }))
    .toContainText('0.31 µm shallower than wafers 1 to 3 of its lot, 89-point set')

  await page.goto('/runs/133')
  await expect(stat(page, 'Limit flags')).toHaveText('172')
  await expect(stat(page, 'Measured depth')).toHaveCount(0)
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
  // the PUT answered with the refit still running, so the page asked until it was done
  expect(api.requests.filter((path) => path === '/api/refreshes/7')).toHaveLength(2)
})

test('says the label is saved when the refit fails, and shows the run again', async ({ page }) => {
  const api = await serveApi(page)
  await page.goto('/runs/55')
  await page.getByRole('group', { name: 'Label' }).getByRole('button', { name: 'Bad' }).click()

  await expect(page.getByRole('alert')).toHaveText(
    'The label is saved, but the refit failed: java.lang.OutOfMemoryError: Java heap space. The next relabel refits again.',
  )
  await expect.poll(() => api.requests.filter((path) => path === '/api/runs/55')).toHaveLength(2)
})

test('shows the label without the buttons on a read-only server', async ({ page }) => {
  await serveApi(page, { readOnly: true })
  await page.goto('/runs/55')

  await expect(page.getByRole('region', { name: 'Label' })).toContainText('Labels cannot be changed on this ChamberWatch')
  await expect(page.getByRole('group', { name: 'Label' })).toHaveCount(0)
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
  await expect(panel).toContainText('Gas 5 flow delivers 36% of its flow from 187.9 s to the end of the etch, and the foreline pressure falls with the missing flow.')
  await expect(panel).toContainText('Yes. Gas 5 flow was named first, 1.4 s after the fault began.')
  await expect(stat(page, 'First channel')).toHaveText('Gas 5 flow')
})

test('shows a stuck sensor as a hold next to the fault the simulator injected', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/136')
  const panel = page.getByRole('region', { name: 'Injected fault' })

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SIM-s7-L901-W10')
  await expect(stat(page, 'Stuck holds')).toHaveText('1')
  await expect(stat(page, 'First channel')).toHaveText('Helium backside pressure')
  await expect(panel).toContainText('Sensor stuck')
  await expect(panel).toContainText('Helium backside pressure repeats its last reading for 6.6 s from 499.0 s.')
  await expect(panel).toContainText('Yes. Helium backside pressure was named first, 0.0 s after the fault began.')
  await expect(page.locator('table.compact').getByText('Stuck', { exact: true })).toBeVisible()
  await expect(page.getByRole('table', { name: /^Holds:/ }).locator('tbody tr')).toHaveCount(1)
  await expect(page.getByRole('table', { name: /^Holds:/ })).toContainText('34')
})

test('shows no fault panel for a public run', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Day_2024_08_01_Wafer_05')
  await expect(page.getByRole('region', { name: 'Injected fault' })).toHaveCount(0)
})

test("ranks the plasma's own light among the channels it scores", async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')

  const channels = page.getByRole('region', { name: 'Channels by rank' })
  await expect(channels.getByRole('row', { name: /Fluorine 685.6 nm/ })).toBeVisible()
  await expect(channels.getByRole('row', { name: /Carbon C2 516.5 nm/ })).toBeVisible()
})
