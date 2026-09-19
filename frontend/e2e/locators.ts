import type { Locator, Page } from '@playwright/test'

/** The value of the stat with this label. */
export function stat(page: Page, label: string): Locator {
  return page.locator('.stat').filter({ has: page.locator('dt', { hasText: label }) }).locator('.stat-value')
}

/** The value of a verdict fact with this label. */
export function fact(page: Page, label: string): Locator {
  return page.locator('.verdict-facts li').filter({ has: page.locator('.fact-label', { hasText: label }) }).locator('.fact-value')
}
