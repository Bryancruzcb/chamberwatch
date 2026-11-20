import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'

test('shows why a flagged wafer was flagged', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Day_2024_08_01_Wafer_05')
  await expect(page.locator('.page-head .answer-next')).toHaveText(
    'Platen RF load cap left its range first at 407.2 s. One other channel was out of range too. '
    + 'Measured afterwards, the wafer etched 43.69 µm deep, 0.31 µm shallower than wafers 1 to 3 of its lot.',
  )
  const timeline = page.getByRole('region', { name: 'When channels left their range' })
  await expect(timeline.locator('.lane-name')).toHaveText(['Platen RF load cap', 'Platen RF tuning cap'])
  await expect(timeline.locator('[data-kind="excursion"]')).toHaveCount(25)
  await expect(timeline.getByRole('meter').first()).toHaveAttribute('aria-valuetext', '18.8')
  await expect(timeline).toContainText('25 excursions on 2 channels.')
  await expect(page.getByRole('heading', { level: 2, name: 'Platen RF load cap' })).toBeVisible()
  await expect(page.locator('figure.chart svg [data-kind="excursion"]')).toHaveCount(21)
})

test('opens a lane\'s channel on the trace', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')
  await page.getByRole('region', { name: 'When channels left their range' }).getByRole('link', { name: 'Platen RF tuning cap' }).click()

  await expect(page).toHaveURL(/channel=PlatenRFTuningCapacitor/)
  await expect(page.getByRole('heading', { level: 2, name: 'Platen RF tuning cap' })).toBeVisible()
})

test('puts the measured depth of a flagged wafer next to its flags', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')

  await expect(page.locator('.page-head .answer-next')).toContainText('the wafer etched 43.69 µm deep, 0.31 µm shallower than wafers 1 to 3 of its lot')
  await expect(page.locator('.page-head').getByRole('link', { name: 'Measured depth' })).toHaveAttribute('href', '/runs/55/wafer')

  await page.goto('/runs/133')
  const timeline = page.getByRole('region', { name: 'When channels left their range' })
  await expect(timeline).toContainText('172 excursions on 2 channels and a phase mean or spread off the good runs on 9 channels.')
  await expect(timeline.getByRole('meter').first()).toHaveAttribute('aria-valuetext', '>20')
  await expect(page.locator('.page-head .answer-next')).not.toContainText('Measured afterwards')
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
  await expect(page.locator('.page-head .badge-good')).toHaveText('In range')
  await expect(page.locator('.page-head .answer-next'))
    .toContainText('No channel left the good-run range. This run is one of the good runs that range was learned from.')
  const closest = page.getByRole('region', { name: 'Closest to the limit' })
  await expect(closest.locator('.lane-name')).toHaveText('Platen RF load cap')
  await expect(closest.getByRole('meter')).toHaveAttribute('aria-valuetext', '5.5')
  await expect(page.getByRole('region', { name: 'When channels left their range' })).toHaveCount(0)
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
  const timeline = page.getByRole('region', { name: 'When channels left their range' })
  await expect(timeline.locator('.lane-name').first()).toHaveText('Gas 5 flow')
  await expect(timeline.locator('.lane-fault')).toHaveCount(2)
  await expect(timeline).toContainText('fault put in, 187.9 s')
})

test('shows a stuck sensor as a hold next to the fault the simulator injected', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/136')
  const panel = page.getByRole('region', { name: 'Injected fault' })

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SIM-s7-L901-W10')
  await expect(page.locator('.page-head .answer-next')).toHaveText('Helium backside pressure got stuck on one value at 498.8 s.')
  const timeline = page.getByRole('region', { name: 'When channels left their range' })
  await expect(timeline.locator('.lane-name')).toHaveText(['Helium backside pressure'])
  await expect(timeline.locator('[data-kind="hold"]')).toHaveCount(1)
  await expect(timeline).toContainText('1 stuck value.')
  await expect(panel).toContainText('Sensor stuck')
  await expect(panel).toContainText('Helium backside pressure repeats its last reading for 6.6 s from 499.0 s.')
  // the hold is timed from the first sample of the value it repeats, which came just before the fault
  await expect(panel).toContainText('Yes. Helium backside pressure was named first, as the fault began.')
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
