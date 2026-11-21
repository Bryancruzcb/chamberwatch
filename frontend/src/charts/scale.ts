export type Interval = readonly [start: number, end: number]

export interface LinearScale {
  readonly domain: Interval
  readonly range: Interval
  map(value: number): number
  invert(pixel: number): number
}

/** Maps a data interval onto a pixel interval. A domain of zero width is widened, so a flat channel draws mid-plot. */
export function linearScale(domain: Interval, range: Interval): LinearScale {
  const [d0, d1] = widen(domain)
  const [r0, r1] = range
  const ratio = (r1 - r0) / (d1 - d0)
  return {
    domain: [d0, d1],
    range,
    map: (value) => r0 + (value - d0) * ratio,
    invert: (pixel) => d0 + (pixel - r0) / ratio,
  }
}

/** About `count` round values inside the interval, stepping by 1, 2 or 5 times a power of ten. */
export function niceTicks(interval: Interval, count: number): number[] {
  const [low, high] = widen(ordered(interval))
  const step = niceStep((high - low) / Math.max(1, count))
  const first = Math.ceil(low / step) * step
  const ticks: number[] = []
  for (let i = 0; first + i * step <= high + step * 1e-9; i++) {
    ticks.push(roundToStep(first + i * step, step))
  }
  return ticks
}

/** The interval grown outward to the nearest round values, so an axis starts and ends on a labeled tick. */
export function niceInterval(interval: Interval, count: number): Interval {
  const [low, high] = widen(ordered(interval))
  const step = niceStep((high - low) / Math.max(1, count))
  return [roundToStep(Math.floor(low / step) * step, step), roundToStep(Math.ceil(high / step) * step, step)]
}

/** The step a rough spacing rounds to, with the thresholds d3 uses so the tick count lands near the one asked for. */
function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough))
  const fraction = rough / power
  const multiple = fraction >= Math.sqrt(50) ? 10 : fraction >= Math.sqrt(10) ? 5 : fraction >= Math.SQRT2 ? 2 : 1
  return multiple * power
}

function ordered([start, end]: Interval): Interval {
  return start <= end ? [start, end] : [end, start]
}

function widen([start, end]: Interval): Interval {
  if (end > start) {
    return [start, end]
  }
  const pad = Math.abs(start) * 0.05 || 1
  return [start - pad, start + pad]
}

/** Drops the binary noise a multiple of the step picks up, so 0.30000000000000004 becomes 0.3. */
function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  return Number(value.toFixed(decimals))
}

/** The value rounded up to the next multiple of `step`, and never below one step, so a scale never ends at 0. */
export function roundUpTo(value: number, step: number): number {
  return Math.max(step, Math.ceil(value / step - 1e-9) * step)
}

/** A score line's end runs past the limit by at most this many limits, so one step change cannot flatten the rest. */
const SCORE_LINE_LIMITS = 10

/**
 * Where a column of score lines ends: the largest score rounded up to the next 5, and past the limit so its tick shows.
 * A score of tens of thousands, a step change, would push every other mark against 0, so the end stops at ten times
 * the limit and `past` counts the scores that run off it.
 */
export function scoreLineEnd(scores: readonly number[], k: number | null): { end: number; past: number } {
  const largest = Math.max(0, ...scores)
  const cap = k === null || k <= 0 ? Number.POSITIVE_INFINITY : roundUpTo(SCORE_LINE_LIMITS * k, 5)
  const end = Math.min(roundUpTo(Math.max(largest, k ?? 0), 5), cap)
  return { end, past: scores.filter((score) => score > end).length }
}

/** Where a column of time lines ends: the latest time rounded up to the next 100 s. */
export function timeLineEnd(seconds: readonly number[]): number {
  return roundUpTo(Math.max(0, ...seconds), 100)
}

/** The verdict's line runs to at least this many limits, so the limit tick sits a quarter of the way along or nearer 0. */
const VERDICT_LIMITS = 4

/**
 * Where the run page's verdict line ends: the larger of four times the limit and the score, rounded up to the next 5.
 * Like every score line it stops at ten times the limit, so a step change ends on an arrow instead of pinning the limit
 * against 0.
 */
export function verdictEnd(z: number, k: number): number {
  if (k <= 0) {
    return roundUpTo(Math.max(z, 0), 5)
  }
  return Math.min(roundUpTo(Math.max(VERDICT_LIMITS * k, z), 5), roundUpTo(SCORE_LINE_LIMITS * k, 5))
}
