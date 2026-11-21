import type { Locator, Page } from '@playwright/test'

/** The value of the stat with this label. */
export function stat(page: Page, label: string): Locator {
  return page.locator('.stat').filter({ has: page.locator('dt', { hasText: label }) }).locator('.stat-value')
}

/**
 * How far each in-range ring on the page reaches past the left edge of its own line's limit, in pixels: the score
 * lines' hollow rings and the lineup's. A ring clear of the limit gives zero or less.
 */
export function ringsPastLimit(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const reach = (row: Element, ring: string, limit: string): number[] => {
      const mark = row.querySelector(ring)
      const line = row.querySelector(limit)
      return mark === null || line === null ? [] : [mark.getBoundingClientRect().right - line.getBoundingClientRect().left]
    }
    return [
      ...[...document.querySelectorAll('.score-line.in')].flatMap((line) => reach(line, '.sl-point', '.sl-limit')),
      ...[...document.querySelectorAll('.lineup-list .lineup-row:not(.over)')].flatMap((row) => reach(row, '.lineup-dot', '.lineup-limit')),
    ]
  })
}

/** The left edge of every score line's limit tick in each table or list, rounded to a tenth of a pixel, one set per column. */
export function limitEdgesByColumn(page: Page): Promise<number[][]> {
  return page.evaluate(() => {
    const columns = new Map<Element, Set<number>>()
    for (const limit of document.querySelectorAll('.score-line .sl-limit')) {
      const column = limit.closest('table, ul')
      if (column !== null) {
        const edges = columns.get(column) ?? new Set<number>()
        edges.add(Math.round(limit.getBoundingClientRect().left * 10) / 10)
        columns.set(column, edges)
      }
    }
    return [...columns.values()].map((edges) => [...edges])
  })
}
