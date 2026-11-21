import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { serveApi } from './api.ts'

/** Answers one API path with a 503 and the reason, the way the API does while its database starts. */
async function failing(page: Page, matches: (url: URL) => boolean, detail = 'the database is starting') {
  await page.route(matches, (route) => route.fulfill({
    status: 503,
    contentType: 'application/problem+json',
    body: JSON.stringify({ title: 'Service Unavailable', detail }),
  }))
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
  await expect(table.locator('.lots-key')).toHaveText('Filled: out of range. Ring: in range. Dash: not run. The bracket marks wafers 1 to 3, the baseline runs.')
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
  await page.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Simulated' }).click()

  await expect(page).toHaveURL(/source=SYNTHETIC/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lots 6, 7 and 901 hold all 8 out-of-range runs.')
  await expect(page.locator('table.lots tbody tr')).toHaveCount(11)
  await expect(page.locator('[data-kind="mini"]')).toHaveCount(40)
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
  await expect(figure.getByRole('status')).toContainText('A wafer recorded on the Live page shows up here when its run ends.')
  await expect(figure.locator('.fig-no')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Drift and depth by wafer position' })).toHaveCount(0)

  await figure.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Public' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lots 6 to 9 hold all 15 out-of-range runs.')
})

test('holds the answer and the table\'s place while the lots load, with the Source switch usable', async ({ page }) => {
  await serveApi(page)
  const release = await holding(page, (url) => url.pathname === '/api/lots')
  await page.goto('/lots')

  await expect(page.getByRole('status')).toHaveText('Loading lots')
  await expect(page.locator('.answer .skel-title')).toHaveCount(2)
  const figure = page.getByRole('region', { name: 'Every lot' })
  await expect(figure).toHaveAttribute('aria-busy', 'true')
  await expect(figure.locator('.skel-lots')).toBeVisible()
  await expect(figure.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Simulated' })).toBeEnabled()

  release()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lots 6 to 9 hold all 15 out-of-range runs.')
  await expect(figure).not.toHaveAttribute('aria-busy', 'true')
})

test('holds each lot\'s wafers in place while the runs load, and leaves them out if the runs fail', async ({ page }) => {
  await serveApi(page)
  const release = await holding(page, (url) => url.pathname === '/api/runs')
  await page.goto('/lots')

  await expect(page.locator('table.lots tbody tr')).toHaveCount(10)
  await expect(page.locator('.skel-minis')).toHaveCount(10)
  release()
  await expect(page.locator('[data-kind="mini"]')).toHaveCount(96)
  await expect(page.locator('.skel-minis')).toHaveCount(0)

  await failing(page, (url) => url.pathname === '/api/runs')
  await page.reload()
  await expect(page.locator('table.lots tbody tr')).toHaveCount(10)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lots 6 to 9 hold all 15 out-of-range runs.')
  await expect(page.locator('[data-kind="mini"]')).toHaveCount(0)
  await expect(page.locator('.skel-minis')).toHaveCount(0)
  await expect(page.locator('.lots-key')).toHaveCount(0)
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

test('shows the drift as a table and opens the method on request', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots')
  const drift = page.getByRole('region', { name: 'Drift and depth by wafer position' })

  await drift.getByRole('button', { name: 'Show as a table' }).click()
  await expect(drift.getByRole('table', { name: 'Drift and depth by wafer position' }).locator('tbody tr')).toHaveCount(10)
  await expect(drift.getByRole('button', { name: 'Hide the table' })).toHaveAttribute('aria-expanded', 'true')
  await drift.getByText('How this is counted').click()
  await expect(drift.getByText(/Each position averages every lot/)).toBeVisible()
})

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
  })
}

test('opens a lot on its answer: its wafers as discs over the sentence that says which are out of range', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots/6')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafers 4 to 10 of Lot 6 are out of range.')
  await expect(page).toHaveTitle('Lot 6 · ChamberWatch')
  await expect(page.locator('.page-head .answer-next')).toHaveText(
    'By the last wafer, the SF6 mean of 4 channels is outside the band, and none is heading out.',
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
  // the band is built from the lot's first wafers, so the chart shades them
  await expect(page.locator('.baseline-zone')).toHaveCount(1)
})

test('keeps the answer and the heading on the phase its counts were made for while another phase loads', async ({ page }) => {
  await serveApi(page)
  const release = await holding(page, (url) => url.pathname === '/api/lots/6/drift' && url.searchParams.get('phase') === 'C4F8')
  await page.goto('/lots/6')
  await page.getByRole('group', { name: 'Phase' }).getByRole('button', { name: 'C4F8' }).click()

  // the C4F8 answer is on its way: the control shows the click, the numbers still say what they count
  await expect(page.getByRole('group', { name: 'Phase' }).getByRole('button', { name: 'C4F8' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'SF6 mean by the last wafer' })).toBeVisible()
  await expect(page.locator('.page-head .answer-next')).toContainText('the SF6 mean of 4 channels')

  release()
  await expect(page.getByRole('region', { name: 'C4F8 mean by the last wafer' })).toBeVisible()
  await expect(page.locator('.page-head .answer-next')).toContainText('C4F8 mean')
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

  await page.goto('/lots/99')
  await expect(page.locator('.state-title')).toHaveText('This lot did not load')
  await expect(page.getByRole('alert')).toContainText('no lot 99')
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
