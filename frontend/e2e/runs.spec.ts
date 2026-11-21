import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'

test.beforeEach(async ({ page }) => {
  await serveApi(page)
})

/** A run row as the API sends it when the run has no score under the current baseline. */
const UNSCORED = { scored: false, limitFlags: null, deviationFlags: null, stuckFlags: null, persistentZ: null, firstChannel: null, firstTimeS: null }

interface RunsAnswer {
  readonly baseline: unknown
  readonly runs: readonly Record<string, unknown>[]
}

/** The public runs as captured from the API, for a test that changes a few of them. */
function publicRuns(): RunsAnswer {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'runs.json'), 'utf8')) as RunsAnswer
}

const isPublicRuns = (url: URL) => url.pathname === '/api/runs' && !url.searchParams.has('source')

test('opens on the answer: how many runs are out of range, where, and which lot to start with', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('15 of 96 runs are out of range, all in lots 6 to 9.')
  // the count is set in the out-of-range red, and stays plain text inside the heading
  await expect(page.locator('h1 .signal-count')).toHaveText('15')
  await expect(page.locator('h1 .signal-count')).toHaveCSS('color', 'rgb(196, 22, 12)')
  await expect(page.locator('.answer-next')).toHaveText('Start with Lot 6: wafers 4 to 10 of 10 are out.')
  await expect(page.getByRole('tab', { name: /Needs a look/ })).toHaveAttribute('aria-selected', 'true')
  const channels = page.getByRole('region', { name: 'Which channel left its range first' })
  await expect(channels.locator('.figure-answer')).toHaveText('Platen RF load cap in 10 of the 15 runs and Platen RF tuning cap in 5.')
  const ledger = page.getByRole('region', { name: 'Out-of-range runs, by lot' })
  await expect(ledger.locator('.ledger-lot-name')).toHaveText(['Lot 6', 'Lot 7', 'Lot 8', 'Lot 9'])
  await expect(ledger.locator('#lot-6 ~ tr')).toHaveCount(7)
  await expect(page.getByText('Lots 1 to 5 and 10: 60 wafers, none out of range.')).toBeVisible()
})

test('numbers the figures in page order, leaving no gap for one that is absent', async ({ page }) => {
  await page.goto('/')
  const numbered = page.locator('.figure.numbered')
  const titles = () => numbered.locator('h2').allTextContents()
  // the number is a CSS counter on the figure, so it follows whichever figures are on the page
  const label = numbered.first().locator('.fig-no')

  await expect(page.locator('[data-kind="grid-cell"]')).toHaveCount(96)
  expect(await titles()).toEqual(['Every wafer, lot by lot', 'Which channel left its range first', 'Out-of-range runs, by lot', 'Drift along the lots'])
  expect(await label.evaluate((span) => getComputedStyle(span, '::before').content)).toBe('"Fig. " counter(figure)')
  expect(await page.locator('main').evaluate((main) => getComputedStyle(main).counterReset)).toBe('figure 0')
  expect(await numbered.first().evaluate((figure) => getComputedStyle(figure).counterIncrement)).toBe('figure 1')
  // the region keeps its title alone as its name: the number is for the eye
  await expect(label).toHaveAttribute('aria-hidden', 'true')
  await expect(page.getByRole('region', { name: 'Drift along the lots' })).toBeVisible()

  // one clean lot: nothing out of range, so the drift is the second figure
  const answer = publicRuns()
  await page.route(isPublicRuns, (route) => route.fulfill({ json: { ...answer, runs: answer.runs.filter((run) => run.lotNo === 1) } }))
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('All 10 runs are in range.')
  await expect(numbered).toHaveCount(2)
  expect(await titles()).toEqual(['Every wafer, lot by lot', 'Drift along the lots'])
})

test('shows every wafer as a disc in a cassette of lots by position, and opens one', async ({ page }) => {
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })

  await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(96)
  await expect(grid.locator('[data-kind="grid-cell"][data-state="out"]')).toHaveCount(15)
  await expect(grid.getByRole('row', { name: /^Lot 6/ }).locator('[data-state="out"]')).toHaveCount(7)
  // lot 7 ran six wafers: its last four slots are one stretch of rail, named once
  const notRun = grid.getByRole('row', { name: /^Lot 7/ }).locator('[data-kind="not-run"]')
  await expect(notRun).toHaveCount(1)
  await expect(notRun).toHaveAttribute('colspan', '4')
  await expect(notRun).toHaveText('not run')
  const out = grid.getByRole('link', { name: 'Lot 6, wafer 5: out of range, how unusual 18.8' })
  await expect(out).toHaveAttribute('href', '/runs/55')
  // an out-of-range disc prints its score; an in-range one is an empty ring
  await expect(out).toHaveText('18.8')
  await expect(grid.getByRole('link', { name: 'Lot 6, wafer 6: out of range, how unusual 24.9' })).toHaveText('24.9')
  await expect(grid.getByRole('link', { name: 'Lot 2, wafer 1: in range, how unusual 5.5, baseline run' })).toHaveText('')
  await expect(grid.getByRole('row', { name: /^Lot 6/ }).locator('td.map-out')).toHaveText('7')
  await expect(grid).toContainText('Source: Zenodo record 17122442')

  await expect(grid.getByRole('link', { name: /^Lot 9, wafer 10: out of range/ })).toHaveAttribute('href', '/runs/86')

  // run 55 is the flagged wafer the captured responses hold a page for
  await out.click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Day_2024_08_01_Wafer_05')
})

test('the map follows the source, and prints a step change short enough to fit its disc', async ({ page }) => {
  await page.goto('/?source=SYNTHETIC')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })

  await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(40)
  await expect(grid.locator('[data-kind="grid-cell"][data-state="out"]')).toHaveCount(8)
  await expect(grid).toContainText('seeded simulator')
  await expect(grid.getByRole('link', { name: 'Lot 901, wafer 7: out of range, how unusual 98K' })).toHaveText('98K')
  await expect(grid.locator('.map-key')).toContainText('Not run: Lots 1 to 10 ran 3 wafers each.')
})

test('tells the states apart by shape as well as color: a ring, a solid disc with its score, a dashed ring', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  const answer = publicRuns()
  const runs = answer.runs.map((run) => (run.id === 54 ? { ...run, ...UNSCORED } : run))
  await page.route(isPublicRuns, (route) => route.fulfill({ json: { ...answer, runs } }))
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })
  const mark = (state: string) => grid.locator(`[data-state="${state}"] .disc-mark`).first()

  await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(96)
  await expect(mark('in')).toHaveCSS('border-top-style', 'solid')
  await expect(mark('in')).toHaveCSS('border-top-color', 'rgb(143, 133, 114)')
  await expect(mark('in')).toHaveCSS('background-color', 'rgb(245, 239, 226)')
  await expect(mark('in')).toHaveCSS('border-radius', '50%')
  await expect(mark('out')).toHaveCSS('background-color', 'rgb(196, 22, 12)')
  await expect(mark('out')).not.toHaveText('')
  await expect(mark('unscored')).toHaveCSS('border-top-style', 'dashed')
  // a lot's row is not a table row to hover: pointing at lot 7's empty slots fills nothing in
  const row = grid.getByRole('row', { name: /^Lot 7/ })
  await row.locator('[data-kind="not-run"]').hover()
  await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})

test('keys the map with what it holds and nothing else, and brackets the baseline once', async ({ page }) => {
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })
  const key = grid.locator('.map-key')

  // the public wafers: in range, out of range, the baseline in wafers 1 to 3, and lot 7's missing slots
  await expect(key.locator('li')).toHaveCount(4)
  await expect(key).toContainText('In range')
  await expect(key).toContainText('Out of range, with its how-unusual score. The limit is 6.0.')
  await expect(key).toContainText('Baseline: wafers 1 to 3, the 30 good runs behind every score.')
  await expect(key).toContainText('Not run: Lot 7 ran 6 wafers.')
  await expect(key).not.toContainText('Not scored')
  await expect(grid.locator('.bracket')).toHaveText('Baseline')
  await expect(grid.locator('tbody .map-gap')).toHaveCount(10)
  await expect(grid.locator('.disc.baseline')).toHaveCount(0)

  // one whole lot with every wafer in range: no red to explain and no missing slot
  const answer = publicRuns()
  await page.route(isPublicRuns, (route) => route.fulfill({ json: { ...answer, runs: answer.runs.filter((run) => run.lotNo === 1) } }))
  await page.reload()
  await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(10)
  await expect(key).toContainText('In range')
  await expect(key).not.toContainText('Out of range')
  await expect(key).not.toContainText('Not run')
})

test('marks each baseline disc with a dot when a relabel moves the baseline off the first wafers', async ({ page }) => {
  const answer = publicRuns()
  // wafer 5 of lot 2 relabeled good: lot 2's baseline is no longer its first three wafers
  const runs = answer.runs.map((run) => (run.id === 15 ? { ...run, good: true } : run))
  await page.route(isPublicRuns, (route) => route.fulfill({ json: { ...answer, runs } }))
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })

  await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(96)
  await expect(grid.locator('.bracket')).toHaveCount(0)
  await expect(grid.locator('tbody .map-gap')).toHaveCount(0)
  await expect(grid.locator('[data-kind="grid-cell"].baseline')).toHaveCount(31)
  await expect(grid.getByRole('link', { name: 'Lot 2, wafer 5: in range, how unusual 3.9, baseline run' })).toHaveClass(/baseline/)
  await expect(grid.locator('.map-key')).toContainText('Baseline run: one of the 31 good runs behind every score.')
})

test('marks a wafer that was not scored or not aligned', async ({ page }) => {
  const answer = publicRuns()
  const runs = answer.runs.map((run) => (run.id === 54 ? { ...run, ...UNSCORED } : run.id === 60 ? { ...run, ...UNSCORED, alignment: 'FAILED' } : run))
  await page.route(isPublicRuns, (route) => route.fulfill({ json: { ...answer, runs } }))
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })

  await expect(grid.locator('table .disc.unscored, table .disc.failed')).toHaveCount(2)
  await expect(grid.locator('.disc.failed .disc-mark')).toHaveCSS('border-top-style', 'dashed')
  await expect(grid.getByRole('link', { name: 'Lot 6, wafer 4: not scored' })).toHaveAttribute('href', '/runs/54')
  await expect(grid.getByRole('link', { name: 'Lot 6, wafer 10: not aligned' })).toHaveAttribute('href', '/runs/60')
  await expect(grid.getByRole('row', { name: /^Lot 6/ }).locator('td.map-out')).toHaveText('5')
  await expect(grid.locator('.map-key')).toContainText('Not scored or not aligned')
})

test('keys the map and the ledger without a limit when there is no baseline', async ({ page }) => {
  const answer = publicRuns()
  await page.route(isPublicRuns, (route) => route.fulfill({ json: { ...answer, baseline: null } }))
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })

  await expect(grid.locator('[data-kind="grid-cell"][data-state="out"]')).toHaveCount(15)
  await expect(grid.locator('.map-key')).toContainText('Out of range, with its how-unusual score.')
  await expect(grid.locator('.map-key')).not.toContainText('limit')
  const ledger = page.getByRole('region', { name: 'Out-of-range runs, by lot' })
  await expect(ledger.locator('.figure-answer')).toHaveText('The highest score is 24.9, Lot 6 wafer 6. Each line runs from 0 to 25.')
  await expect(ledger.locator('.sl-limit')).toHaveCount(0)
  await expect(page.getByText('The words this page uses')).toHaveCount(0)
})

// the placeholder is sized to the public wafers at both layouts: the map beside its key, and the key under the map
for (const width of [1280, 375]) {
  test(`holds the map's place at ${width}px while a new source loads, without showing the old source's wafers`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route((url) => url.pathname === '/api/runs' && url.searchParams.get('source') === 'SYNTHETIC', async (route) => {
      await held
      await route.fallback()
    })
    await page.goto('/')
    const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })
    await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(96)
    await page.evaluate(() => document.fonts.ready)
    const loaded = await grid.boundingBox()

    const simulated = page.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Simulated' })
    await simulated.click()
    const skeleton = page.locator('.lot-grid[aria-busy="true"]')
    await expect(skeleton).toBeVisible()
    // the public wafers never stand in for the simulated ones
    await expect(page.locator('[data-kind="grid-cell"]')).toHaveCount(0)
    await expect(skeleton).toContainText('seeded simulator')
    // the Source switch is part of the figure's head and stays put, pressed and focused, while the map loads
    await expect(simulated).toHaveAttribute('aria-pressed', 'true')
    await expect(simulated).toBeFocused()
    const holding = await skeleton.boundingBox()
    expect(Math.abs((holding?.height ?? 0) - (loaded?.height ?? 0))).toBeLessThanOrEqual(1)

    release()
    await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(40)
    await expect(grid).toHaveAttribute('aria-busy', 'false')
  })
}

test('takes one tab stop for the map and moves between wafers with the arrow keys', async ({ page }) => {
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })
  await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(96)
  // every link stays in the table for a screen reader; only one is in the tab order
  await expect(grid.locator('table a[tabindex="0"]')).toHaveCount(1)
  await expect(grid.locator('table a[tabindex="-1"]')).toHaveCount(105)

  await grid.getByRole('link', { name: 'Lot 1', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(grid.getByRole('link', { name: /^Lot 1, wafer 1:/ })).toBeFocused()
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press('ArrowDown')
  }
  await page.keyboard.press('End')
  await expect(grid.getByRole('link', { name: /^Lot 6, wafer 10:/ })).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  // lot 7 ran six wafers, so down from wafer 8 skips to lot 8
  await page.keyboard.press('ArrowDown')
  await expect(grid.getByRole('link', { name: /^Lot 8, wafer 8:/ })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('tab', { name: /Needs a look/ })).toBeFocused()
  // coming back, the map remembers the wafer it was left on
  await page.keyboard.press('Shift+Tab')
  await expect(grid.getByRole('link', { name: /^Lot 8, wafer 8:/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/runs\/\d+$/)
})

test('rings a focused disc so it shows, on the paper and on the ink masthead', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })
  await grid.getByRole('link', { name: 'Lot 1', exact: true }).focus()
  await page.keyboard.press('ArrowRight')

  const mark = grid.getByRole('link', { name: /^Lot 1, wafer 1:/ }).locator('.disc-mark')
  await expect(mark).toHaveCSS('outline-style', 'solid')
  await expect(mark).toHaveCSS('outline-color', 'rgb(31, 78, 156)')
  // on the ink band a paper-colored ring keeps its contrast
  await page.getByRole('link', { name: 'ChamberWatch' }).focus()
  await page.keyboard.press('Tab')
  const runs = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Runs' })
  await expect(runs).toBeFocused()
  await expect(runs).toHaveCSS('outline-color', 'rgb(245, 239, 226)')
})

test('marks the page in view in the masthead by weight and aria-current, on the runs page and on a run', async ({ page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Main' })
  const runs = nav.getByRole('link', { name: 'Runs' })

  await expect(runs).toHaveAttribute('aria-current', 'page')
  await expect(runs).toHaveCSS('font-weight', '600')
  await page.goto('/runs/55')
  await expect(runs).toHaveAttribute('aria-current', 'page')
  await page.goto('/lots')
  await expect(runs).not.toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Lots' })).toHaveAttribute('aria-current', 'page')
})

for (const width of [320, 375, 700]) {
  test(`fits the map on a ${width}px page with discs still big enough to tap`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })
    await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(96)

    // the page itself never scrolls sideways, and the map starts on the page's gutter like its figure
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    const figure = await grid.boundingBox()
    const firstLot = await grid.getByRole('link', { name: 'Lot 1', exact: true }).boundingBox()
    expect(Math.abs((figure?.x ?? 0) - (firstLot?.x ?? -1))).toBeLessThan(1)
    const sizes = await grid.locator('[data-kind="grid-cell"]').evaluateAll((cells) => cells.map((cell) => {
      const box = cell.getBoundingClientRect()
      return Math.min(box.width, box.height)
    }))
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(24)
    const overflow = await grid.locator('.map-scroll').evaluate((wrap) => wrap.scrollWidth - wrap.clientWidth)
    // ten positions fit from 375px up; on the narrowest phones the map scrolls inside its own frame rather than shrink
    if (width >= 375) {
      expect(overflow).toBe(0)
    }
    else {
      expect(overflow).toBeGreaterThan(0)
    }
    if (width < 640) {
      // too small to print a score in: it stays in the disc's name
      await expect(grid.getByRole('link', { name: 'Lot 6, wafer 5: out of range, how unusual 18.8' }).locator('.disc-text')).toBeHidden()
    }
  })
}

for (const width of [320, 375]) {
  test(`folds the out-of-range ledger into lines on a ${width}px page, with nothing past the edge`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    const ledger = page.getByRole('region', { name: 'Out-of-range runs, by lot' })
    await expect(ledger.locator('.ledger-run')).toHaveCount(15)

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    expect(await ledger.locator('.ledger-scroll').evaluate((wrap) => wrap.scrollWidth - wrap.clientWidth)).toBe(0)
    // the time line is too small here, so the time reads as words under the channel
    const at = ledger.locator('.ledger-run').first().locator('.c-at')
    await expect(at.locator('.time-line')).toBeHidden()
    await expect(at).toHaveText('537.0 s')
    expect(await at.evaluate((cell) => getComputedStyle(cell, '::before').content)).toBe('"Left at "')
  })
}

test('scrolls a long lot inside the map rather than shrink its discs', async ({ page }) => {
  const answer = publicRuns()
  const first = answer.runs[0]
  const long = Array.from({ length: 25 }, (_, index) => ({ ...first, id: 9000 + index, key: `LONG-W${index + 1}`, positionInLot: index + 1 }))
  await page.route(isPublicRuns, (route) => route.fulfill({ json: { ...answer, runs: long } }))
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })

  await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(25)
  const widths = await grid.locator('[data-kind="grid-cell"]').evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width))
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(24)
  expect(await grid.locator('.map-scroll').evaluate((wrap) => wrap.scrollWidth - wrap.clientWidth)).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
})

test('clusters each first channel\'s runs by lot, each disc a link to its run', async ({ page }) => {
  await page.goto('/')
  const figure = page.getByRole('region', { name: 'Which channel left its range first' })
  const load = figure.getByRole('region', { name: 'Platen RF load cap' })

  await expect(load.getByRole('heading', { level: 3 })).toHaveText('Platen RF load cap 10 of 15')
  await expect(load.locator('.disc')).toHaveCount(10)
  await expect(load.locator('.cluster-lot')).toHaveText(['Lot 6', 'Lot 7', 'Lot 8', 'Lot 9'])
  await expect(figure.getByRole('region', { name: 'Platen RF tuning cap' }).locator('.disc')).toHaveText(['8', '9', '10', '9', '10'])
  await expect(load.getByRole('link', { name: 'Lot 6, wafer 5: out of range, how unusual 18.8' })).toHaveAttribute('href', '/runs/55')
})

test('puts every out-of-range run on one score scale and one time scale', async ({ page }) => {
  await page.goto('/')
  const ledger = page.getByRole('region', { name: 'Out-of-range runs, by lot' })

  await expect(ledger.locator('.figure-answer')).toHaveText('The highest score is 24.9, Lot 6 wafer 6. Each line runs from 0 to 25; the tick is the limit, 6.0.')
  await expect(ledger.getByRole('columnheader', { name: /Left at/ })).toContainText('0 to 600 s')
  const lot6 = ledger.locator('#lot-6 ~ tr')
  await expect(lot6.first()).toContainText('Wafer 4')
  await expect(lot6.first()).toContainText('537.0 s')
  await expect(lot6.nth(2)).toContainText('Stuck sensor')
  // lot 6's wafers left earlier and earlier: wafer 4 at 537 s sits right of wafer 10 at 193 s
  const left = (index: number) => lot6.nth(index).locator('.time-tick').evaluate((tick) => tick.getBoundingClientRect().x)
  expect(await left(0)).toBeGreaterThan(await left(6))
  // the limit's tick sits in the same place on every line
  const limits = await ledger.locator('.sl-limit').evaluateAll((ticks) => ticks.map((tick) => Math.round(tick.getBoundingClientRect().x)))
  expect(limits).toHaveLength(15)
  expect(new Set(limits).size).toBe(1)
})

test('opens a link to one lot on its rows in the ledger', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/#lot-9')
  const row = page.locator('#lot-9')

  await expect(row).toContainText('Lot 9')
  await expect(row).toBeInViewport()
})

test('brings the lot drift onto the page and says which lots have no drift data', async ({ page }) => {
  await page.goto('/')
  const drift = page.getByRole('region', { name: 'Drift along the lots' })

  // the captured responses hold the drift of lot 6 only; every other lot answers 404
  await expect(drift).toContainText('Platen RF tuning capoutside the band in lot 6')
  await expect(drift).toContainText('No drift dataLots 1 to 5 and 7 to 10')
  await expect(drift).toHaveAttribute('aria-busy', 'false')
  await expect(drift.locator('.figure-answer')).toHaveText('4 channels are outside the band or heading out, by each lot\'s last wafer.')
  await expect(drift.getByRole('link', { name: 'All lots' })).toHaveAttribute('href', '/lots')
})

test('keeps the page\'s words in a closed disclosure', async ({ page }) => {
  await page.goto('/')
  const words = page.locator('details.words-how')

  await expect(words).not.toHaveAttribute('open')
  await expect(page.getByText('The channel that left the good-run range earliest')).toBeHidden()
  await words.getByText('The words this page uses').click()
  await expect(page.getByText('The channel that left the good-run range earliest')).toBeVisible()
})

test('lists every public wafer in the table and narrows to the ones in range', async ({ page }) => {
  await page.goto('/')
  const rows = page.locator('table.runs-table tbody tr')

  await page.getByRole('tab', { name: /All runs/ }).click()
  await expect(rows).toHaveCount(96)
  await expect(page).toHaveURL(/show=all/)
  // a disc and a word for each run's state, and its score on one line from 0 to 25
  await expect(page.locator('table.runs-table .disc.out')).toHaveCount(15)
  await expect(rows.first()).toContainText('Out of range')
  await expect(page.getByRole('columnheader', { name: /How unusual/ })).toContainText('0 to 25, limit 6.0')

  await page.getByRole('tab', { name: /In range/ }).click()
  await expect(rows).toHaveCount(81)
  await expect(page).toHaveURL(/show=in/)
})

test('filters to one lot', async ({ page }) => {
  await page.goto('/?show=all')
  await page.getByRole('combobox', { name: 'Lot' }).selectOption('6')

  await expect(page.locator('table.runs-table tbody tr')).toHaveCount(10)
  await expect(page).toHaveURL(/lot=6/)
})

test('orders the runs by persistent z and opens one', async ({ page }) => {
  await page.goto('/?show=all&order=z')

  await expect(page.locator('table.runs-table tbody tr').first()).toContainText('Day_2024_08_01_Wafer_06')
  await page.getByRole('link', { name: 'Lot 6 · Wafer 5' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Day_2024_08_01_Wafer_05')
})

test('a link from before the tabs still opens the table', async ({ page }) => {
  await page.goto('/?flagged=true&order=z')

  await expect(page.getByRole('tab', { name: /All runs/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('table.runs-table tbody tr').first()).toContainText('Day_2024_08_01_Wafer_06')
})

test('switches to the simulated lots and opens a wafer with a known fault', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Simulated' }).click()

  await expect(page).toHaveURL(/source=SYNTHETIC/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('8 of 40 runs are out of range, all in lots 6, 7 and 901.')
  await expect(page.locator('.answer-next')).toHaveText('Start with Lot 901: wafers 5 to 7, 9 and 10 of 10 are out.')
  await expect(page.getByRole('region', { name: 'Which channel left its range first' }).locator('.figure-answer'))
    .toContainText('Helium backside pressure in 2 and 3 other channels in 1 each.')
  // a step change of 97,795 would flatten every other line, so the lines stop at ten limits and say so
  await expect(page.getByRole('region', { name: 'Out-of-range runs, by lot' }).locator('.figure-answer'))
    .toHaveText('The highest score is 97,795.1, Lot 901 wafer 7. Each line runs from 0 to 60; the tick is the limit, 6.0, and 2 scores run past its end.')

  await page.getByRole('tab', { name: /All runs/ }).click()
  const rows = page.locator('table.runs-table tbody tr')
  await expect(rows).toHaveCount(40)
  await expect(page.getByRole('combobox', { name: 'Lot' }).locator('option')).toHaveCount(12)
  await page.getByRole('combobox', { name: 'Lot' }).selectOption({ label: 'Lot 901, 5 out of range' })

  await expect(rows).toHaveCount(10)
  await page.getByRole('link', { name: 'Lot 901 · Wafer 7' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SIM-s7-L901-W07')
  await expect(page.locator('.breadcrumb').getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/?source=SYNTHETIC')
  await expect(page.getByRole('link', { name: 'Measured depth' })).toHaveCount(0)
})

test('says when the runs did not load, and loads them again', async ({ page }) => {
  let fail = true
  await page.route((url) => url.pathname === '/api/runs' && !url.searchParams.has('source'), async (route) => {
    if (fail) {
      fail = false
      await route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Service Unavailable', detail: 'the database is starting' }) })
    }
    else {
      await route.fallback()
    }
  })
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The runs did not load.')
  await expect(page.getByRole('alert')).toContainText('Could not load the runs')
  await expect(page.getByRole('alert')).toContainText('the database is starting')
  // the Source switch stays, so another source can still be picked
  await expect(page.getByRole('group', { name: 'Source' })).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(0)
  await page.getByRole('button', { name: 'Try again' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('15 of 96 runs are out of range, all in lots 6 to 9.')
})

test('says when a source has no runs yet', async ({ page }) => {
  await page.route((url) => url.pathname === '/api/runs' && url.searchParams.get('source') === 'LIVE', (route) => route.fulfill({ json: { baseline: null, runs: [] } }))
  await page.goto('/?source=LIVE')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No runs stored for this source yet.')
  await expect(page.getByRole('status').filter({ hasText: 'Nothing to check' })).toContainText('Open the Live page')
  await expect(page.locator('.figure.numbered')).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Live' })).toHaveAttribute('aria-pressed', 'true')
})

test('switches between light and dark and keeps the choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible()
})
