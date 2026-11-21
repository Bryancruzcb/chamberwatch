import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'

test('maps the 89 measured sites of a wafer and switches to the 9-point set', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55/wafer')
  const panel = page.getByRole('region', { name: 'Etch depth across the wafer' })

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Measured depth')
  await expect(page.getByRole('img', { name: /^Etch depth at 89 sites/ }).locator('[data-kind="site"]')).toHaveCount(89)
  await expect(panel.locator('.panel-answer')).toHaveText(
    '43.69 µm deep on average across 89 sites. Sites near the edge etched 6.45 µm deeper than sites near the center.',
  )
  await expect(panel.locator('.wafer-facts')).toContainText('Mean43.69 µm')
  await expect(panel.locator('.wafer-facts')).toContainText('Range11.57 µm')

  await page.getByRole('group', { name: 'Measurement set' }).getByRole('button', { name: '9-point', exact: true }).click()

  await expect(page).toHaveURL(/set=NINE_POINT/)
  await expect(page.getByRole('img', { name: /^Etch depth at 9 sites/ }).locator('[data-kind="site"]')).toHaveCount(9)
  // nine sites sit on a center point and two rings of four; the comparison never splits a ring
  await expect(panel.locator('.panel-answer')).toHaveText(
    '40.50 µm deep on average across 9 sites. Sites near the edge etched 0.98 µm deeper than sites near the center.',
  )
  await expect(page.locator('[data-kind="profile-end"]')).toHaveText(['39.16 µm', '42.53 µm'])
})

test('plots each site\'s depth against its distance from the center', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55/wafer')
  const profile = page.getByRole('img', { name: /^Depth of 89 sites by distance from the wafer's center/ })

  await expect(profile.locator('[data-kind="profile-site"]')).toHaveCount(89)
  await expect(profile).toHaveAttribute('aria-label', /from 40\.04 µm to 51\.61 µm\.$/)
})

test('reaches the wafer from its run page', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')
  await page.getByRole('link', { name: 'Measured depth' }).click()

  await expect(page).toHaveURL(/\/runs\/55\/wafer$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Measured depth')
})

test('puts the depth the telemetry predicts next to the measured depth', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55/wafer')
  const panel = page.getByRole('region', { name: 'Predicted from the telemetry' })

  await expect(panel.locator('.panel-answer')).toHaveText(
    'The telemetry predicted 43.64 µm, 0.05 µm shallower than measured. Across lot 6 it typically misses by 0.15 µm.',
  )
  await expect(panel.getByRole('img')).toHaveAttribute('aria-label', 'Predicted 43.64 µm, typically within 0.15 µm; measured 43.69 µm.')
})
