import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'

test('opens a wafer on which of its edge and center etched deeper, then maps its 89 sites and switches to the 9-point set', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55/wafer')
  const panel = page.getByRole('region', { name: 'Etch depth across the wafer' })

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 5 of Lot 6 etched deeper at its edge than at its center.')
  await expect(page).toHaveTitle('Lot 6, wafer 5 depth · ChamberWatch')
  await expect(page.locator('.page-meta .run-key')).toHaveText('Day_2024_08_01_Wafer_05')
  await expect(page.getByRole('img', { name: /^Etch depth at 89 sites/ }).locator('[data-kind="site"]')).toHaveCount(89)
  await expect(panel.locator('.figure-answer')).toHaveText(
    '43.69 µm deep on average across 89 sites. Sites near the edge etched 6.45 µm deeper than sites near the center.',
  )
  await expect(panel.locator('.wafer-facts')).toContainText('Mean43.69 µm')
  await expect(panel.locator('.wafer-facts')).toContainText('Range11.57 µm')

  // the set is chosen in the figure's head, beside the title it changes
  await panel.locator('.figure-control').getByRole('group', { name: 'Measurement set' }).getByRole('button', { name: '9-point', exact: true }).click()

  await expect(page).toHaveURL(/set=NINE_POINT/)
  await expect(page.getByRole('img', { name: /^Etch depth at 9 sites/ }).locator('[data-kind="site"]')).toHaveCount(9)
  // nine sites sit on a center point and two rings of four; the comparison never splits a ring
  await expect(panel.locator('.figure-answer')).toHaveText(
    '40.50 µm deep on average across 9 sites. Sites near the edge etched 0.98 µm deeper than sites near the center.',
  )
  await expect(page.locator('[data-kind="profile-end"]')).toHaveText(['39.16 µm', '42.53 µm'])
})

test('plots each site\'s depth against its distance from the center, on one ink ramp with an edge on its lightest step', async ({ page }) => {
  await serveApi(page)
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/runs/55/wafer')
  const profile = page.getByRole('img', { name: /^Depth of 89 sites by distance from the wafer's center/ })

  await expect(profile.locator('[data-kind="profile-site"]')).toHaveCount(89)
  await expect(profile).toHaveAttribute('aria-label', /from 40\.04 µm to 51\.61 µm\.$/)
  // the shallowest step is pale enough to need an edge against the paper; the deepest is near ink
  await expect(page.locator('[data-kind="site"].seq-1').first()).toHaveCSS('stroke', 'rgb(143, 133, 114)')
  await expect(page.locator('[data-kind="site"].seq-6').first()).toHaveCSS('fill', 'rgb(34, 31, 28)')

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  // in dark mode the ramp flips, so the deepest sites stand out from the dark paper
  await expect(page.locator('[data-kind="site"].seq-6').first()).toHaveCSS('fill', 'rgb(229, 223, 211)')
})

test('reaches the wafer from its run page, and the run from the wafer', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')
  await page.getByRole('link', { name: 'Measured depth' }).click()

  await expect(page).toHaveURL(/\/runs\/55\/wafer$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 5 of Lot 6 etched deeper at its edge than at its center.')
  await page.locator('.page-meta').getByRole('link', { name: 'Its run' }).click()
  await expect(page).toHaveURL(/\/runs\/55$/)
})

test('puts the depth the telemetry predicts next to the measured depth', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55/wafer')
  const panel = page.getByRole('region', { name: 'Predicted from the telemetry' })

  await expect(panel.locator('.figure-answer')).toHaveText(
    'The telemetry predicted 43.64 µm, 0.05 µm shallower than measured. Across lot 6 it typically misses by 0.15 µm.',
  )
  await expect(panel.getByRole('img')).toHaveAttribute('aria-label', 'Predicted 43.64 µm, typically within 0.15 µm; measured 43.69 µm.')
  expect(await page.locator('.figure.numbered h2').allTextContents()).toEqual(['Etch depth across the wafer', 'Predicted from the telemetry'])
})

test('says so when a wafer has no measurements in the set', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/11/wafer')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 1 of Lot 2 has no 89-point measurements.')
  await expect(page.getByRole('region', { name: 'Etch depth across the wafer' })).toContainText('This wafer has no 89-point measurements.')
  await expect(page.locator('[data-kind="site"]')).toHaveCount(0)
})

test('says a wafer the API has never heard of is not there, and why its prediction did not load', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/9999/wafer')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('There is no run 9999.')
  await expect(page).toHaveTitle('Not found · ChamberWatch')
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Back to the runs' })).toHaveAttribute('href', '/')

  // run 11 is public but its depth was not captured: the figure says why and the map still shows
  await page.goto('/runs/11/wafer')
  const predicted = page.getByRole('region', { name: 'Predicted from the telemetry' })
  await expect(predicted.getByRole('alert')).toContainText('no depth for run 11')
})

test('holds the heading and the map\'s place while the measurements load', async ({ page }) => {
  await serveApi(page)
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route((url) => url.pathname === '/api/runs/55/measurements', async (route) => {
    await held
    await route.fallback()
  })
  await page.goto('/runs/55/wafer')

  await expect(page.locator('.page-head .skel-title')).toHaveCount(2)
  await expect(page.locator('.skel-wafer')).toBeVisible()
  release()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 5 of Lot 6 etched deeper at its edge than at its center.')
})

for (const width of [320, 375]) {
  test(`fits the wafer on a ${width}px phone without sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await serveApi(page)
    await page.goto('/runs/55/wafer')

    await expect(page.locator('[data-kind="site"]')).toHaveCount(89)
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  })
}

test('says why a wafer that exists did not load, with a way to ask again under a heading', async ({ page }) => {
  await serveApi(page)
  await page.route((url) => url.pathname === '/api/runs/55', (route) => route.fulfill({
    status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Service Unavailable', detail: 'the database is starting' }),
  }))
  await page.goto('/runs/55/wafer')

  await expect(page.locator('.state-title')).toHaveText('This wafer did not load')
  await expect(page.getByRole('alert')).toContainText('the database is starting')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Measured depth')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('heads the page with the wafer plainly when its measurements fail, with no placeholder waiting', async ({ page }) => {
  await serveApi(page)
  await page.route((url) => url.pathname === '/api/runs/55/measurements', (route) => route.fulfill({
    status: 500, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Internal Server Error', detail: 'boom' }),
  }))
  await page.goto('/runs/55/wafer')

  await expect(page.getByRole('region', { name: 'Etch depth across the wafer' }).getByRole('alert')).toContainText('boom')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wafer 5 of Lot 6')
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveClass(/visually-hidden/)
  await expect(page.locator('.page-head .skel')).toHaveCount(0)
})

test('gives no prediction answer while the next set\'s prediction loads, and dims its strip', async ({ page }) => {
  await serveApi(page)
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route((url) => url.pathname === '/api/runs/55/depth' && url.searchParams.get('set') === 'NINE_POINT', async (route) => {
    await held
    await route.fallback()
  })
  await page.goto('/runs/55/wafer')
  const predicted = page.getByRole('region', { name: 'Predicted from the telemetry' })
  await expect(predicted.locator('.figure-answer')).toContainText('43.64')

  await page.getByRole('group', { name: 'Measurement set' }).getByRole('button', { name: '9-point', exact: true }).click()
  await expect(predicted.locator('.figure-answer')).toHaveCount(0)
  await expect(predicted.locator('.figure-body.refreshing')).toHaveCount(1)
  await expect(predicted).toHaveAttribute('aria-busy', 'true')
  release()
  await expect(predicted.locator('.figure-body.refreshing')).toHaveCount(0)
})
