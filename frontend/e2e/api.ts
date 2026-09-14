import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page, Request } from '@playwright/test'

const FIXTURES = join(import.meta.dirname, 'fixtures')

/** What the real API answered when a flagged public wafer was labeled GOOD. */
const RELABEL_RESULT = { baselineId: 2, goodRuns: 31, fitted: true, scored: 96, flagged: 14, current: true }

export interface ApiLog {
  /** Every API path the page asked for, with its query, in order. */
  readonly requests: string[]
  /** The body of every relabel. */
  readonly relabels: unknown[]
}

/**
 * Answers the page's API calls with responses captured from the real API on the public data: the lot list, the runs
 * table, runs 55 and 11, and one trace, which serves for any channel. Every other run is missing, like run 9999.
 */
export async function serveApi(page: Page): Promise<ApiLog> {
  const log: ApiLog = { requests: [], relabels: [] }
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    log.requests.push(url.pathname + url.search)
    const { status, body } = answer(request, url, log)
    await route.fulfill({
      status,
      contentType: status < 400 ? 'application/json' : 'application/problem+json',
      body: JSON.stringify(body),
    })
  })
  return log
}

function answer(request: Request, url: URL, log: ApiLog): { status: number; body: unknown } {
  const path = url.pathname
  if (path === '/api/lots') {
    return found(read('lots.json'))
  }
  if (path === '/api/runs') {
    return found(filterRuns(read('runs.json'), url.searchParams))
  }
  const run = /^\/api\/runs\/(\d+)$/.exec(path)?.[1]
  if (run !== undefined) {
    const name = `run-${run}.json`
    return existsSync(join(FIXTURES, name)) ? found(read(name)) : missing(`no run ${run}`)
  }
  const channel = /^\/api\/runs\/\d+\/channels\/([^/]+)\/trace$/.exec(path)?.[1]
  if (channel !== undefined) {
    return found(asAsked(read('trace-55.json'), decodeURIComponent(channel), url.searchParams))
  }
  if (/^\/api\/runs\/\d+\/label$/.test(path) && request.method() === 'PUT') {
    log.relabels.push(request.postDataJSON())
    return found(RELABEL_RESULT)
  }
  return missing(`no fixture for ${request.method()} ${path}`)
}

/** The runs table narrowed the way the API narrows it, by lot id and by whether a run is flagged. */
function filterRuns(page: unknown, params: URLSearchParams): unknown {
  if (!isObject(page) || !Array.isArray(page.runs)) {
    return page
  }
  const lot = params.get('lot')
  const flagged = params.get('flagged')
  const runs = page.runs.filter((run: unknown) => isObject(run)
    && (lot === null || run.lotId === Number(lot))
    && (flagged === null || String(flagCount(run) > 0) === flagged))
  return { ...page, runs }
}

function flagCount(run: Record<string, unknown>): number {
  const limit = typeof run.limitFlags === 'number' ? run.limitFlags : 0
  const deviation = typeof run.deviationFlags === 'number' ? run.deviationFlags : 0
  return limit + deviation
}

/** The captured trace, labeled with the channel and the cycle range the page asked for, as the API echoes them. */
function asAsked(trace: unknown, channel: string, params: URLSearchParams): unknown {
  if (!isObject(trace)) {
    return trace
  }
  const from = params.get('fromCycle')
  const to = params.get('toCycle')
  return { ...trace, channel, fromCycle: from === null ? null : Number(from), toCycle: to === null ? null : Number(to) }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function read(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
}

function found(body: unknown): { status: number; body: unknown } {
  return { status: 200, body }
}

function missing(detail: string): { status: number; body: unknown } {
  return { status: 404, body: { title: 'Not Found', status: 404, detail } }
}
