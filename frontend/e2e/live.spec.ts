import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'
import { stat } from './locators.ts'

test('watches a wafer being etched and links to the run it stored', async ({ page }) => {
  await serveApi(page)
  await page.goto('/live')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Live chamber')
  await expect(page.getByRole('heading', { level: 2, name: 'Nothing is being etched' })).toBeVisible()

  await page.getByRole('button', { name: /Record from/ }).click()

  await expect(page.getByRole('heading', { level: 2, name: 'Etching now' })).toBeVisible()
  await expect(stat(page, 'Wafer')).toHaveText('LIVE-s7-L1-W01')
  await expect(stat(page, 'Step')).toHaveText('ETCH_SF6')

  // the page polls while it streams, and the stand-in answers with the finished run next
  await expect(page.getByRole('heading', { level: 2, name: 'The last wafer it recorded' })).toBeVisible()
  await expect(stat(page, 'Fault put in')).toHaveText('Gas flow stuck low')
  await expect(stat(page, 'Alignment')).toHaveText('ALIGNED')
  await expect(page.getByRole('link', { name: 'open its page' })).toHaveAttribute('href', '/runs/4242')
})

test('a read-only ChamberWatch says it does not record live runs', async ({ page }) => {
  await serveApi(page, { readOnly: true })
  await page.goto('/live')

  await expect(page.getByText('This ChamberWatch is read-only, so it does not record live runs.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Record from/ })).toHaveCount(0)
})

test('the live page is reachable from every page', async ({ page }) => {
  await serveApi(page)
  await page.goto('/')

  await page.getByRole('link', { name: 'Live', exact: true }).click()

  await expect(page).toHaveURL(/\/live$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Live chamber')
})
