import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'

test('shows why a flagged wafer was flagged', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Day_2024_08_01_Wafer_05')
  await expect(page.locator('.page-head .answer-next')).toHaveText(
    'Platen RF load cap left its range first at 407.2 s. One other channel left its range too. '
    + 'Measured afterwards, the wafer etched 43.69 µm deep, 0.31 µm shallower than wafers 1 to 3 of its lot.',
  )
  const timeline = page.getByRole('region', { name: 'When channels left their range' })
  await expect(timeline.locator('.lane-name')).toHaveText(['Platen RF load cap', 'Platen RF tuning cap'])
  await expect(timeline.locator('[data-kind="excursion"]')).toHaveCount(25)
  // an excursion is a solid mark; a stuck value is hatched, so the two never differ by color alone
  await expect(timeline.locator('[data-kind="excursion"]').first()).toHaveCSS('background-image', 'none')
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
  // the sentence counts what the timeline draws (two lanes) apart from the channels it cannot draw
  await expect(timeline.locator('.lane-name')).toHaveText(['Gas 5 flow', 'Foreline pressure'])
  await expect(page.locator('.page-head .answer-next')).toHaveText(
    'Gas 5 flow left its range first at 189.3 s. One other channel left its range too. 7 more channels were out of range on a phase mean or spread alone.',
  )
})

test('lists the channels of a run caught only on a phase mean or spread, with no meter and no moment', async ({ page }) => {
  await serveApi(page)
  // run 11 as the API would send it had three of its channels deviated: no excursion, no stuck value, no first time
  const run = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'run-11.json'), 'utf8'))
  const off = ['Gas1Flow', 'PlatenRFPeakToPeak', 'Emission623']
  await page.route((url) => url.pathname === '/api/runs/11', (route) => route.fulfill({
    json: {
      ...run,
      good: false,
      assessment: { ...run.assessment, deviationFlags: 3, firstChannel: 'Gas1Flow', firstTimeS: null },
      channels: run.channels.map((channel: { channel: string }) => (off.includes(channel.channel) ? { ...channel, deviation: true } : channel)),
    },
  }))
  await page.goto('/runs/11')
  const panel = page.getByRole('region', { name: 'Phase mean or spread off the good runs' })

  await expect(page.locator('.page-head .badge-critical')).toHaveText('Out of range')
  await expect(page.locator('.page-head .answer-next')).toContainText('Gas 1 flow was out of range on a phase mean or spread. 2 other channels were out of range too.')
  await expect(panel.locator('.lane-name')).toHaveText(['Gas 1 flow', 'Platen RF peak-to-peak', 'Fluorine 624.0 nm'])
  await expect(panel.getByRole('meter')).toHaveCount(0)
  await expect(panel).toContainText('A phase mean or spread off the good runs on 3 channels. No channel stayed past the limit or got stuck, so there is no moment to draw along the etch.')
  await expect(page.getByRole('region', { name: 'Closest to the limit' })).toHaveCount(0)
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
  await expect(timeline.locator('[data-kind="hold"]')).toHaveCSS('background-image', /repeating-linear-gradient/)
  await expect(timeline).toContainText('1 stuck value.')
  await expect(panel).toContainText('Sensor stuck')
  await expect(panel).toContainText('Helium backside pressure repeats its last reading for 6.6 s from 499.0 s.')
  // the hold is timed from the first sample of the value it repeats, which came just before the fault
  await expect(panel).toContainText('Yes. Helium backside pressure was named first, as the fault began.')
  const lineup = page.getByRole('region', { name: 'Every channel against the limit' })
  await expect(lineup.getByRole('listitem').filter({ hasText: 'Helium backside pressure' }).getByText('Stuck', { exact: true })).toBeVisible()
  // a stuck value flags the run without any channel passing the limit
  await expect(lineup.locator('.panel-answer')).toHaveText('No channel went past the limit of 6.0. The closest was Gas 7 flow, at 3.6.')
  await expect(page.getByRole('table', { name: /^Holds:/ }).locator('tbody tr')).toHaveCount(1)
  await expect(page.getByRole('table', { name: /^Holds:/ })).toContainText('34')
})

test('shows no fault panel for a public run', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Day_2024_08_01_Wafer_05')
  await expect(page.getByRole('region', { name: 'Injected fault' })).toHaveCount(0)
})

test('lines every channel up against the limit, and opens one on the trace', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')
  const lineup = page.getByRole('region', { name: 'Every channel against the limit' })

  await expect(lineup.locator('.panel-answer')).toHaveText('2 of 31 channels went past the limit of 6.0. Platen RF load cap went furthest, to 18.8.')
  await expect(lineup.locator('.lineup-dot')).toHaveCount(31)
  await expect(lineup.locator('.lineup-dot.over')).toHaveCount(2)
  await expect(lineup.getByRole('listitem').first()).toContainText('Platen RF load cap')
  await expect(lineup.getByRole('listitem').first()).toContainText('18.8, past the limit')

  await lineup.getByRole('link', { name: 'Platen DC bias' }).click()
  await expect(page).toHaveURL(/channel=PlatenDcBias/)
  await expect(page.getByRole('heading', { level: 2, name: 'Platen DC bias' })).toBeVisible()
  await expect(lineup.getByRole('link', { name: 'Platen DC bias' })).toHaveAttribute('aria-current', 'true')
})

test("ranks the plasma's own light among the channels it scores", async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')
  const rows = page.getByRole('region', { name: 'Every channel against the limit' }).getByRole('listitem')

  // five emission lines are scored beside the sensors, at the detectors' ranks 4 to 7 and 11
  await expect(rows).toHaveCount(31)
  await expect(rows.nth(3)).toContainText('Fluorine 624.0 nm')
  await expect(rows.nth(4)).toContainText('Fluorine 703.7 nm')
  await expect(rows.nth(5)).toContainText('Carbon C2 563.6 nm')
  await expect(rows.nth(6)).toContainText('Fluorine 685.6 nm')
  await expect(rows.nth(6)).toContainText('2.7, under the limit')
  await expect(rows.nth(10)).toContainText('Carbon C2 516.5 nm')
})

test('lines an in-range run up in the detectors\' rank, with the open channel on top', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/11')
  const lineup = page.getByRole('region', { name: 'Every channel against the limit' })

  // the rank is not by how unusual: the closest channel to the limit is not the first row, and the figure says why
  await expect(lineup.locator('.panel-answer')).toHaveText('No channel went past the limit of 6.0. The closest was Platen RF load cap, at 5.5.')
  await expect(lineup.getByRole('listitem').first()).toContainText('Gas 1 flow')
  await expect(lineup.getByRole('listitem').first().getByRole('link')).toHaveAttribute('aria-current', 'true')
  await expect(lineup.locator('.figure-source')).toContainText('In the detectors\' rank')
  await expect(lineup.locator('.figure-source')).toContainText('so the dots need not fall in order')
})

test('tints the open channel\'s row inside the figure, with no shadow reaching past it', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')
  const lineup = page.getByRole('region', { name: 'Every channel against the limit' })
  const selected = lineup.locator('.lineup-row.selected')

  await expect(selected).toHaveCSS('box-shadow', 'none')
  const figure = await lineup.boundingBox()
  const row = await selected.boundingBox()
  const name = await selected.getByRole('link').boundingBox()
  expect(row?.x ?? 0).toBeGreaterThanOrEqual((figure?.x ?? 0) - 0.5)
  expect((row?.x ?? 0) + (row?.width ?? 0)).toBeLessThanOrEqual((figure?.x ?? 0) + (figure?.width ?? 0) + 0.5)
  // the tint has room either side of the text
  expect((name?.x ?? 0) - (row?.x ?? 0)).toBeGreaterThanOrEqual(8)
  // the meter track is the same tint in every figure, now that figures have no card behind them
  const timeline = page.getByRole('region', { name: 'When channels left their range' })
  await expect(timeline.locator('.meter-track').first()).toHaveCSS('background-color', 'rgb(224, 213, 189)')
})

test('starts every figure of the run on the phone\'s gutter and keeps the scale readable', async ({ page }) => {
  await serveApi(page)
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/runs/55')
  const lineup = page.getByRole('region', { name: 'Every channel against the limit' })
  await expect(lineup.locator('.lineup-dot')).toHaveCount(31)

  const figure = await lineup.boundingBox()
  const heading = await lineup.getByRole('heading', { level: 2 }).boundingBox()
  expect(Math.abs((figure?.x ?? 0) - 16)).toBeLessThan(1)
  expect(Math.abs((heading?.x ?? 0) - 16)).toBeLessThan(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
  // at this width the three labels of the scale fit side by side
  const ticks = lineup.locator('.lineup-tick')
  await expect(ticks).toHaveText(['0.0', 'limit 6.0', '12.0'])
  const boxes = await ticks.evaluateAll((labels) => labels.map((label) => {
    const box = label.getBoundingClientRect()
    return { left: box.left, right: box.right }
  }))
  expect(boxes[0]?.right ?? 0).toBeLessThanOrEqual(boxes[1]?.left ?? 0)
  expect(boxes[1]?.right ?? 0).toBeLessThanOrEqual(boxes[2]?.left ?? 0)

  // on the narrowest phones only the limit keeps its label, which is the one every dot is read against
  await page.setViewportSize({ width: 320, height: 800 })
  await expect(lineup.locator('.lineup-tick.limit')).toBeVisible()
  await expect(lineup.locator('.lineup-tick:not(.limit)').first()).toBeHidden()
  await expect(lineup.locator('.lineup-tick:not(.limit)').last()).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
})

test('lists the channels by rank, with no limit to line them up against, when there is no baseline', async ({ page }) => {
  await serveApi(page)
  const run = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'run-55.json'), 'utf8'))
  await page.route((url) => url.pathname === '/api/runs/55', (route) => route.fulfill({ json: { ...run, baseline: null, assessment: null } }))
  await page.goto('/runs/55')
  const channels = page.getByRole('region', { name: 'Channels by rank' })

  await expect(page.getByRole('region', { name: 'Every channel against the limit' })).toHaveCount(0)
  await expect(channels.locator('tbody tr')).toHaveCount(31)
  await expect(channels.locator('tbody tr').first()).toContainText('Platen RF load cap')
  await expect(channels.locator('tbody tr').first().locator('td').nth(2)).toHaveText('18.8')
  await expect(channels.getByRole('meter')).toHaveCount(0)
})
