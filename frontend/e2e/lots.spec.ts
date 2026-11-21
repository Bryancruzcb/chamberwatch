import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { serveApi } from './api.ts'
import { limitEdgesByColumn, ringsPastLimit } from './locators.ts'

/** Answers one API path with a 503 and the reason, the way the API does while its database starts. */
async function failing(page: Page, matches: (url: URL) => boolean, detail = 'the database is starting') {
  await page.route(matches, (route) => route.fulfill({
    status: 503,
    contentType: 'application/problem+json',
    body: JSON.stringify({ title: 'Service Unavailable', detail }),
  }))
}

function fixtureJson(name: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'))
}

/** A fixture list with each object in it changed. */
function mapItems(list: unknown, change: (item: Record<string, unknown>) => Record<string, unknown>): unknown {
  return Array.isArray(list) ? list.map((item: unknown) => (typeof item === 'object' && item !== null ? change({ ...item }) : item)) : list
}

/** A fixture object with one field replaced. */
function withField(value: unknown, field: string, next: unknown): unknown {
  return typeof value === 'object' && value !== null ? { ...value, [field]: next } : value
}

/** The public runs with Lot 2's wafer 4 relabelled good, so the baseline runs are no longer each lot's first three. */
function relabelledRuns(): unknown {
  const runs = fixtureJson('runs.json')
  const list = typeof runs === 'object' && runs !== null && 'runs' in runs ? runs.runs : []
  return withField(runs, 'runs', mapItems(list, (run) => (run.lotNo === 2 && run.positionInLot === 4 ? { ...run, good: true } : run)))
}

/** Holds one API path until the returned function is called. */
async function holding(page: Page, matches: (url: URL) => boolean): Promise<() => void> {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(matches, async (route) => {
    await held
    await route.fallback()
  })
  return release
}

test('opens on the answer: which lots hold the out-of-range runs, then every lot with its wafers as discs', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lots 6 to 9 hold all 15 out-of-range runs.')
  await expect(page.locator('.answer-next')).toHaveText('The other 6 lots ran 60 wafers with none out of range.')
  await expect(page).toHaveTitle('Lots · ChamberWatch')
  const table = page.getByRole('region', { name: 'Every lot' })
  await expect(table.locator('table.lots tbody tr')).toHaveCount(10)
  // ten wafers a lot but four that lot 7 never ran, each disc saying its state in its name
  await expect(table.locator('[data-kind="mini"]')).toHaveCount(96)
  await expect(table.locator('[data-kind="mini"].out')).toHaveCount(15)
  await expect(table.locator('[data-kind="not-run"]')).toHaveCount(1)
  await expect(table.getByRole('link', { name: 'Lot 6, wafer 5: out of range, how unusual 18.8' })).toHaveAttribute('href', '/runs/55')
  // the baseline is the first three wafers of every lot, so one bracket names it over the column
  await expect(table.locator('.wafers-bracket')).toHaveCount(1)
  await expect(table.locator('.disc.baseline')).toHaveCount(0)
  await expect(table.locator('.lots-key')).toHaveText('Filled: out of range. Ring: in range. Dash: not run. Wafers 1 to 3, left of the dotted line, are the baseline runs.')
  await expect(table.getByRole('row', { name: /Lot 6/ }).locator('.c-out')).toHaveText('7')
  await expect(page.getByRole('img', { name: /^Mean drift score by wafer position/ }).locator('[data-kind="dot"]')).toHaveCount(10)
  await expect(page.getByRole('img', { name: /^Depth loss by wafer position/ }).locator('[data-kind="dot"]')).toHaveCount(20)
})

test('numbers the figures in page order and keeps one tab stop per lot in the table', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots')

  await expect(page.locator('[data-kind="mini"]')).toHaveCount(96)
  expect(await page.locator('.figure.numbered h2').allTextContents())
    .toEqual(['Every lot', 'Drift and depth by wafer position', 'Depth predicted from the telemetry'])
  // the discs are links for the pointer; the keyboard goes lot by lot, and each lot's page lists its wafers
  await expect(page.locator('[data-kind="mini"][tabindex="-1"]')).toHaveCount(96)
  await page.getByRole('link', { name: 'Lot 1', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Lot 2', exact: true })).toBeFocused()
})

test('draws the baseline zone and labels each line at its end, the drift peak annotated', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots')
  const drift = page.getByRole('img', { name: /^Mean drift score by wafer position/ })
  const loss = page.getByRole('img', { name: /^Depth loss by wafer position/ })

  await expect(drift.locator('.baseline-zone text')).toHaveText('BASELINE')
  // on the depth charts the shaded wafers are the depth reference, so the zone says which wafers, not what they are
  await expect(loss.locator('.baseline-zone text')).toHaveText('FIRST 3')
  await expect(drift.locator('.end-value')).toHaveText('1.20')
  await expect(drift.locator('.peak-label')).toHaveText('1.35')
  await expect(loss.locator('.end-value')).toHaveText(['0.90', '0.84'])
  await expect(loss.locator('.end-name')).toHaveText(['89-point', '9-point'])
  // the two ends sit 0.06 apart; their labels are pushed apart so neither covers the other
  const [upper, lower] = await loss.locator('.end-value').evaluateAll((labels) => labels.map((label) => label.getBoundingClientRect().top))
  expect((lower ?? 0) - (upper ?? 0)).toBeGreaterThanOrEqual(30)
  // the second series is dashed with hollow points: ink both, never a second hue
  await expect(loss.locator('.series-2 .series-line')).toHaveCSS('stroke-dasharray', '6px, 4px')
  await expect(loss.locator('.series-2 .dot').first()).toHaveCSS('fill', 'rgb(245, 239, 226)')
})

test('switches to the simulated lots, which drift but have no measured depth', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots')
  const heads = page.locator('table.lots thead th')
  await expect(heads).toHaveText(['Lot', 'Date', 'Wafers 1 to 10', 'Conditioning', 'Runs', 'Out of range'])
  await page.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Simulated' }).click()

  await expect(page).toHaveURL(/source=SYNTHETIC/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lots 6, 7 and 901 hold all 8 out-of-range runs.')
  await expect(page.locator('table.lots tbody tr')).toHaveCount(11)
  await expect(page.locator('[data-kind="mini"]')).toHaveCount(40)
  // no simulated lot has a date or a conditioning, so neither column is drawn
  await expect(heads).toHaveText(['Lot', 'Wafers 1 to 10', 'Runs', 'Out of range'])
  await expect(page.locator('table.lots tbody tr').first().locator('td')).toHaveCount(3)
  await expect(page.getByRole('region', { name: 'Drift by wafer position' })).toBeVisible()
  await expect(page.getByRole('img', { name: /^Mean drift score by wafer position/ }).locator('[data-kind="dot"]')).toHaveCount(10)
  await expect(page.getByRole('img', { name: /^Depth loss by wafer position/ })).toHaveCount(0)
  await expect(page.getByText('Simulated wafers have no measured depth')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Depth predicted from the telemetry' })).toHaveCount(0)
  await expect(page.locator('.page-source')).toContainText('seeded simulator')
  // the out-of-range count opens the lot's rows on the runs page
  await expect(page.getByRole('link', { name: '5', exact: true })).toHaveAttribute('href', '/?source=SYNTHETIC#lot-21')
})

test('says so when a source has no lots, and keeps the Source switch to leave it', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots?source=LIVE')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No lots yet.')
  const figure = page.getByRole('region', { name: 'Every lot' })
  await expect(figure.getByRole('status')).toHaveText('A wafer recorded on the Live page shows up here when its run ends. Open the Live page')
  await expect(figure.getByRole('link', { name: 'Open the Live page' })).toHaveAttribute('href', '/live')
  await expect(figure.locator('.state-title')).toHaveCount(0)
  await expect(figure.locator('.fig-no')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Drift and depth by wafer position' })).toHaveCount(0)

  await figure.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Public' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lots 6 to 9 hold all 15 out-of-range runs.')
})

test('holds the answer and the table\'s place while the lots load, with the Source switch usable', async ({ page }) => {
  await serveApi(page)
  const release = await holding(page, (url) => url.pathname === '/api/lots')
  await page.goto('/lots')

  await expect(page.getByRole('status').filter({ hasText: 'Loading lots' })).toHaveText('Loading lots')
  await expect(page.locator('.answer .skel-title')).toHaveCount(2)
  const figure = page.getByRole('region', { name: 'Every lot' })
  await expect(figure).toHaveAttribute('aria-busy', 'true')
  await expect(figure.locator('.skel-lots')).toBeVisible()
  await expect(figure.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Simulated' })).toBeEnabled()

  release()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lots 6 to 9 hold all 15 out-of-range runs.')
  await expect(figure).not.toHaveAttribute('aria-busy', 'true')
})

test('holds each lot\'s wafers in place while the runs load, and says so if the runs fail, with a way to ask again', async ({ page }) => {
  await serveApi(page)
  const release = await holding(page, (url) => url.pathname === '/api/runs')
  await page.goto('/lots')

  await expect(page.locator('table.lots tbody tr')).toHaveCount(10)
  await expect(page.locator('.skel-minis')).toHaveCount(10)
  release()
  await expect(page.locator('[data-kind="mini"]')).toHaveCount(96)
  await expect(page.locator('.skel-minis')).toHaveCount(0)

  let fail = true
  await page.route((url) => url.pathname === '/api/runs', (route) => (fail
    ? route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Internal Server Error' }) })
    : route.fallback()))
  await page.reload()
  await expect(page.locator('table.lots tbody tr')).toHaveCount(10)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lots 6 to 9 hold all 15 out-of-range runs.')
  await expect(page.getByRole('alert')).toHaveText('The wafers did not load. Try again')
  for (const cell of await page.locator('td.c-wafers').all()) {
    await expect(cell).toBeEmpty()
  }
  await expect(page.locator('.lots-key')).toHaveCount(0)

  fail = false
  await page.getByRole('alert').getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('[data-kind="mini"]')).toHaveCount(96)
  await expect(page.locator('.lots-key')).toHaveCount(1)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('says why the lots did not load, with a way to ask again', async ({ page }) => {
  await serveApi(page)
  let fail = true
  await page.route((url) => url.pathname === '/api/lots', (route) => (fail
    ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Service Unavailable', detail: 'the database is starting' }) })
    : route.fallback()))
  await page.goto('/lots')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The lots did not load.')
  await expect(page.getByRole('alert')).toContainText('Could not load the lots')
  await expect(page.getByRole('alert')).toContainText('the database is starting')
  await expect(page.getByRole('region', { name: 'Drift and depth by wafer position' })).toHaveCount(0)

  fail = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lots 6 to 9 hold all 15 out-of-range runs.')
})

test('never calls a source with no baseline clean', async ({ page }) => {
  await serveApi(page)
  const runs: unknown = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'runs.json'), 'utf8'))
  await page.route((url) => url.pathname === '/api/runs', (route) => route.fulfill({
    json: typeof runs === 'object' && runs !== null ? { ...runs, baseline: null } : runs,
  }))
  await page.goto('/lots')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('None of the 10 lots has been scored yet.')
  await expect(page.locator('.answer-next')).toHaveText('There is no baseline yet, so no run has a score.')
})

test('waits for the runs before calling clean lots clean, and claims nothing about scoring if they fail', async ({ page }) => {
  await serveApi(page)
  const clean = mapItems(fixtureJson('lots.json'), (lot) => ({ ...lot, flaggedRuns: 0 }))
  await page.route((url) => url.pathname === '/api/lots', (route) => route.fulfill({ json: clean }))
  await page.route((url) => url.pathname === '/api/runs', (route) => route.fulfill({ json: withField(fixtureJson('runs.json'), 'baseline', null) }))
  const release = await holding(page, (url) => url.pathname === '/api/runs')
  await page.goto('/lots')

  // the lots are in, the runs that say whether anything was scored are not: no sentence yet
  await expect(page.locator('table.lots tbody tr')).toHaveCount(10)
  await expect(page.locator('.answer .skel-title')).toHaveCount(2)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lots')
  release()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('None of the 10 lots has been scored yet.')

  await failing(page, (url) => url.pathname === '/api/runs')
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No lot has an out-of-range run on record.')
})

test('gives the simulated drift figure an answer from how many lots ran each position, and the readout the runs', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots?source=SYNTHETIC')
  const figure = page.getByRole('region', { name: 'Drift by wafer position' })
  const chart = page.getByRole('img', { name: /^Mean drift score by wafer position/ })

  await expect(figure.locator('.figure-answer')).toHaveText('Wafers 4 to 10 come from one lot; wafers 1 to 3 average 11 lots.')
  // the planted fault at wafer 7 is one lot's wafer, so it is not called the peak
  await expect(chart.locator('[data-kind="dot"]')).toHaveCount(10)
  await expect(chart.locator('.peak-label')).toHaveCount(0)
  await chart.focus()
  await page.keyboard.press('End')
  await expect(figure.locator('.readout')).toContainText('Runs')
  await expect(figure.locator('.readout')).toContainText('Wafer 10')
  await expect(figure.getByRole('status')).toHaveText('Wafer 10. Mean drift score 1.47. Runs 1.')
  await figure.getByText('How this is counted').click()
  await expect(figure.getByText(/A position averages every lot that ran a wafer there/)).toBeVisible()
  // the note sits under the answer, never over the title
  const title = await figure.locator('h2').boundingBox()
  const note = await figure.locator('.figure-note').boundingBox()
  expect(note?.y ?? 0).toBeGreaterThanOrEqual((title?.y ?? 0) + (title?.height ?? 0))
})

test('keeps the note under the title when a figure has no answer line', async ({ page }) => {
  await serveApi(page)
  const report = fixtureJson('drift-vs-depth-synthetic.json')
  const full = typeof report === 'object' && report !== null && 'positions' in report
    ? withField(report, 'positions', mapItems(report.positions, (position) => ({ ...position, runs: 11 })))
    : report
  await page.route((url) => url.pathname === '/api/reports/drift-vs-depth', (route) => route.fulfill({ json: full }))
  await page.goto('/lots?source=SYNTHETIC')
  const figure = page.getByRole('region', { name: 'Drift by wafer position' })

  await expect(figure.locator('.figure-note')).toHaveText('Simulated wafers have no measured depth, so only the drift score is shown.')
  await expect(figure.locator('.figure-answer')).toHaveCount(0)
  const title = await figure.locator('h2').boundingBox()
  const note = await figure.locator('.figure-note').boundingBox()
  expect(note?.y ?? 0).toBeGreaterThanOrEqual((title?.y ?? 0) + (title?.height ?? 0))
})

test('gives no drift answer while another source\'s report loads', async ({ page }) => {
  await serveApi(page)
  const release = await holding(page, (url) => url.pathname === '/api/reports/drift-vs-depth' && url.searchParams.get('source') === 'SYNTHETIC')
  await page.goto('/lots')
  // found by its place, since the figure's title follows what its report holds
  const figure = page.locator('section[aria-labelledby="report-title"]')
  await expect(figure.locator('h2')).toHaveText('Drift and depth by wafer position')
  await expect(figure.locator('.figure-answer')).toContainText('By wafer 10')

  await page.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Simulated' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lots 6, 7 and 901 hold all 8 out-of-range runs.')
  await expect(figure.locator('.figure-answer')).toHaveCount(0)
  await expect(figure).toHaveAttribute('aria-busy', 'true')
  release()
  await expect(figure.locator('.figure-answer')).toContainText('one lot')
  await expect(figure.locator('h2')).toHaveText('Drift by wafer position')
  await expect(figure).not.toHaveAttribute('aria-busy', 'true')
})

test('shades the baseline on the drift chart only while the baseline runs are each lot\'s first wafers', async ({ page }) => {
  await serveApi(page)
  const runs = relabelledRuns()
  await page.route((url) => url.pathname === '/api/runs', (route) => route.fulfill({ json: runs }))
  await page.goto('/lots')

  await expect(page.locator('[data-kind="mini"]')).toHaveCount(96)
  await expect(page.locator('.lots-key')).toContainText('A centre dot marks a baseline run.')
  await expect(page.getByRole('img', { name: /^Mean drift score by wafer position/ }).locator('.baseline-zone')).toHaveCount(0)
  await expect(page.getByRole('img', { name: /^Depth loss by wafer position/ }).locator('.baseline-zone text')).toHaveText('FIRST 3')
  await expect(page.getByRole('img', { name: /^Measured and predicted mean depth/ }).locator('.baseline-zone text')).toHaveText('FIRST 3')
  await expect(page.getByRole('table', { name: /How far each guess misses/ })).toContainText('Wafers after the first 3, root mean square error.')
})

test('reads the depth model\'s wafers aloud and shows them as a table', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots')
  const figure = page.getByRole('region', { name: 'Depth predicted from the telemetry' })
  const chart = page.getByRole('img', { name: /^Measured and predicted mean depth by wafer position/ })

  await expect(figure.getByRole('status')).toHaveText('')
  await chart.focus()
  await page.keyboard.press('ArrowRight')
  await expect(figure.getByRole('status')).toContainText('Wafer 2. Measured')
  await figure.getByRole('button', { name: 'Show as a table' }).click()
  await expect(figure.getByRole('button', { name: 'Hide the table' })).toHaveAttribute('aria-expanded', 'true')
  await expect(figure.getByRole('table', { name: 'Measured and predicted mean depth by wafer position' }).locator('tbody tr')).toHaveCount(10)
})

test('sets the figures one gap apart, 48px on a wide page and 36px on a phone', async ({ page }) => {
  for (const [width, gap] of [[1280, 48], [375, 36]] as const) {
    await page.setViewportSize({ width, height: 900 })
    await serveApi(page)
    await page.goto('/lots')
    await expect(page.locator('[data-kind="mini"]')).toHaveCount(96)
    await expect(page.locator('.figure.numbered')).toHaveCount(3)
    const boxes = await page.locator('.figure.numbered').evaluateAll((figures) => figures.map((figure) => figure.getBoundingClientRect()))
    for (const [index, box] of boxes.slice(1).entries()) {
      const above = boxes[index]
      expect(Math.round(box.top - (above?.bottom ?? 0))).toBe(gap)
    }
  }
})

test('says why the drift report did not load, in its figure, and keeps the lots', async ({ page }) => {
  await serveApi(page)
  await failing(page, (url) => url.pathname === '/api/reports/drift-vs-depth')
  await page.goto('/lots')

  const drift = page.getByRole('region', { name: 'Drift and depth by wafer position' })
  await expect(drift.getByRole('alert')).toContainText('the database is starting')
  await expect(drift.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.locator('table.lots tbody tr')).toHaveCount(10)
})

test('compares the depth predicted from the telemetry with two simpler guesses', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots')
  const panel = page.getByRole('region', { name: 'Depth predicted from the telemetry' })
  const bars = panel.getByRole('table', { name: /How far each guess misses/ })

  await expect(bars.getByRole('row', { name: /Telemetry model/ })).toContainText('0.16 µm')
  await expect(bars.getByRole('row', { name: /Position in the lot/ })).toContainText('0.21 µm')
  await expect(bars.getByRole('row', { name: /first wafers/ })).toContainText('0.71 µm')
  await expect(bars.locator('.miss-tick')).toHaveText(['0.0', '0.2', '0.4', '0.6', '0.8'])
  // the worst guess is drawn hollow, so it never rests on length alone
  await expect(bars.locator('tr.worst')).toHaveText(/The lot's first wafers/)
  await expect(panel).toContainText('Over every measured wafer: telemetry model 0.16 µm and position in the lot 0.22 µm.')
  await expect(panel.locator('.leans li')).toHaveCount(5)
  await expect(panel.locator('.leans li').first()).toContainText('Foreline pressure, C4F8 spread')
  await expect(panel.locator('.leans li').first().locator('.lean-value')).toHaveText('−0.066 µm')
  await expect(panel.locator('.figure-answer')).toHaveText(
    'After each lot\'s first wafers, the telemetry misses a wafer\'s depth by 0.16 µm, against 0.21 µm for a guess from its place in the lot and 0.71 µm from the lot\'s first wafers.',
  )
  await expect(page.getByRole('region', { name: 'Drift and depth by wafer position' }).locator('.figure-answer'))
    .toHaveText('By wafer 10, wafers etch 0.90 µm shallower than the first 3 of their lot, on average.')
})

test('prints the miss bars\' ticks to as many decimals as their step needs', async ({ page }) => {
  await serveApi(page)
  const model = fixtureJson('depth-model.json')
  const methods = typeof model === 'object' && model !== null && 'methods' in model ? model.methods : []
  const better = withField(model, 'methods', mapItems(methods, (method) => (method.method === 'FIRST_WAFERS'
    ? { ...method, late: withField(method.late, 'rmseUm', 0.25) }
    : method)))
  await page.route((url) => url.pathname === '/api/reports/depth-model', (route) => route.fulfill({ json: better }))
  await page.goto('/lots')
  const bars = page.getByRole('table', { name: /How far each guess misses/ })

  await expect(bars.getByRole('row', { name: /first wafers/ })).toContainText('0.25 µm')
  await expect(bars.locator('.miss-tick')).toHaveText(['0.00', '0.05', '0.10', '0.15', '0.20', '0.25'])
})

test('shows the drift as a table and opens the method on request', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots')
  const drift = page.getByRole('region', { name: 'Drift and depth by wafer position' })

  await drift.getByRole('button', { name: 'Show as a table' }).click()
  await expect(drift.getByRole('table', { name: 'Drift and depth by wafer position' }).locator('tbody tr')).toHaveCount(10)
  await expect(drift.getByRole('button', { name: 'Hide the table' })).toHaveAttribute('aria-expanded', 'true')
  await drift.getByText('How this is counted').click()
  await expect(drift.getByText(/A position averages every lot that ran a wafer there/)).toBeVisible()
})

for (const width of [320, 360]) {
  for (const source of ['PUBLIC', 'SYNTHETIC']) {
    test(`never breaks the ${source} headline at a hyphen at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await serveApi(page)
      await page.goto(source === 'PUBLIC' ? '/lots' : '/lots?source=SYNTHETIC')
      const heading = page.getByRole('heading', { level: 1 })

      await expect(heading).toContainText('out-of-range runs.')
      await page.evaluate(() => document.fonts.ready)
      // the text each line of the heading holds, read one character at a time
      const lines = await heading.evaluate((h1) => {
        const rows = new Map<number, string>()
        const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const text = node.textContent ?? ''
          for (let index = 0; index < text.length; index += 1) {
            const range = document.createRange()
            range.setStart(node, index)
            range.setEnd(node, index + 1)
            const box = range.getClientRects()[0]
            if (box !== undefined) {
              const top = Math.round(box.top)
              rows.set(top, (rows.get(top) ?? '') + text.charAt(index))
            }
          }
        }
        return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text)
      })
      expect(lines.length).toBeGreaterThan(1)
      for (const line of lines) {
        expect(line.trimEnd()).not.toMatch(/-$/)
      }
      await expect(heading).toHaveText(source === 'PUBLIC' ? 'Lots 6 to 9 hold all 15 out-of-range runs.' : 'Lots 6, 7 and 901 hold all 8 out-of-range runs.')
    })
  }
}

for (const width of [320, 375]) {
  test(`fits a ${width}px phone: no sideways scroll, every lot's ten wafers on a line of their own`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await serveApi(page)
    await page.goto('/lots')

    await expect(page.locator('[data-kind="mini"]')).toHaveCount(96)
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    expect(await page.locator('.lots').evaluate((table) => table.closest('.table-wrap')?.scrollWidth === table.closest('.table-wrap')?.clientWidth)).toBe(true)
    // a lot's wafers sit under its name, each disc still a 26px wide target
    const row = page.getByRole('row', { name: /Lot 6/ })
    const name = await row.getByRole('link', { name: 'Lot 6', exact: true }).boundingBox()
    const discs = await row.locator('.minis').boundingBox()
    expect((discs?.y ?? 0)).toBeGreaterThan((name?.y ?? 0) + (name?.height ?? 0) - 1)
    expect((await row.locator('[data-kind="mini"]').first().boundingBox())?.width).toBe(26)
    await expect(row.locator('.c-date')).toBeHidden()
    // the miss bars' axis keeps every tick inside the page's gutter, the first one set from its mark rightward
    await expect(page.locator('.miss-tick')).toHaveCount(5)
    const ticks = await page.locator('.miss-tick').evaluateAll((all) => all.map((tick) => {
      const box = tick.getBoundingClientRect()
      return { left: box.left, right: box.right }
    }))
    for (const tick of ticks) {
      expect(tick.left).toBeGreaterThanOrEqual(16)
      expect(tick.right).toBeLessThanOrEqual(width - 16)
    }
  })
}

test('opens a lot on its answer: its wafers as discs over the sentence that says which are out of range', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots/6')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafers 4 to 10 of Lot 6 are out of range.')
  await expect(page).toHaveTitle('Lot 6 · ChamberWatch')
  await expect(page.locator('.page-head .answer-next')).toHaveText(
    "By the last wafer, the line fitted through the lot's SF6 means is outside the band for 4 channels, and none is heading out.",
  )
  const strip = page.getByRole('group', { name: 'Lot 6, wafer by wafer' })
  await expect(strip.locator('.disc')).toHaveCount(10)
  await expect(strip.locator('.disc.out')).toHaveCount(7)
  await expect(strip.locator('.strip-bracket')).toHaveText('Baseline')
  await expect(strip.locator('[aria-current]')).toHaveCount(0)
  await expect(strip.getByRole('link', { name: 'Lot 6, wafer 5: out of range, how unusual 18.8' })).toHaveAttribute('href', '/runs/55')
  await expect(page.locator('.page-meta')).toContainText('Aug 1, 2024')
  await expect(page.getByRole('link', { name: 'Show them in the runs table' })).toHaveAttribute('href', '/?lot=6')
})

test('scores every wafer of the lot on one line, its state as a disc and words', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots/6')
  const figure = page.getByRole('region', { name: 'How unusual each wafer was' })

  await expect(figure.locator('[data-kind="lot-run"]')).toHaveCount(10)
  await expect(figure.locator('.figure-answer')).toHaveText('The highest score is 24.9, wafer 6. Each line runs from 0 to 25; the tick is the limit, 6.0.')
  await expect(figure.locator('.score-line.out')).toHaveCount(7)
  await expect(figure.locator('[data-kind="lot-run"]').first()).toContainText('Baseline run')
  await expect(figure.getByRole('link', { name: 'Lot 6, Wafer 5' })).toHaveAttribute('href', '/runs/55')
  expect(await page.locator('.figure.numbered h2').allTextContents())
    .toEqual(['How unusual each wafer was', 'SF6 mean by the last wafer', 'Platen RF tuning cap'])
})

test('keeps each in-range ring clear of the limit, and draws the limit at one x down the column', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots/21')
  const figure = page.getByRole('region', { name: 'How unusual each wafer was' })
  await expect(figure.locator('[data-kind="lot-run"]')).not.toHaveCount(0)
  // two of lot 21's wafers run past the end of the line, which once drew their limit 1.2px left of the others'
  await expect(figure.locator('.score-line.past')).not.toHaveCount(0)

  const reach = await ringsPastLimit(page)
  expect(reach.length).toBeGreaterThan(0)
  expect(Math.max(...reach)).toBeLessThanOrEqual(0)
  for (const edges of await limitEdgesByColumn(page)) {
    expect(edges).toHaveLength(1)
  }
})

test('counts how the lot\'s channels end, and opens the channel that left the band', async ({ page }) => {
  const api = await serveApi(page)
  await page.goto('/lots')
  await page.getByRole('link', { name: 'Lot 6', exact: true }).click()

  const verdicts = page.getByRole('region', { name: 'SF6 mean by the last wafer' })
  await expect(verdicts.locator('.drift-counts li')).toHaveText([/4\s*Out of band/, /10\s*Stays in the band/, /17\s*No trend/])
  // a warning verdict is a word in the warning color, never the out-of-range red
  await expect(verdicts.locator('.drift-counts .word.warn')).toHaveText('Out of band')
  await expect(verdicts.getByRole('link', { name: 'Platen RF tuning cap' })).toHaveAttribute('aria-current', 'true')
  const channel = page.getByRole('region', { name: 'Platen RF tuning cap' })
  await expect(channel.locator('.figure-control .word.warn')).toHaveText('Out of band')
  await expect(channel.locator('.figure-answer')).toHaveText("By wafer 10 the fitted mean is outside the good runs' band.")
  await expect(page.getByRole('img', { name: /^SF6 phase mean of Platen RF tuning cap by wafer position/ }).locator('[data-kind="dot"]')).toHaveCount(10)
  await expect(channel.getByRole('table', { name: 'Wafer by wafer' }).getByRole('link', { name: 'Wafer 5' })).toHaveAttribute('href', '/runs/55')

  await verdicts.getByRole('link', { name: 'Fluorine 703.7 nm' }).click()
  await expect(page).toHaveURL(/channel=/)
  await expect(page.getByRole('heading', { level: 2, name: 'Fluorine 703.7 nm' })).toBeVisible()

  await page.getByRole('group', { name: 'Phase' }).getByRole('button', { name: 'C4F8' }).click()
  await expect(page).toHaveURL(/phase=C4F8/)
  await expect.poll(() => api.requests.some((path) => path.startsWith('/api/lots/6/drift') && path.includes('phase=C4F8'))).toBe(true)

  await page.getByRole('group', { name: 'Reference' }).getByRole('button', { name: "This lot's first wafers" }).click()
  await expect(page).toHaveURL(/reference=LOT/)
  await expect.poll(() => api.requests.some((path) => path.startsWith('/api/lots/6/drift') && path.includes('reference=LOT'))).toBe(true)
  await expect(page.getByText("This lot's first 3 wafers ± 3.0 sd of the good runs")).toBeVisible()
  // the band is built from the lot's first wafers, so the chart shades them and says which they are, as the Lots page
  // does: they need not be the lot's baseline runs
  await expect(page.locator('.baseline-zone')).toHaveCount(1)
  await expect(page.locator('.baseline-zone text')).toHaveText('FIRST 3')
})

test('keeps the answer and the heading on the phase its counts were made for while another phase loads', async ({ page }) => {
  await serveApi(page)
  const release = await holding(page, (url) => url.pathname === '/api/lots/6/drift' && url.searchParams.get('phase') === 'C4F8')
  await page.goto('/lots/6')
  await page.getByRole('group', { name: 'Phase' }).getByRole('button', { name: 'C4F8' }).click()

  // the C4F8 answer is on its way: the control shows the click, the numbers still say what they count
  await expect(page.getByRole('group', { name: 'Phase' }).getByRole('button', { name: 'C4F8' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'SF6 mean by the last wafer' })).toBeVisible()
  await expect(page.locator('.page-head .answer-next')).toContainText("the lot's SF6 means is outside the band for 4 channels")

  release()
  await expect(page.getByRole('region', { name: 'C4F8 mean by the last wafer' })).toBeVisible()
  await expect(page.locator('.page-head .answer-next')).toContainText('C4F8 means')
})

test('opens a simulated lot from the simulated lots, its links kept on that source', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots?source=SYNTHETIC')
  await page.getByRole('link', { name: 'Lot 901', exact: true }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafers 5 to 7, 9 and 10 of Lot 901 are out of range.')
  await expect(page.locator('.breadcrumb').getByRole('link', { name: 'Lots' })).toHaveAttribute('href', '/lots?source=SYNTHETIC')
  await expect(page.getByRole('link', { name: 'Show them in the runs table' })).toHaveAttribute('href', /^\/\?lot=\d+&source=SYNTHETIC$/)
  // a step change prints in full in the answer, not to a tenth
  await expect(page.getByRole('region', { name: 'How unusual each wafer was' }).locator('.figure-answer')).toContainText('The highest score is 97,795, wafer 7.')
})

test('says why when a lot\'s runs do not load, and leaves no placeholder waiting in the header', async ({ page }) => {
  await serveApi(page)
  await failing(page, (url) => url.pathname === '/api/runs' && url.searchParams.get('lot') === '6')
  await page.goto('/lots/6')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lot 6')
  await expect(page.getByRole('alert')).toContainText('the database is starting')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.locator('.page-head .answer-next')).toHaveCount(0)
  await expect(page.locator('.page-head .skel, .page-head .lot-strip')).toHaveCount(0)
})

test('holds the lot\'s shape while it loads, and says when a lot does not exist', async ({ page }) => {
  await serveApi(page)
  const release = await holding(page, (url) => url.pathname === '/api/lots/6/drift')
  await page.goto('/lots/6')

  await expect(page.getByRole('status')).toContainText('Loading')
  await expect(page.locator('.lot-strip.placeholder')).toBeVisible()
  release()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafers 4 to 10 of Lot 6 are out of range.')

  // a lot the API has never heard of gets the not-found page, with the way back to the lots
  await page.goto('/lots/99')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('There is no lot 99.')
  await expect(page).toHaveTitle('Not found · ChamberWatch')
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Back to the lots' }).click()
  await expect(page).toHaveURL(/\/lots$/)
  await page.goto('/lots/six')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing is at this address.')
})

for (const width of [320, 375]) {
  test(`fits a lot on a ${width}px phone without sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await serveApi(page)
    await page.goto('/lots/6')

    await expect(page.locator('[data-kind="lot-run"]')).toHaveCount(10)
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    const strip = page.locator('.lot-strip')
    expect(await strip.evaluate((row) => row.scrollWidth - row.clientWidth)).toBe(0)
  })
}

test('says why a lot that exists did not load, with a way to ask again under a heading', async ({ page }) => {
  await serveApi(page)
  await failing(page, (url) => url.pathname === '/api/lots/6/drift')
  await page.goto('/lots/6')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lot')
  await expect(page.locator('h1')).toHaveClass(/visually-hidden/)
  await expect(page.locator('.state-title')).toHaveText('This lot did not load')
  await expect(page.getByRole('alert')).toContainText('the database is starting')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page).toHaveTitle('Lot · ChamberWatch')
})

test("prints the fitted line's z beside the verdict, which is what the verdict judges", async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots?source=SYNTHETIC')
  await page.getByRole('link', { name: 'Lot 901', exact: true }).click()

  const verdicts = page.getByRole('region', { name: 'SF6 mean by the last wafer' })
  await expect(verdicts.locator('.drift-table thead th')).toHaveText(['Channel', 'By the last wafer', 'Fitted z'])
  // Gas 5 flow's last wafer sits dead centre, but the line a faulted wafer tilted is 120 sd below the band
  await expect(verdicts.locator('.drift-table tbody tr').first()).toHaveText(/Gas 5 flow\s*Out of band\s*-120/)
  await expect(page.locator('.page-head .answer-next')).toHaveText(
    "By the last wafer, the line fitted through the lot's SF6 means is outside the band for 6 channels, and none is heading out.",
  )
  // the wafer table keeps each wafer's own z beside its mean
  const wafers = page.getByRole('table', { name: 'Wafer by wafer' })
  await expect(wafers.locator('tbody tr').last().locator('td').nth(2)).toHaveText('0.0')
})

test("folds the lot's channels with no trend behind a button, and opens it for a folded channel", async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots/6')
  const verdicts = page.getByRole('region', { name: 'SF6 mean by the last wafer' })
  const more = verdicts.getByRole('button', { name: '17 more channels, no trend' })

  await expect(verdicts.locator('.drift-table tbody tr')).toHaveCount(14)
  // the counts above still count every channel
  await expect(verdicts.locator('.drift-counts li')).toHaveText([/4\s*Out of band/, /10\s*Stays in the band/, /17\s*No trend/])
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await more.click()
  await expect(verdicts.locator('.drift-table tbody tr')).toHaveCount(31)
  await expect(verdicts.getByRole('button', { name: 'Hide the 17 channels with no trend' })).toHaveAttribute('aria-expanded', 'true')

  // a channel with no trend picked from the address opens the fold, so its row shows
  await page.goto('/lots/6?channel=Gas5Flow')
  await expect(verdicts.locator('.drift-table tbody tr')).toHaveCount(31)
  await expect(verdicts.getByRole('link', { name: 'Gas 5 flow' })).toHaveAttribute('aria-current', 'true')
  await verdicts.getByRole('button', { name: 'Hide the 16 channels with no trend' }).click()
  // folded again, the picked channel keeps its row
  await expect(verdicts.locator('.drift-table tbody tr')).toHaveCount(15)
  await expect(verdicts.getByRole('button', { name: '16 more channels, no trend' })).toBeVisible()
})

test('defines the words the lot page uses, with the numbers of its drift rule', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots/6')
  const verdicts = page.getByRole('region', { name: 'SF6 mean by the last wafer' })
  const words = verdicts.locator('details.words-how')

  await expect(words).not.toHaveAttribute('open')
  await expect(words.locator('summary')).toHaveText('The words this page uses')
  await words.locator('summary').click()
  await expect(words.locator('dt')).toHaveText(['SF6 and C4F8', 'Fitted z', 'z', 'Fitted line, slope and t', 'Verdicts'])
  await expect(words).toContainText('under 2.5')
  await expect(words).toContainText('a lot of 10')
  await expect(words).toContainText('fewer than 4 wafers')
})

test("keys the lot chart's dots with a dot and lines its wafer table's decimal points up", async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots/6')
  const channel = page.getByRole('region', { name: 'Platen RF tuning cap' })

  await expect(channel.locator('.chart-key li').first().locator('span').first()).toHaveClass(/key-dot/)
  const means = await channel.getByRole('table', { name: 'Wafer by wafer' }).locator('tbody tr td:nth-child(2)').allTextContents()
  expect(means).toHaveLength(10)
  expect(means.every((mean) => /^\d+\.\d\d$/.test(mean))).toBe(true)
  expect(means[1]).toBe('27.30')
  // the slopes, 0.0398 to 0.0839, line up too; the first wafer has no line yet
  const slopes = await channel.getByRole('table', { name: 'Wafer by wafer' }).locator('tbody tr td.c-slope').allTextContents()
  expect(slopes.slice(1).every((slope) => /^\d\.\d{5}$/.test(slope))).toBe(true)
})

test('keeps four digits in a wafer table column that spreads too wide to line up', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots/21')
  const table = page.getByRole('table', { name: 'Wafer by wafer' })

  await expect(table.locator('tbody tr td.c-slope')).toHaveText(['—', '0.1429', '-0.3671', '-0.148', '-0.1122', '-0.1689', '-34.98', '-19.4', '-10.87', '-5.941'])
})

for (const width of [320, 375]) {
  test(`keeps each wafer's name clear of its disc on a ${width}px phone, the discs in one column`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await serveApi(page)
    await page.goto('/lots/21')

    const rows = page.locator('[data-kind="lot-run"]')
    await expect(rows).toHaveCount(10)
    await page.evaluate(() => document.fonts.ready)
    const lefts: number[] = []
    for (const row of await rows.all()) {
      const name = await row.locator('.c-wafer a').boundingBox()
      const disc = await row.locator('.c-state .disc').boundingBox()
      expect(name).not.toBeNull()
      expect(disc).not.toBeNull()
      expect((disc?.x ?? 0)).toBeGreaterThanOrEqual((name?.x ?? 0) + (name?.width ?? 0))
      lefts.push(Math.round(disc?.x ?? 0))
    }
    expect(new Set(lefts).size).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  })
}
