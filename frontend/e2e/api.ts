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
 * Answers the page's API calls with responses captured from the real API: the lot list, the runs table of either
 * source, public runs 55 and 11, synthetic run 133 with its injected fault and its own Gas5Flow trace, run 55's
 * trace for every other channel, run 55's measurements, the drift of lots 6 and 901 and the drift report of either
 * source. Every other run and lot is missing, like run 9999.
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
  const synthetic = url.searchParams.get('source') === 'SYNTHETIC'
  if (path === '/api/runs') {
    return found(filterRuns(read(synthetic ? 'runs-synthetic.json' : 'runs.json'), url.searchParams))
  }
  if (path === '/api/reports/drift-vs-depth') {
    return found(read(synthetic ? 'drift-vs-depth-synthetic.json' : 'drift-vs-depth.json'))
  }
  const lot = /^\/api\/lots\/(\d+)\/drift$/.exec(path)?.[1]
  if (lot !== undefined) {
    const name = `drift-${lot}.json`
    return existsSync(join(FIXTURES, name))
      ? found(inPhase(read(name), url.searchParams.get('phase') ?? 'SF6'))
      : missing(`no lot ${lot}`)
  }
  const measured = /^\/api\/runs\/(\d+)\/measurements$/.exec(path)?.[1]
  if (measured !== undefined) {
    const set = url.searchParams.get('set') ?? 'EIGHTY_NINE_POINT'
    if (measured !== '55') {
      return found({ set, points: 0, meanDepthUm: null, sdDepthUm: null, values: [] })
    }
    return found(read(set === 'NINE_POINT' ? 'measurements-55-nine.json' : 'measurements-55.json'))
  }
  const run = /^\/api\/runs\/(\d+)$/.exec(path)?.[1]
  if (run !== undefined) {
    const name = `run-${run}.json`
    return existsSync(join(FIXTURES, name)) ? found(read(name)) : missing(`no run ${run}`)
  }
  const traced = /^\/api\/runs\/(\d+)\/channels\/([^/]+)\/trace$/.exec(path)
  if (traced !== null) {
    const own = `trace-${traced[1]}.json`
    const name = existsSync(join(FIXTURES, own)) ? own : 'trace-55.json'
    return found(asAsked(read(name), decodeURIComponent(traced[2] ?? ''), url.searchParams))
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

/** The captured lot drift, labeled with the phase the page asked for. */
function inPhase(drift: unknown, phase: string): unknown {
  return isObject(drift) ? { ...drift, phase } : drift
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
