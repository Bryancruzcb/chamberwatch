import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'

test('lists the lots next to drift and depth by wafer position', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lots')
  await expect(page.locator('table.lots tbody tr')).toHaveCount(10)
  await expect(page.getByRole('img', { name: /^Mean drift score by wafer position/ }).locator('[data-kind="dot"]')).toHaveCount(10)
  await expect(page.getByRole('img', { name: /^Depth loss by wafer position/ }).locator('[data-kind="dot"]')).toHaveCount(20)
})

test('opens a lot on its answer: which wafers are out of range, and how its channels end', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots/6')

  await expect(page.locator('.page-head .answer-next')).toHaveText(
    '7 of 10 wafers are out of range: wafers 4 to 10. By the last wafer, the SF6 mean of 4 channels is outside the band, and none is heading out.',
  )
  await expect(page.getByRole('img', { name: /^How unusual each wafer of Lot 6 was/ }).locator('[data-kind="dot"]')).toHaveCount(10)
  const verdicts = page.getByRole('region', { name: "Each channel's SF6 mean by the last wafer" })
  await expect(verdicts.locator('.share-key li')).toHaveText([/Out of band\s*4 channels/, /Stays in the band\s*10 channels/, /No trend\s*17 channels/])
  await expect(verdicts.getByRole('img')).toHaveAttribute('aria-label', 'Out of band: 4, Stays in the band: 10, No trend: 17')
  await expect(page.getByRole('link', { name: 'Show them in the runs table' })).toHaveAttribute('href', '/?lot=6')
})

test('says why when a lot\'s runs do not load, and leaves no placeholder waiting in the header', async ({ page }) => {
  await serveApi(page)
  await page.route((url) => url.pathname === '/api/runs' && url.searchParams.get('lot') === '6', (route) => route.fulfill({
    status: 503,
    contentType: 'application/problem+json',
    body: JSON.stringify({ title: 'Service Unavailable', detail: 'the database is starting' }),
  }))
  await page.goto('/lots/6')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lot 6')
  await expect(page.getByRole('alert')).toContainText('the database is starting')
  await expect(page.locator('.page-head .answer-next')).toHaveCount(0)
  await expect(page.locator('.page-head .skel')).toHaveCount(0)
})

test('keeps the answer and the heading on the phase its counts were made for while another phase loads', async ({ page }) => {
  await serveApi(page)
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route((url) => url.pathname === '/api/lots/6/drift' && url.searchParams.get('phase') === 'C4F8', async (route) => {
    await held
    await route.fallback()
  })
  await page.goto('/lots/6')
  await page.getByRole('group', { name: 'Phase' }).getByRole('button', { name: 'C4F8' }).click()

  // the C4F8 answer is on its way: the control shows the click, the numbers still say what they count
  await expect(page.getByRole('group', { name: 'Phase' }).getByRole('button', { name: 'C4F8' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: "Each channel's SF6 mean by the last wafer" })).toBeVisible()
  await expect(page.locator('.page-head .answer-next')).toContainText('the SF6 mean of 4 channels')

  release()
  await expect(page.getByRole('region', { name: "Each channel's C4F8 mean by the last wafer" })).toBeVisible()
  await expect(page.locator('.page-head .answer-next')).toContainText('C4F8 mean')
})

test('opens a lot on the channel that left the band', async ({ page }) => {
  const api = await serveApi(page)
  await page.goto('/lots')
  await page.getByRole('link', { name: 'Lot 6', exact: true }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lot 6')
  await expect(page.getByRole('heading', { level: 2, name: 'Platen RF tuning cap' })).toBeVisible()
  await expect(page.locator('.panel-head .badge-critical')).toHaveText('Out of band')
  const chart = page.getByRole('img', { name: /^SF6 phase mean of Platen RF tuning cap by wafer position/ })
  await expect(chart.locator('[data-kind="dot"]')).toHaveCount(10)

  await page.getByRole('group', { name: 'Phase' }).getByRole('button', { name: 'C4F8' }).click()

  await expect(page).toHaveURL(/phase=C4F8/)
  await expect.poll(() => api.requests.some((path) => path.startsWith('/api/lots/6/drift') && path.includes('phase=C4F8'))).toBe(true)

  await page.getByRole('group', { name: 'Reference' }).getByRole('button', { name: "This lot's first wafers" }).click()

  await expect(page).toHaveURL(/reference=LOT/)
  await expect.poll(() => api.requests.some((path) => path.startsWith('/api/lots/6/drift') && path.includes('reference=LOT'))).toBe(true)
  await expect(page.getByText("This lot's first 3 wafers ± 3.0 sd of the good runs")).toBeVisible()
})

test('switches to the simulated lots, which drift but have no measured depth', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots')
  await page.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Simulated' }).click()

  await expect(page).toHaveURL(/source=SYNTHETIC/)
  await expect(page.locator('table.lots tbody tr')).toHaveCount(11)
  await expect(page.getByRole('img', { name: /^Mean drift score by wafer position/ }).locator('[data-kind="dot"]')).toHaveCount(10)
  await expect(page.getByRole('img', { name: /^Depth loss by wafer position/ })).toHaveCount(0)
  await expect(page.getByText('Simulated wafers have no measured depth')).toBeVisible()
  // the out-of-range count opens the lot's card on the runs page
  await expect(page.getByRole('link', { name: '5', exact: true })).toHaveAttribute('href', '/?source=SYNTHETIC#lot-21')
  await page.getByRole('link', { name: 'Lot 901', exact: true }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lot 901')
  await expect(page.locator('.breadcrumb').getByRole('link', { name: 'Lots' })).toHaveAttribute('href', '/lots?source=SYNTHETIC')
  await expect(page.getByRole('link', { name: 'Show them in the runs table' })).toHaveAttribute('href', /^\/\?lot=\d+&source=SYNTHETIC$/)
})

test('compares the depth predicted from the telemetry with two simpler guesses', async ({ page }) => {
  await serveApi(page)
  await page.goto('/lots')
  const panel = page.getByRole('region', { name: 'Depth predicted from the telemetry' })
  const table = panel.getByRole('table', { name: 'Error of each way to guess a wafer\'s depth' })

  await expect(table.getByRole('row', { name: /Telemetry model/ })).toContainText('0.16 µm')
  await expect(table.getByRole('row', { name: /Position in the lot/ })).toContainText('0.22 µm')
  await expect(table.getByRole('row', { name: /first wafers/ })).toContainText('0.71 µm')
  await expect(panel).toContainText('Foreline pressure, C4F8 spread')
  await expect(panel.locator('.panel-answer')).toHaveText(
    'After each lot\'s first wafers, the telemetry misses a wafer\'s depth by 0.16 µm, against 0.21 µm for a guess from its place in the lot and 0.71 µm from the lot\'s first wafers.',
  )
  await expect(page.getByRole('region', { name: 'Drift and depth by wafer position' }).locator('.panel-answer'))
    .toHaveText('By wafer 10, wafers etch 0.90 µm shallower than the first 3 of their lot, on average.')

  await page.goto('/lots?source=SYNTHETIC')
  await expect(page.getByRole('heading', { level: 2, name: 'Drift and depth by wafer position' })).toBeVisible()
  await expect(page.locator('.panel-answer')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Depth predicted from the telemetry' })).toHaveCount(0)
})
