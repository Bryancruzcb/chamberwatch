import { expect, test } from '@playwright/test'
import { serveApi } from './api.ts'
import { stat } from './locators.ts'

test('watches a wafer being etched and links to the run it stored', async ({ page }) => {
  await serveApi(page)
  await page.goto('/live')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing is being etched.')
  await expect(page.locator('.answer-next')).toHaveText('Start the chamber simulator, then record from it here.')
  await expect(page).toHaveTitle('Live · ChamberWatch')
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeDisabled()
  // with nothing recorded yet, how to start the simulator is the one next step, so it shows
  const how = page.locator('details.live-how')
  await expect(how).toHaveAttribute('open')
  await expect(how).toContainText('chamber-sim --port=5610')
  await expect(page.getByRole('button', { name: 'Plant a fault: cut Gas 5 flow to 36%' })).toBeDisabled()

  await page.getByRole('button', { name: /Record from/ }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('A wafer is being etched now.')
  await expect(page.getByRole('button', { name: /Gas 5 flow to 36%/ })).toBeEnabled()
  await expect(how).not.toHaveAttribute('open')
  await expect(page.locator('.answer-next')).toHaveText('LIVE-s7-L1-W01, at cycle 12 of 100, 128.0 s in.')
  await expect(stat(page, 'Wafer')).toHaveText('LIVE-s7-L1-W01')
  await expect(stat(page, 'Step')).toHaveText('ETCH_SF6')

  // the page polls while it streams, and the stand-in answers with the finished run next
  await expect(page.getByRole('heading', { level: 2, name: 'The last wafer it recorded' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing is being etched.')
  await expect(page.locator('.answer-next')).toHaveText('The last wafer it recorded, LIVE-s7-L1-W01, is stored as a run.')
  await expect(stat(page, 'Fault put in')).toHaveText('Gas flow stuck low')
  await expect(stat(page, 'Alignment')).toHaveText('ALIGNED')
  await expect(page.getByRole('link', { name: 'open its page' })).toHaveAttribute('href', '/runs/4242')
  expect(await page.locator('.figure.numbered h2').allTextContents()).toEqual(['The chamber now', 'The last wafer it recorded'])
})

test('a read-only ChamberWatch says it does not record live runs', async ({ page }) => {
  await serveApi(page, { readOnly: true })
  // hold the settings back, to see the page before it knows whether this instance records
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route((url) => url.pathname === '/api/settings', async (route) => {
    await held
    await route.fallback()
  })
  await page.goto('/live')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing is being etched.')
  // until the settings arrive it says neither how to record nor that it cannot
  await expect(page.locator('.answer-next')).toHaveCount(0)
  release()

  await expect(page.locator('.answer-next')).toHaveText('This ChamberWatch is read-only, so it does not record live runs.')
  // the lead says it, so the figure under it does not say it again
  await expect(page.getByText('This ChamberWatch is read-only, so it does not record live runs.')).toHaveCount(1)
  // it cannot record, so the instructions for starting the simulator stay closed
  await expect(page.locator('details.live-how')).not.toHaveAttribute('open')
  await expect(page.getByRole('button', { name: /Record from/ })).toHaveCount(0)
})

test('says why the chamber could not be reached, with a way to ask again', async ({ page }) => {
  await serveApi(page)
  let fail = true
  await page.route((url) => url.pathname === '/api/live/session', (route) => (fail
    ? route.fulfill({ status: 502, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Bad Gateway', detail: 'the server is restarting' }) })
    : route.fallback()))
  await page.goto('/live')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The live session did not load.')
  await expect(page.locator('header.answer').getByRole('status')).toHaveText('The live session did not load.')
  await expect(page.getByRole('alert')).toContainText('the server is restarting')
  fail = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing is being etched.')
})

test('keeps up with a session that answers more slowly than the page polls', async ({ page }) => {
  await serveApi(page)
  let slow = false
  await page.route((url) => url.pathname === '/api/live/session', async (route) => {
    if (slow && route.request().method() === 'GET') {
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
    // a poll the page gave up on has nothing left to answer
    await route.fallback().catch(() => undefined)
  })
  await page.goto('/live')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing is being etched.')
  slow = true

  await page.getByRole('button', { name: /Record from/ }).click()

  await expect(page.getByRole('heading', { level: 2, name: 'The last wafer it recorded' })).toBeVisible({ timeout: 10_000 })
})

test('announces the answer, not the clock that ticks under it', async ({ page }) => {
  await serveApi(page)
  await page.goto('/live')
  const header = page.locator('header.answer')
  const status = header.getByRole('status')

  await expect(status).toHaveText('Nothing is being etched.')
  await expect(header).not.toHaveAttribute('aria-live')
  await page.getByRole('button', { name: /Record from/ }).click()

  await expect(status).toHaveText('A wafer is being etched now.')
  await expect(page.locator('.answer-next')).toHaveText(/s in\.$/)
  // the lead with the cycle and the time is plain text, read when the reader gets to it
  await expect(header.locator('[aria-live]')).toHaveCount(0)
})

test('says a recording stopped without a run, and why', async ({ page }) => {
  await serveApi(page)
  await page.route((url) => url.pathname === '/api/live/session', (route) => route.fulfill({
    json: { recording: false, run: 'LIVE-s7-L1-W02', state: null, cycle: 40, samples: 1200, timeS: 240, stored: null, failure: 'the simulator closed the connection' },
  }))
  await page.goto('/live')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The last recording stopped.')
  await expect(page.getByRole('region', { name: 'The last recording stopped' }).getByRole('alert')).toHaveText('the simulator closed the connection')
})

test('the live page is reachable from every page', async ({ page }) => {
  await serveApi(page)
  await page.goto('/')

  await page.getByRole('link', { name: 'Live', exact: true }).click()

  await expect(page).toHaveURL(/\/live$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing is being etched.')
})

for (const width of [320, 375]) {
  test(`fits the live page on a ${width}px phone without sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await serveApi(page)
    await page.goto('/live')

    await expect(page.getByRole('button', { name: /Record from/ })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  })
}

test('says nothing is at an address the app has no page for', async ({ page }) => {
  await serveApi(page)
  await page.goto('/nowhere')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing is at this address.')
  await expect(page).toHaveTitle('Not found · ChamberWatch')
  await page.getByRole('link', { name: 'Back to the runs' }).click()
  await expect(page).toHaveURL(/\/$/)
})
