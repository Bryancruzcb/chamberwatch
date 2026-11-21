import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { serveApi } from './api.ts'

function fixture(name: string) {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'))
}

/** Serves run 55 as the API would send it with some fields changed. */
async function serveRun55(page: Page, change: (run: Record<string, unknown>) => Record<string, unknown>) {
  const run = fixture('run-55.json')
  await page.route((url) => url.pathname === '/api/runs/55', (route) => route.fulfill({ json: change(run) }))
}

/** Holds every answer to `path` until the returned function is called. */
async function holdBack(page: Page, path: string): Promise<() => void> {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route((url) => url.pathname === path, async (route) => {
    await held
    await route.fallback()
  })
  return release
}

test('says in a sentence how a flagged wafer did, with its key on the meta line and its verdict beside it', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 5 of Lot 6 is out of range.')
  await expect(page).toHaveTitle('Lot 6, wafer 5 · ChamberWatch')
  await expect(page.locator('.run-lead')).toHaveText(
    'Platen RF load cap left its range first at 407.2 s. One other channel left its range too. '
    + 'Measured afterwards, the wafer etched 43.69 µm deep, 0.31 µm shallower than wafers 1 to 3 of its lot.',
  )
  await expect(page.locator('.run-lead strong')).toHaveText('Platen RF load cap')
  // the file name moved from the heading to the meta line
  await expect(page.locator('.run-meta .run-key')).toHaveText('Day_2024_08_01_Wafer_05')
  await expect(page.locator('.run-meta')).toContainText('Aug 1, 2024')
  const verdict = page.getByRole('region', { name: 'How unusual' })
  await expect(verdict.locator('.verdict-num')).toHaveText('18.8')
  await expect(verdict.locator('.verdict-state')).toHaveText('Out of range: past the limit of 6.0')
  await expect(verdict.getByRole('img')).toHaveAttribute('aria-label', '18.8 on a scale from 0 to 25, with the limit at 6.0')
  // a figure beside the sentence, not a tile: no fill, no box, only the rule on its left
  await expect(verdict).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(verdict).toHaveCSS('border-top-width', '0px')
  await expect(verdict).toHaveCSS('border-left-width', '2px')
})

test('draws the lot above the heading, this wafer larger with its score, each disc a link to its run', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')
  const strip = page.getByRole('group', { name: 'Lot 6, wafer by wafer' })

  await expect(strip.getByRole('link')).toHaveCount(10)
  const here = strip.getByRole('link', { name: 'Lot 6, wafer 5: out of range, how unusual 18.8' })
  await expect(here).toHaveAttribute('aria-current', 'page')
  await expect(here).toHaveText('18.8')
  await expect(strip.locator('.strip-here-label')).toHaveText('This wafer')
  await expect(strip.locator('.strip-bracket')).toHaveText('Baseline')
  await expect(strip.locator('.strip-baseline').getByRole('link')).toHaveCount(3)
  await expect(strip.locator('.disc.baseline')).toHaveCount(0)
  await strip.getByRole('link', { name: /^Lot 6, wafer 6:/ }).click()

  await expect(page).toHaveURL(/\/runs\/56$/)
})

test('marks each baseline wafer of the strip when the baseline is not the lot\'s first wafers', async ({ page }) => {
  await serveApi(page)
  const runs = fixture('runs.json')
  const lot6 = runs.runs
    .filter((run: { lotId: number }) => run.lotId === 6)
    .map((run: { id: number }) => (run.id === 58 ? { ...run, good: true } : run))
  await page.route((url) => url.pathname === '/api/runs', (route) => route.fulfill({ json: { ...runs, runs: lot6 } }))
  await page.goto('/runs/55')
  const strip = page.getByRole('group', { name: 'Lot 6, wafer by wafer' })

  await expect(strip.getByRole('link')).toHaveCount(10)
  await expect(strip.locator('.strip-bracket')).toHaveCount(0)
  await expect(strip.locator('.disc.baseline')).toHaveCount(4)
  await expect(strip.getByRole('link', { name: 'Lot 6, wafer 8: out of range, how unusual 12.7, baseline run' })).toHaveClass(/baseline/)
})

test('holds the strip\'s height while the lot loads, and keeps it when the lot arrives', async ({ page }) => {
  await serveApi(page)
  const release = await holdBack(page, '/api/runs')
  await page.goto('/runs/55')
  const heading = page.getByRole('heading', { level: 1 })
  await expect(page.locator('.lot-strip.placeholder')).toBeVisible()
  const before = await heading.boundingBox()
  release()

  await expect(page.getByRole('group', { name: 'Lot 6, wafer by wafer' })).toBeVisible()
  const after = await heading.boundingBox()
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2)
})

test('leaves the strip out when the lot fails to load', async ({ page }) => {
  await serveApi(page)
  await page.route((url) => url.pathname === '/api/runs', (route) => route.fulfill({
    status: 500, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Server error', status: 500 }),
  }))
  await page.goto('/runs/55')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 5 of Lot 6 is out of range.')
  await expect(page.locator('figure.chart svg')).toBeVisible()
  await expect(page.locator('.lot-strip')).toHaveCount(0)
})

test('shows why a flagged wafer was flagged, along the etch', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')
  const timeline = page.getByRole('region', { name: 'When channels left their range' })

  await expect(timeline.locator('.lane-name')).toHaveText(['Platen RF load cap', 'Platen RF tuning cap'])
  await expect(timeline.locator('[data-kind="excursion"]')).toHaveCount(25)
  // an excursion is a solid mark; a stuck value is hatched, so the two never differ by color alone
  await expect(timeline.locator('[data-kind="excursion"]').first()).toHaveCSS('background-image', 'none')
  await expect(timeline.locator('.lane-score').first()).toHaveText('18.8, past the limit')
  await expect(timeline.locator('.lane-score.over .state-dot')).toHaveCount(2)
  await expect(timeline.locator('.lane-first')).toHaveText('First excursion, 407.2 s')
  await expect(timeline.locator('.figure-answer')).toHaveText('25 excursions on 2 channels.')
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

  await expect(page.locator('.run-lead')).toContainText('the wafer etched 43.69 µm deep, 0.31 µm shallower than wafers 1 to 3 of its lot')
  await expect(page.locator('.run-meta').getByRole('link', { name: 'Measured depth' })).toHaveAttribute('href', '/runs/55/wafer')

  await page.goto('/runs/133')
  const timeline = page.getByRole('region', { name: 'When channels left their range' })
  await expect(timeline).toContainText('172 excursions on 2 channels and a phase mean or spread off the good runs on 9 channels.')
  await expect(timeline.locator('.lane-score').first()).toHaveText('98K, past the limit')
  // the sentence counts what the timeline draws (two lanes) apart from the channels it cannot draw
  await expect(timeline.locator('.lane-name')).toHaveText(['Gas 5 flow', 'Foreline pressure'])
  await expect(page.locator('.run-lead')).toHaveText(
    'Gas 5 flow left its range first at 189.3 s. One other channel left its range too. 7 more channels were out of range on a phase mean or spread alone.',
  )
})

test('lists the channels of a run caught only on a phase mean or spread, with no score and no moment', async ({ page }) => {
  await serveApi(page)
  // run 11 as the API would send it had three of its channels deviated: no excursion, no stuck value, no first time
  const run = fixture('run-11.json')
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

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 1 of Lot 2 is out of range.')
  await expect(page.locator('.verdict-state')).toHaveText('Out of range on a phase mean or spread, under the limit of 6.0')
  await expect(page.locator('.run-lead')).toContainText('Gas 1 flow was out of range on a phase mean or spread. 2 other channels were out of range too.')
  await expect(panel.locator('.lane-name')).toHaveText(['Gas 1 flow', 'Platen RF peak-to-peak', 'Fluorine 624.0 nm'])
  await expect(panel.locator('.lane-score')).toHaveCount(0)
  await expect(panel).toContainText('A phase mean or spread off the good runs on 3 channels.')
  await expect(panel).toContainText('No channel stayed past the limit or got stuck, so there is no moment to draw along the etch.')
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

test('fits the trace past the start-up ramp and says what it clips; the whole record shows everything', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')
  const trace = page.getByRole('region', { name: 'Platen RF load cap' })
  const ticks = trace.locator('figure.chart svg text.tick')
  const clipped = trace.locator('svg .chart-note').filter({ hasText: /^Below/ })

  await expect(trace.locator('.figure-answer')).toHaveText('The reading left the good-run range 21 times, first at 407.2 s.')
  await expect(clipped).toHaveText('Below 70 until 41.4 s; starts at 6.9')
  await expect(ticks.first()).toHaveText('70')
  await expect(trace.locator('svg .rail .chart-note')).toHaveText('21 excursions')
  await expect(trace.locator('svg .chart-ann')).toHaveText('First, 407.2 s')
  // the reading is redrawn in red inside each excursion
  await expect(trace.locator('svg path.reading.out')).toHaveCount(21)

  await trace.getByRole('button', { name: 'Whole record' }).click()
  await expect(page).toHaveURL(/view=record/)
  await expect(trace.getByRole('img', { name: /across the whole record/ })).toBeVisible()
  await expect(clipped).toHaveCount(0)
  await expect(ticks.first()).toHaveText('0')
})

test('zooms to the cycles around the first excursion', async ({ page }) => {
  const api = await serveApi(page)
  await page.goto('/runs/55')
  await page.getByRole('button', { name: 'Cycles 63 to 65' }).click()

  await expect(page).toHaveURL(/from=63&to=65/)
  await expect(page.getByRole('button', { name: 'Cycles 63 to 65' })).toHaveAttribute('aria-pressed', 'true')
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
  const panel = page.getByRole('region', { name: 'Label' })

  await expect(panel).toContainText('Labels cannot be changed on this ChamberWatch')
  await expect(page.getByRole('group', { name: 'Label' })).toHaveCount(0)
  // a small panel: the rule and the title, no figure number
  await expect(panel.locator('.fig-no')).toHaveCount(0)
})

test('says when a run does not exist, with a way to ask again', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/9999')

  await expect(page.getByRole('alert')).toHaveText('no run 9999')
  await expect(page.locator('.state-title')).toHaveText('This run did not load')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('marks a good run the detectors left alone', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/11')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 1 of Lot 2 is in range.')
  await expect(page.locator('.run-meta')).toContainText('Baseline run')
  await expect(page.locator('.verdict-state')).toHaveText('In range: under the limit of 6.0')
  await expect(page.locator('.verdict-num')).toHaveText('5.5')
  await expect(page.locator('.run-lead'))
    .toContainText('No channel left the good-run range. This run is one of the good runs that range was learned from.')
  const closest = page.getByRole('region', { name: 'Closest to the limit' })
  await expect(closest.locator('.lane-name')).toHaveText('Platen RF load cap')
  await expect(closest.locator('.lane-score')).toHaveText('5.5, under the limit')
  await expect(closest.locator('.figure-answer')).toHaveText('Platen RF load cap came closest to the limit of 6.0, at 5.5.')
  await expect(page.getByRole('region', { name: 'When channels left their range' })).toHaveCount(0)
  // this wafer is a baseline wafer, so its label sits under it, clear of the bracket
  const strip = page.getByRole('group', { name: 'Lot 2, wafer by wafer' })
  await expect(strip).toHaveClass(/label-below/)
  await expect(strip.locator('.strip-baseline [aria-current="page"]')).toHaveText('5.5')
})

test('says when a run was not scored, with no verdict and no timeline', async ({ page }) => {
  await serveApi(page)
  await serveRun55(page, (run) => ({ ...run, assessment: null }))
  await page.goto('/runs/55')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 5 of Lot 6 was not scored.')
  await expect(page.locator('.run-lead')).toHaveText('It has no score under the current baseline.')
  await expect(page.getByRole('region', { name: 'How unusual' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'When channels left their range' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Lot 6, wafer 5: not scored' })).toHaveAttribute('aria-current', 'page')
})

test('says when a run could not be aligned, and why', async ({ page }) => {
  await serveApi(page)
  await serveRun55(page, (run) => ({
    ...run,
    assessment: null,
    alignment: {
      status: 'FAILED', note: 'no SF6 onset found', etchStartS: null, etchEndS: null, cycle1Sf6: null, c4f8Phases: null, lastCycle: null,
      onsetsDetected: null, onsetsPredicted: null, gapStartS: null, gapLengthS: null, gapInsideEtch: null, irregularCycles: [],
    },
  }))
  await page.goto('/runs/55')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 5 of Lot 6 could not be aligned.')
  await expect(page.locator('.run-lead')).toHaveText('The aligner could not place it on the recipe grid: no SF6 onset found.')
  await expect(page.getByRole('region', { name: 'Alignment' })).toContainText('no SF6 onset found')
  await expect(page.getByRole('link', { name: 'Lot 6, wafer 5: not aligned' })).toHaveClass(/failed/)
})

test('puts the fault the simulator injected next to what the detectors caught', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/133')
  const panel = page.getByRole('region', { name: 'Injected fault' })
  const lineup = page.getByRole('region', { name: 'Every channel against the limit' })

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 7 of Lot 901 is out of range.')
  await expect(page.locator('.run-meta .run-key')).toHaveText('SIM-s7-L901-W07')
  await expect(page.locator('.run-meta .word.warn')).toHaveText('Alignment degraded')
  await expect(panel.locator('.figure-answer')).toHaveText('Yes. Gas 5 flow was named first, 1.4 s after the fault began.')
  await expect(panel).toContainText('Gas flow stuck low')
  await expect(panel).toContainText('Gas 5 flow delivers 36% of its flow from 187.9 s to the end of the etch, and the foreline pressure falls with the missing flow.')
  const timeline = page.getByRole('region', { name: 'When channels left their range' })
  await expect(timeline.locator('.lane-name').first()).toHaveText('Gas 5 flow')
  await expect(timeline.locator('.lane-fault')).toHaveCount(2)
  await expect(timeline).toContainText('fault put in, 187.9 s')
  // the step change runs past the end of every scale, so it stops on an arrow and the verdict prints it in full
  await expect(page.locator('.verdict-num')).toHaveText('97,795')
  await expect(page.getByRole('region', { name: 'How unusual' }).getByRole('img')).toHaveAttribute('aria-label', /from 0 to 60.*runs past the end/)
  await expect(lineup.locator('.lineup-row.past')).toHaveCount(2)
  // a limit near 0 takes the 0's place on the scale, so their labels never overlap
  await expect(lineup.locator('.lineup-tick')).toHaveText(['limit 6.0', '60+'])
})

test('shows a stuck sensor as a hold next to the fault the simulator injected', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/136')
  const panel = page.getByRole('region', { name: 'Injected fault' })

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 10 of Lot 901 is out of range.')
  await expect(page.locator('.verdict-state')).toHaveText('Out of range: a stuck sensor, under the limit of 6.0')
  await expect(page.locator('.run-meta .word.warn')).toHaveText('Stuck sensor')
  await expect(page.locator('.run-lead')).toHaveText('Helium backside pressure got stuck on one value at 498.8 s.')
  const timeline = page.getByRole('region', { name: 'When channels left their range' })
  await expect(timeline.locator('.lane-name')).toHaveText(['Helium backside pressure'])
  await expect(timeline.locator('[data-kind="hold"]')).toHaveCount(1)
  await expect(timeline.locator('[data-kind="hold"]')).toHaveCSS('background-image', /repeating-linear-gradient/)
  await expect(timeline.locator('.lane-first')).toHaveText('Stuck from 498.8 s')
  await expect(timeline).toContainText('1 stuck value.')
  await expect(panel).toContainText('Sensor stuck')
  await expect(panel).toContainText('Helium backside pressure repeats its last reading for 6.6 s from 499.0 s.')
  // the hold is timed from the first sample of the value it repeats, which came just before the fault
  await expect(panel).toContainText('Yes. Helium backside pressure was named first, as the fault began.')
  const lineup = page.getByRole('region', { name: 'Every channel against the limit' })
  await expect(lineup.getByRole('listitem').filter({ hasText: 'Helium backside pressure' }).getByText('Stuck', { exact: true })).toBeVisible()
  // a stuck value flags the run without any channel passing the limit
  await expect(lineup.locator('.figure-answer')).toHaveText('No channel went past the limit of 6.0. The closest was Gas 7 flow, at 3.6.')
  await expect(page.getByRole('table', { name: /^Holds:/ }).locator('tbody tr')).toHaveCount(1)
  await expect(page.getByRole('table', { name: /^Holds:/ })).toContainText('34')
  // the trace ticks the hold on its rail, since its reading barely moves
  await expect(page.locator('figure.chart svg [data-kind="hold"]')).toHaveCount(1)
  await expect(page.locator('figure.chart svg .chart-ann')).toHaveText('Stuck from 498.8 s')
})

test('shows no fault figure for a public run, and numbers the figures without a gap', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 5 of Lot 6 is out of range.')
  await expect(page.getByRole('region', { name: 'Injected fault' })).toHaveCount(0)
  const titles = await page.locator('.figure.numbered h2').allTextContents()
  expect(titles).toEqual(['When channels left their range', 'Every channel against the limit', 'Platen RF load cap'])
})

test('lines the first ten channels up against the limit, shows the rest in place, and opens one on the trace', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')
  const lineup = page.getByRole('region', { name: 'Every channel against the limit' })
  const more = lineup.getByRole('button', { name: '21 more channels, all under 3.0' })

  await expect(lineup.locator('.figure-answer')).toHaveText('2 of 31 channels went past the limit of 6.0. Platen RF load cap went furthest, to 18.8.')
  await expect(lineup.getByRole('listitem')).toHaveCount(10)
  await expect(lineup.locator('.lineup-row.over')).toHaveCount(2)
  await expect(lineup.getByRole('listitem').first()).toContainText('Platen RF load cap')
  await expect(lineup.getByRole('listitem').first()).toContainText('18.8, past the limit')
  await expect(lineup.locator('.lineup-tick')).toHaveText(['0', 'limit 6.0', '20'])
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await more.click()
  await expect(lineup.getByRole('listitem')).toHaveCount(31)
  await expect(lineup.getByRole('button', { name: 'Show the first 10 only' })).toHaveAttribute('aria-expanded', 'true')

  await lineup.getByRole('link', { name: 'Platen DC bias' }).click()
  await expect(page).toHaveURL(/channel=PlatenDcBias/)
  await expect(page.getByRole('heading', { level: 2, name: 'Platen DC bias' })).toBeVisible()
  await expect(lineup.getByRole('link', { name: 'Platen DC bias' })).toHaveAttribute('aria-current', 'true')
})

test('starts the lineup open when the channel in the address is one it folds away', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55?channel=Emission516')
  const lineup = page.getByRole('region', { name: 'Every channel against the limit' })

  await expect(lineup.getByRole('listitem')).toHaveCount(31)
  await expect(lineup.getByRole('link', { name: 'Carbon C2 516.5 nm' })).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('heading', { level: 2, name: 'Carbon C2 516.5 nm' })).toBeVisible()
})

test("ranks the plasma's own light among the channels it scores", async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')
  const lineup = page.getByRole('region', { name: 'Every channel against the limit' })
  const rows = lineup.getByRole('listitem')
  await lineup.getByRole('button', { name: /more channels/ }).click()

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
  await expect(lineup.locator('.figure-answer')).toHaveText('No channel went past the limit of 6.0. The closest was Platen RF load cap, at 5.5.')
  await expect(lineup.getByRole('listitem').first()).toContainText('Gas 1 flow')
  await expect(lineup.getByRole('listitem').first().getByRole('link')).toHaveAttribute('aria-current', 'true')
  await expect(lineup.locator('.figure-source')).toContainText('In the detectors\' rank')
  await expect(lineup.locator('.figure-source')).toContainText('so the dots need not fall in order')
  // the method sits in a closed disclosure
  await expect(lineup.locator('details.how')).not.toHaveAttribute('open')
})

test('tints the open channel\'s row and bars it in ink, inside the figure', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')
  const lineup = page.getByRole('region', { name: 'Every channel against the limit' })
  const selected = lineup.locator('.lineup-row.selected')

  // the ink bar is inset, an edge inside the row, not a shadow reaching past it
  await expect(selected).toHaveCSS('box-shadow', /inset/)
  await expect(selected).toHaveCSS('background-color', 'rgb(235, 227, 209)')
  const figure = await lineup.boundingBox()
  const row = await selected.boundingBox()
  const name = await selected.getByRole('link').boundingBox()
  expect(row?.x ?? 0).toBeGreaterThanOrEqual((figure?.x ?? 0) - 0.5)
  expect((row?.x ?? 0) + (row?.width ?? 0)).toBeLessThanOrEqual((figure?.x ?? 0) + (figure?.width ?? 0) + 0.5)
  // the tint has room either side of the text
  expect((name?.x ?? 0) - (row?.x ?? 0)).toBeGreaterThanOrEqual(8)
})

test('never scrolls sideways on a phone, and fits a lot of ten in its strip', async ({ page }) => {
  await serveApi(page)
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 800 })
    for (const run of [55, 133, 136, 11]) {
      await page.goto(`/runs/${run}`)
      await expect(page.locator('figure.chart svg')).toBeVisible()
      await expect(page.getByRole('group', { name: /wafer by wafer/ })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `run ${run} at ${width}`).toBe(width)
      const overflow = await page.locator('.lot-strip').evaluate((strip) => strip.scrollWidth - strip.clientWidth)
      expect(overflow, `strip of run ${run} at ${width}`).toBeLessThanOrEqual(0)
    }
  }
})

test('starts every figure of the run on the phone\'s gutter and keeps the scale readable', async ({ page }) => {
  await serveApi(page)
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/runs/55')
  const lineup = page.getByRole('region', { name: 'Every channel against the limit' })
  await expect(lineup.getByRole('listitem')).toHaveCount(10)

  const figure = await lineup.boundingBox()
  const heading = await lineup.getByRole('heading', { level: 2 }).boundingBox()
  expect(Math.abs((figure?.x ?? 0) - 16)).toBeLessThan(1)
  expect(Math.abs((heading?.x ?? 0) - 16)).toBeLessThan(1)
  // the verdict's numeral steps down a size on a phone
  await expect(page.locator('.verdict-num')).toHaveCSS('font-size', '60px')
  // at this width the three labels of the scale fit side by side
  const ticks = lineup.locator('.lineup-tick')
  await expect(ticks).toHaveText(['0', 'limit 6.0', '20'])
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
})

test('keeps the trace readable in dark mode: an ink envelope, the band apart from the paper, the red overlay', async ({ page }) => {
  await serveApi(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/runs/55')
  const svg = page.locator('figure.chart svg')
  await expect(svg.locator('path.reading.out').first()).toBeVisible()

  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(18, 17, 14)')
  await expect(svg.locator('path.reading').first()).toHaveCSS('fill', 'rgb(242, 236, 224)')
  await expect(svg.locator('path.reading.out').first()).toHaveCSS('fill', 'rgb(255, 90, 71)')
  await expect(svg.locator('path.band-area').first()).toHaveCSS('fill', 'rgb(43, 39, 32)')
})

test('lists the channels by rank, with no limit to line them up against, when there is no baseline', async ({ page }) => {
  await serveApi(page)
  await serveRun55(page, (run) => ({ ...run, baseline: null, assessment: null }))
  await page.goto('/runs/55')
  const channels = page.getByRole('region', { name: 'Channels by rank' })

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 5 of Lot 6 was not scored.')
  await expect(page.locator('.run-lead')).toHaveText('There is no baseline yet, so no run has a score.')
  await expect(page.getByRole('region', { name: 'Every channel against the limit' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'How unusual' })).toHaveCount(0)
  await expect(channels.locator('tbody tr')).toHaveCount(31)
  await expect(channels.locator('tbody tr').first()).toContainText('Platen RF load cap')
  await expect(channels.locator('tbody tr').first().locator('td').nth(2)).toHaveText('18.8')
  await expect(channels.locator('.lineup-dot')).toHaveCount(0)
})

test('holds the page\'s shape while the run loads', async ({ page }) => {
  await serveApi(page)
  const release = await holdBack(page, '/api/runs/55')
  await page.goto('/runs/55')

  await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toBeVisible()
  await expect(page.locator('.run-head .skel-title')).toHaveCount(2)
  release()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 5 of Lot 6 is out of range.')
})
