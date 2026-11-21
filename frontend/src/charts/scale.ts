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

/**
 * How an axis prints its ticks: every one with the decimals its step needs, so a step of 0.1 gives 27.0, 27.1 and a
 * step of 20 gives 0, 20, 140. The step is the gap between the first two ticks; a lone tick prints as it is.
 */
export function tickFormat(ticks: readonly number[]): (value: number) => string {
  const [first, second] = ticks
  if (first === undefined || second === undefined || second === first) {
    return (value) => tickNumber(20).format(value)
  }
  // the small allowance keeps a step of 0.1 that a sum left at 0.09999999 to one decimal
  const decimals = Math.max(0, Math.ceil(-Math.log10(Math.abs(second - first)) - 1e-6))
  const format = tickNumber(decimals, decimals)
  return (value) => format.format(value)
}

function tickNumber(maximumFractionDigits: number, minimumFractionDigits = 0): Intl.NumberFormat {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits, maximumFractionDigits })
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

/** A mono label's advance per character as a share of its font size: IBM Plex Mono's glyphs are 600 units of 1,000. */
const MONO_ADVANCE = 0.6

/**
 * Whether a scale's "0", set from the start of a track `width` px wide, clears by at least `gap` px the limit's label,
 * `limitText` centred on the limit at `share` of the track. Both labels are mono at `px`.
 */
export function startClearsLimit(width: number, share: number, limitText: string, px: number, gap: number): boolean {
  const advance = MONO_ADVANCE * px
  return advance + gap <= share * width - (limitText.length * advance) / 2
}

/**
 * The same for the scale's end label, `endText`, set flush with the end of the track. A limit near 0 sets its label
 * from the limit rightward rather than centred on it: pass `centred` false.
 */
export function endClearsLimit(width: number, share: number, limitText: string, endText: string, px: number, gap: number, centred = true): boolean {
  const advance = MONO_ADVANCE * px
  const limitReach = limitText.length * advance * (centred ? 0.5 : 1)
  return endText.length * advance + gap <= (1 - share) * width - limitReach
}

/** A tick on a time axis: its mark's place in px and its text. */
export interface AxisTick {
  readonly x: number
  readonly text: string
}

/**
 * A time axis's tick labels: each tick's text, the last with the unit after it ("700 s"), so the unit is never a loose
 * letter beside the number. A label centred on its mark that would pass `right`, the axis's end, ends on its mark
 * instead, so no part of the axis runs past the plot. A label that would come within a character of the next one shown
 * is left empty, its mark kept. Labels are mono at `px`; `x` and `right` are in px. Anything else a tick carries comes
 * back with it.
 */
export function timeAxisLabels<T extends AxisTick>(ticks: readonly T[], unit: string, px: number, right: number): Array<T & { readonly anchor: 'middle' | 'end' }> {
  const advance = MONO_ADVANCE * px
  const labels = ticks.map((tick, index) => {
    const text = index === ticks.length - 1 ? `${tick.text} ${unit}` : tick.text
    const anchor: 'middle' | 'end' = tick.x + (text.length * advance) / 2 > right ? 'end' : 'middle'
    return { ...tick, text, anchor }
  })
  const extent = (label: { x: number; text: string; anchor: 'middle' | 'end' }) => {
    const width = label.text.length * advance
    const left = label.anchor === 'end' ? label.x - width : label.x - width / 2
    return { left, right: left + width }
  }
  // from the last label back, since the last is the one the unit makes longer
  let next = Number.POSITIVE_INFINITY
  for (let index = labels.length - 1; index >= 0; index--) {
    const label = labels[index]
    if (label === undefined) {
      continue
    }
    const { left, right: end } = extent(label)
    if (end + advance > next) {
      labels[index] = { ...label, text: '' }
    }
    else {
      next = left
    }
  }
  return labels
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

/**
 * Labels set at the ends of lines, moved apart so that no two sit closer than `gap`, keeping their order and staying
 * between `low` and `high` (both pixel positions, low the smaller). Of two that collide the lower one moves down, unless
 * that would pass `high`. When there is not room for every gap, they keep the gap and the last one runs past `high`.
 */
export function spreadLabels(wanted: readonly number[], gap: number, low: number, high: number): number[] {
  const order = wanted.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y || a.index - b.index)
  const placed = order.map((entry) => Math.min(Math.max(entry.y, low), high))
  // push down from the top, then back up from the bottom, then down once more from the top edge
  for (let i = 1; i < placed.length; i++) {
    placed[i] = Math.max(placed[i] ?? 0, (placed[i - 1] ?? 0) + gap)
  }
  for (let i = placed.length - 1; i >= 0; i--) {
    const below = i === placed.length - 1 ? high : (placed[i + 1] ?? high) - gap
    placed[i] = Math.min(placed[i] ?? 0, below)
  }
  for (let i = 0; i < placed.length; i++) {
    placed[i] = Math.max(placed[i] ?? 0, i === 0 ? low : (placed[i - 1] ?? low) + gap)
  }
  const result = new Array<number>(wanted.length).fill(0)
  order.forEach((entry, rank) => {
    result[entry.index] = placed[rank] ?? entry.y
  })
  return result
}
