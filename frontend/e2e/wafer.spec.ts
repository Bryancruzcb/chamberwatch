import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'
import { stat } from './locators.ts'

test('maps the 89 measured sites of a wafer and switches to the 9-point set', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55/wafer')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Measured depth')
  await expect(page.getByRole('img', { name: /^Etch depth at 89 sites/ }).locator('[data-kind="site"]')).toHaveCount(89)
  await expect(stat(page, 'Mean depth')).toHaveText('43.69 µm')

  await page.getByRole('group', { name: 'Measurement set' }).getByRole('button', { name: '9-point', exact: true }).click()

  await expect(page).toHaveURL(/set=NINE_POINT/)
  await expect(page.getByRole('img', { name: /^Etch depth at 9 sites/ }).locator('[data-kind="site"]')).toHaveCount(9)
})

test('reaches the wafer from its run page', async ({ page }) => {
  await serveApi(page)
  await page.goto('/runs/55')
  await page.getByRole('link', { name: 'Measured depth' }).click()

  await expect(page).toHaveURL(/\/runs\/55\/wafer$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Measured depth')
})
