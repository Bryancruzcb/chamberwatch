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

test('opens on the answer: which runs are out of range, where to start and which channel left first', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('15 of 96 runs are out of range, all in lots 6 to 9.')
  await expect(page.locator('.answer-next')).toHaveText(
    'Start with Lot 6, which has the most out-of-range runs: wafers 4 to 10 of 10. '
    + 'First channel to leave its range: Platen RF load cap in 10 of the 15 runs and Platen RF tuning cap in 5.',
  )
  await expect(page.getByRole('tab', { name: /Needs a look/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { level: 2, name: /^Lot \d/ })).toHaveText([
    'Lot 6 7 of 10 wafers out of range',
    'Lot 9 4 of 10 wafers out of range',
    'Lot 7 3 of 6 wafers out of range',
    'Lot 8 1 of 10 wafers out of range',
  ])
  await expect(page.getByRole('list', { name: 'Out-of-range wafers in Lot 6' }).getByRole('listitem')).toHaveCount(7)
  await expect(page.getByRole('img', { name: /^How unusual each wafer of Lot 6 was/ }).locator('[data-kind="dot"]')).toHaveCount(10)
})

test('shows every wafer in a grid of lots by position, and opens one', async ({ page }) => {
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })

  await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(96)
  await expect(grid.locator('[data-kind="grid-cell"][data-state="out"]')).toHaveCount(15)
  await expect(grid.getByRole('row', { name: /^Lot 6/ }).locator('[data-state="out"]')).toHaveCount(7)
  await expect(grid.getByRole('row', { name: /^Lot 7/ }).locator('.cell-empty')).toHaveCount(4)
  await expect(grid.getByRole('link', { name: 'Lot 6, wafer 5: out of range, how unusual 18.8' })).toHaveAttribute('href', '/runs/55')
  await expect(grid.getByRole('link', { name: 'Lot 2, wafer 1: in range, how unusual 5.5, baseline run' })).toBeVisible()
  await expect(grid).toContainText('Source: Zenodo record 17122442')

  await expect(grid.getByRole('link', { name: /^Lot 9, wafer 10: out of range/ })).toHaveAttribute('href', '/runs/86')

  // run 55 is the flagged wafer the captured responses hold a page for
  await grid.getByRole('link', { name: /^Lot 6, wafer 5:/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Day_2024_08_01_Wafer_05')
})

test('the grid follows the source', async ({ page }) => {
  await page.goto('/?source=SYNTHETIC')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })

  await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(40)
  await expect(grid.locator('[data-kind="grid-cell"][data-state="out"]')).toHaveCount(8)
  await expect(grid).toContainText('seeded simulator')
})

test('gives every cell an edge and an out-of-range cell a corner flag, so neither rests on color alone', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })
  const flag = (selector: string) => grid.locator(selector).first().evaluate((el) => getComputedStyle(el, '::before').content)

  await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(96)
  await expect(grid.locator('.cell.in-1').first()).toHaveCSS('border-top-style', 'solid')
  await expect(grid.locator('.cell.in-1').first()).toHaveCSS('border-top-color', 'rgb(148, 139, 120)')
  expect(await flag('[data-state="out"]')).toBe('""')
  expect(await flag('[data-state="in"]')).toBe('none')
  expect(await flag('.grid-key .swatch.out-1')).toBe('""')
  // the ring of a baseline run takes the color that reads on its red: paper on the darkest, ink on the lighter two
  const ring = (shade: string) => page.evaluate((tone) => {
    const probe = document.createElement('a')
    probe.className = `cell ${tone} ring`
    document.querySelector('.grid-table td')?.append(probe)
    const color = getComputedStyle(probe, '::after').borderTopColor
    probe.remove()
    return color
  }, shade)
  expect(await ring('out-3')).toBe('rgb(247, 244, 236)')
  expect(await ring('out-2')).toBe('rgb(28, 26, 22)')
  // a lot's row is not a table row to hover: pointing at one of lot 7's empty positions fills nothing in
  const row = grid.getByRole('row', { name: /^Lot 7/ })
  await row.locator('.cell-empty').first().hover()
  await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})

test('keys the grid with what it holds and nothing else', async ({ page }) => {
  await page.goto('/')
  const key = page.getByRole('region', { name: 'Every wafer, lot by lot' }).locator('.grid-key')

  // the public wafers: three grays, three reds, lot 7's missing positions and the baseline runs
  await expect(key.locator('.swatch')).toHaveCount(8)
  await expect(key).toContainText('in range, stronger closer to the limit of 6.0')
  await expect(key).toContainText('no wafer')
  await expect(key).toContainText('baseline run')
  await expect(key).not.toContainText('not scored')

  // one whole lot with every wafer in range: no red to explain and no missing position
  const answer = publicRuns()
  await page.route(isPublicRuns, (route) => route.fulfill({ json: { ...answer, runs: answer.runs.filter((run) => run.lotNo === 1) } }))
  await page.reload()
  await expect(page.getByRole('region', { name: 'Every wafer, lot by lot' }).locator('[data-kind="grid-cell"]')).toHaveCount(10)
  await expect(key).toContainText('in range')
  await expect(key).not.toContainText('out of range')
  await expect(key).not.toContainText('no wafer')
})

test('marks a wafer that was not scored or not aligned', async ({ page }) => {
  const answer = publicRuns()
  const runs = answer.runs.map((run) => (run.id === 54 ? { ...run, ...UNSCORED } : run.id === 60 ? { ...run, ...UNSCORED, alignment: 'FAILED' } : run))
  await page.route(isPublicRuns, (route) => route.fulfill({ json: { ...answer, runs } }))
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })

  await expect(grid.locator('.cell.none')).toHaveCount(2)
  await expect(grid.locator('.cell.none').first()).toHaveCSS('border-top-style', 'dashed')
  await expect(grid.getByRole('link', { name: 'Lot 6, wafer 4: not scored' })).toHaveAttribute('href', '/runs/54')
  await expect(grid.getByRole('link', { name: 'Lot 6, wafer 10: not aligned' })).toHaveAttribute('href', '/runs/60')
  await expect(grid.getByRole('row', { name: /^Lot 6/ }).locator('td.grid-count')).toHaveText('5')
  await expect(grid.locator('.grid-key')).toContainText('not scored or not aligned')
})

test('keys the grid without a limit when there is no baseline', async ({ page }) => {
  const answer = publicRuns()
  await page.route(isPublicRuns, (route) => route.fulfill({ json: { ...answer, baseline: null } }))
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })

  await expect(grid.locator('[data-kind="grid-cell"][data-state="out"]')).toHaveCount(15)
  // with no limit to measure against, every wafer takes the lightest step of its color
  await expect(grid.locator('.cell.in-2, .cell.in-3, .cell.out-2, .cell.out-3')).toHaveCount(0)
  await expect(grid.locator('.cell.out-1')).toHaveCount(15)
  await expect(grid.locator('.grid-key .swatch')).toHaveCount(4)
  await expect(grid.locator('.grid-key')).toContainText('in range')
  await expect(grid.locator('.grid-key')).not.toContainText('limit of')
})

// the placeholder is sized to the public wafers at both layouts: the grid beside its key, and the key under the grid
for (const width of [1280, 375]) {
  test(`holds the grid's place at ${width}px while a new source loads, without showing the old source's wafers`, async ({ page }) => {
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
    const loaded = await grid.boundingBox()

    await page.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Simulated' }).click()
    const skeleton = page.locator('.lot-grid[aria-hidden="true"]')
    await expect(skeleton).toBeVisible()
    // the public wafers never stand in for the simulated ones
    await expect(page.locator('[data-kind="grid-cell"]')).toHaveCount(0)
    await expect(skeleton).toContainText('seeded simulator')
    const holding = await skeleton.boundingBox()
    expect(Math.abs((holding?.height ?? 0) - (loaded?.height ?? 0))).toBeLessThanOrEqual(1)

    release()
    await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(40)
  })
}

test('takes one tab stop for the grid and moves between wafers with the arrow keys', async ({ page }) => {
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })
  await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(96)
  // every link stays in the table for a screen reader; only one is in the tab order
  await expect(grid.locator('a[tabindex="0"]')).toHaveCount(1)
  await expect(grid.locator('a[tabindex="-1"]')).toHaveCount(105)

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
  // coming back, the grid remembers the wafer it was left on
  await page.keyboard.press('Shift+Tab')
  await expect(grid.getByRole('link', { name: /^Lot 8, wafer 8:/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/runs\/\d+$/)
})

for (const width of [320, 375, 700]) {
  test(`fits the grid on a ${width}px page with cells still big enough to tap`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })
    await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(96)

    // the page itself never scrolls sideways, and the figure starts on the page's gutter like its heading
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    const heading = await grid.getByRole('heading', { level: 2 }).boundingBox()
    const firstLot = await grid.getByRole('link', { name: 'Lot 1', exact: true }).boundingBox()
    expect(Math.abs((heading?.x ?? 0) - (firstLot?.x ?? -1))).toBeLessThan(1)
    const sizes = await grid.locator('[data-kind="grid-cell"]').evaluateAll((cells) => cells.map((cell) => {
      const box = cell.getBoundingClientRect()
      return Math.min(box.width, box.height)
    }))
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(24)
    const overflow = await grid.locator('.table-wrap').evaluate((wrap) => wrap.scrollWidth - wrap.clientWidth)
    // ten positions fit from 375px up; on the narrowest phones the grid scrolls inside its own frame rather than shrink
    if (width >= 375) {
      expect(overflow).toBe(0)
    }
    else {
      expect(overflow).toBeGreaterThan(0)
    }
  })
}

test('scrolls a long lot inside the grid rather than shrink its cells', async ({ page }) => {
  const answer = publicRuns()
  const first = answer.runs[0]
  const long = Array.from({ length: 25 }, (_, index) => ({ ...first, id: 9000 + index, key: `LONG-W${index + 1}`, positionInLot: index + 1 }))
  await page.route(isPublicRuns, (route) => route.fulfill({ json: { ...answer, runs: long } }))
  await page.goto('/')
  const grid = page.getByRole('region', { name: 'Every wafer, lot by lot' })

  await expect(grid.locator('[data-kind="grid-cell"]')).toHaveCount(25)
  const widths = await grid.locator('[data-kind="grid-cell"]').evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width))
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(24)
  expect(await grid.locator('.table-wrap').evaluate((wrap) => wrap.scrollWidth - wrap.clientWidth)).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
})

test('brings the lot drift onto the page and says which lots have no drift data', async ({ page }) => {
  await page.goto('/')
  const drift = page.getByRole('article').filter({ has: page.getByRole('heading', { name: /Drift along the lots/ }) })

  // the captured responses hold the drift of lot 6 only; every other lot answers 404
  await expect(drift).toContainText('Platen RF tuning capoutside the band in lot 6')
  await expect(drift).toContainText('No drift dataLots 1 to 5 and 7 to 10')
  await expect(drift).toHaveAttribute('aria-busy', 'false')
})

test('lists every public wafer in the table and narrows to the ones in range', async ({ page }) => {
  await page.goto('/')
  const rows = page.locator('table.runs-table tbody tr')

  await page.getByRole('tab', { name: /All runs/ }).click()
  await expect(rows).toHaveCount(96)
  await expect(page).toHaveURL(/show=all/)

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
  await expect(page.locator('.answer-next')).toContainText('Start with Lot 901, which has the most out-of-range runs: wafers 5 to 7, 9 and 10 of 10.')
  await expect(page.locator('.answer-next')).toContainText('Helium backside pressure in 2 and 3 other channels in 1 each.')

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
  await expect(page.getByRole('alert')).toContainText('the database is starting')
  await page.getByRole('button', { name: 'Try again' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('15 of 96 runs are out of range, all in lots 6 to 9.')
})

test('says when a source has no runs yet', async ({ page }) => {
  await page.route((url) => url.pathname === '/api/runs' && url.searchParams.get('source') === 'LIVE', (route) => route.fulfill({ json: { baseline: null, runs: [] } }))
  await page.goto('/?source=LIVE')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No runs stored for this source yet.')
  await expect(page.getByRole('status').filter({ hasText: 'Nothing to check' })).toContainText('Open the Live page')
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
