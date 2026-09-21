import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page, Request } from '@playwright/test'

const FIXTURES = join(import.meta.dirname, 'fixtures')

/** What the real API answered when a flagged public wafer was labeled GOOD. */
const RELABEL_RESULT = { baselineId: 2, goodRuns: 31, fitted: true, scored: 96, flagged: 14, current: true }

/**
 * The refresh a relabel starts: running when the PUT answers and the first time it is asked about, then done. A relabel
 * to BAD gets a refresh that fails, the way a refit that runs out of memory on a small host does.
 */
const REFRESH_ID = 7
const FAILING_REFRESH_ID = 8
const OUT_OF_MEMORY = 'java.lang.OutOfMemoryError: Java heap space'

function refresh(id: number, state: 'RUNNING' | 'DONE' | 'FAILED'): unknown {
  return {
    id,
    source: 'PUBLIC',
    state,
    result: state === 'DONE' ? RELABEL_RESULT : null,
    error: state === 'FAILED' ? OUT_OF_MEMORY : null,
  }
}

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
/** The live session, which the live page drives: idle, then etching, then the run it stored. */
const LIVE_IDLE = {
  recording: false, run: null, state: null, cycle: 0, samples: 0, timeS: 0, stored: null, failure: null,
}
const LIVE_ETCHING = {
  recording: true, run: 'LIVE-s7-L1-W01', state: 'ETCH_SF6', cycle: 12, samples: 640, timeS: 128,
  stored: null, failure: null,
}
const LIVE_STORED = {
  recording: false, run: 'LIVE-s7-L1-W01', state: 'END', cycle: 100, samples: 2988, timeS: 597.6,
  stored: {
    run: 'LIVE-s7-L1-W01', runId: 4242, samples: 2988, reason: 'COMPLETE', alignment: 'ALIGNED',
    faultKind: 'GAS_FLOW_STUCK_LOW', faultChannel: 'Gas5Flow',
  },
  failure: null,
}

export async function serveApi(page: Page, options: { readOnly?: boolean } = {}): Promise<ApiLog> {
  const log: ApiLog = { requests: [], relabels: [] }
  const settings = { readOnly: options.readOnly ?? false }
  // the live session answers idle until a recording is started, then etching, then what it stored
  let live: unknown = LIVE_IDLE
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    log.requests.push(url.pathname + url.search)
    let answered: { status: number; body: unknown }
    if (url.pathname === '/api/settings') {
      answered = found(settings)
    }
    else if (url.pathname === '/api/live/session' && request.method() === 'GET') {
      answered = found(live)
      live = live === LIVE_ETCHING ? LIVE_STORED : live
    }
    else if (url.pathname === '/api/live/start') {
      live = LIVE_ETCHING
      answered = { status: 202, body: live }
    }
    else if (url.pathname === '/api/live/inject' || url.pathname === '/api/live/session') {
      answered = found(live)
    }
    else {
      answered = answer(request, url, log)
    }
    const { status, body } = answered
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
      ? found(asAskedDrift(read(name), url.searchParams.get('phase') ?? 'SF6', url.searchParams.get('reference') ?? 'GLOBAL'))
      : missing(`no lot ${lot}`)
  }
  if (path === '/api/reports/depth-model') {
    return found(read('depth-model.json'))
  }
  const depth = /^\/api\/runs\/(\d+)\/depth$/.exec(path)?.[1]
  if (depth !== undefined) {
    const name = `depth-${depth}.json`
    return existsSync(join(FIXTURES, name)) ? found(read(name)) : missing(`no depth for run ${depth}`)
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
    const change: unknown = request.postDataJSON()
    log.relabels.push(change)
    const failing = isObject(change) && change.label === 'BAD'
    return { status: 202, body: refresh(failing ? FAILING_REFRESH_ID : REFRESH_ID, 'RUNNING') }
  }
  if (path === `/api/refreshes/${REFRESH_ID}`) {
    // the log already holds this request, so the first poll counts one
    return found(refresh(REFRESH_ID, log.requests.filter((asked) => asked === path).length > 1 ? 'DONE' : 'RUNNING'))
  }
  if (path === `/api/refreshes/${FAILING_REFRESH_ID}`) {
    return found(refresh(FAILING_REFRESH_ID, 'FAILED'))
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
  const stuck = typeof run.stuckFlags === 'number' ? run.stuckFlags : 0
  return limit + deviation + stuck
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

/** The captured lot drift, labeled with the phase and the reference the page asked for, as the API echoes them. */
function asAskedDrift(drift: unknown, phase: string, reference: string): unknown {
  return isObject(drift) ? { ...drift, phase, reference } : drift
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
