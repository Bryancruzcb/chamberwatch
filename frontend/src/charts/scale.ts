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
