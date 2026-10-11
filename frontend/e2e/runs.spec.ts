import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'

test.beforeEach(async ({ page }) => {
  await serveApi(page)
})

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
  const rows = page.locator('table tbody tr')

  await page.getByRole('tab', { name: /All runs/ }).click()
  await expect(rows).toHaveCount(96)
  await expect(page).toHaveURL(/show=all/)

  await page.getByRole('tab', { name: /In range/ }).click()
  await expect(rows).toHaveCount(81)
  await expect(page).toHaveURL(/show=in/)
})

test('filters to one lot', async ({ page }) => {
  await page.goto('/?show=all')
  await page.getByLabel('Lot').selectOption('6')

  await expect(page.locator('table tbody tr')).toHaveCount(10)
  await expect(page).toHaveURL(/lot=6/)
})

test('orders the runs by persistent z and opens one', async ({ page }) => {
  await page.goto('/?show=all&order=z')

  await expect(page.locator('table tbody tr').first()).toContainText('Day_2024_08_01_Wafer_06')
  await page.getByRole('link', { name: 'Lot 6 · Wafer 5' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Day_2024_08_01_Wafer_05')
})

test('a link from before the tabs still opens the table', async ({ page }) => {
  await page.goto('/?flagged=true&order=z')

  await expect(page.getByRole('tab', { name: /All runs/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('table tbody tr').first()).toContainText('Day_2024_08_01_Wafer_06')
})

test('switches to the simulated lots and opens a wafer with a known fault', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Simulated' }).click()

  await expect(page).toHaveURL(/source=SYNTHETIC/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('8 of 40 runs are out of range, all in lots 6, 7 and 901.')
  await expect(page.locator('.answer-next')).toContainText('Start with Lot 901, which has the most out-of-range runs: wafers 5 to 7, 9 and 10 of 10.')
  await expect(page.locator('.answer-next')).toContainText('Helium backside pressure in 2 and 3 other channels in 1 each.')

  await page.getByRole('tab', { name: /All runs/ }).click()
  const rows = page.locator('table tbody tr')
  await expect(rows).toHaveCount(40)
  await expect(page.getByLabel('Lot').locator('option')).toHaveCount(12)
  await page.getByLabel('Lot').selectOption({ label: 'Lot 901, 5 out of range' })

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
