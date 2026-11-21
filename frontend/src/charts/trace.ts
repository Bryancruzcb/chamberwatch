import type { Excursion, TracePoint } from '../api/schema'
import { type Interval, type LinearScale, niceInterval } from './scale'

/** A step between buckets longer than this is a recording gap: two sample periods, as the aligner counts gaps. */
export const GAP_S = 0.4

export type Vertex = readonly [time: number, value: number]

export interface BandVertex {
  readonly time: number
  readonly low: number
  readonly high: number
  readonly mean: number
}

export interface ExcursionSpan {
  readonly start: number
  readonly end: number
  readonly excursion: Excursion
}

/** A bucket's time: halfway between its first and last sample. */
export function bucketTime(point: TracePoint): number {
  return (point.startS + point.endS) / 2
}

/** The good runs' band at a bucket as mean plus and minus k standard deviations, or null where there is none. */
export function bandAt(point: TracePoint, k: number | null): BandVertex | null {
  if (k === null || point.band === null || point.band.sd === null) {
    return null
  }
  const { mean, sd } = point.band
  return { time: bucketTime(point), low: mean - k * sd, high: mean + k * sd, mean }
}

/**
 * The time the trace covers and the value range of its readings and band means. Band edges stay out, since a wide
 * band would flatten the reading; the chart clips them instead.
 */
export function traceExtent(points: readonly TracePoint[]): { time: Interval; value: Interval } | null {
  const first = points[0]
  const last = points.at(-1)
  if (first === undefined || last === undefined) {
    return null
  }
  let low = Infinity
  let high = -Infinity
  for (const point of points) {
    low = Math.min(low, point.min, point.band?.mean ?? Infinity)
    high = Math.max(high, point.max, point.band?.mean ?? -Infinity)
  }
  return { time: [first.startS, last.endS], value: [low, high] }
}

/** Stretches of consecutive buckets that have a band. A bucket without one, or a recording gap, ends a stretch. */
export function bandSegments(points: readonly TracePoint[], k: number | null): BandVertex[][] {
  const segments: BandVertex[][] = []
  let segment: BandVertex[] = []
  let previous: TracePoint | null = null
  for (const point of points) {
    const band = bandAt(point, k)
    const gap = previous !== null && point.startS - previous.endS > GAP_S
    if ((band === null || gap) && segment.length > 0) {
      segments.push(segment)
      segment = []
    }
    if (band !== null) {
      segment.push(band)
    }
    previous = point
  }
  if (segment.length > 0) {
    segments.push(segment)
  }
  return segments
}

/** The excursions as time spans, leaving out any whose slots have no record time. */
export function excursionSpans(excursions: readonly Excursion[]): ExcursionSpan[] {
  return excursions.flatMap((excursion) => (excursion.startTimeS === null || excursion.endTimeS === null
    ? []
    : [{ start: excursion.startTimeS, end: excursion.endTimeS, excursion }]))
}

/**
 * The spans that overlap a drawn time range, in their order. A zoomed view comes with every excursion of the channel,
 * so it counts and draws only these.
 */
export function spansIn<T extends { readonly start: number; readonly end: number }>(spans: readonly T[], [from, to]: Interval): T[] {
  return spans.filter((span) => span.end >= from && span.start <= to)
}

/**
 * A span's mark on the rail above the plot, in pixels: cut at the plot's edges (the x scale's range), and at least
 * `min` wide so one sample still shows, without leaving the plot.
 */
export function railMark(span: { readonly start: number; readonly end: number }, x: LinearScale, min: number): { x: number; width: number } {
  const [left, right] = x.range
  const from = Math.min(Math.max(x.map(span.start), left), right)
  const to = Math.min(Math.max(x.map(span.end), left), right)
  const width = Math.max(min, to - from)
  return { x: Math.min(from, right - width), width }
}

/** The index of the bucket nearest a time, by binary search over buckets in time order, or null when there are none. */
export function nearestIndex(points: readonly TracePoint[], time: number): number | null {
  if (points.length === 0) {
    return null
  }
  let low = 0
  let high = points.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    const point = points[middle]
    if (point === undefined) {
      break
    }
    if (bucketTime(point) < time) {
      low = middle
    }
    else {
      high = middle
    }
  }
  const before = points[low]
  const after = points[high]
  if (before === undefined || after === undefined) {
    return low
  }
  return Math.abs(bucketTime(before) - time) <= Math.abs(bucketTime(after) - time) ? low : high
}

/**
 * The reading as filled outlines, one per stretch without a recording gap: along the highest value of each bucket, then
 * back along the lowest, so the outline covers everything the reading did inside each bucket. A one-bucket stretch
 * folds to a vertical line, which the outline's stroke still draws.
 */
export function envelopeOutlines(points: readonly TracePoint[]): Vertex[][] {
  return gapFreeStretches(points).map((stretch) => [
    ...stretch.map((point): Vertex => [bucketTime(point), point.max]),
    ...stretch.map((point): Vertex => [bucketTime(point), point.min]).reverse(),
  ])
}

/** The buckets an excursion's time span touches, which the chart redraws in red. */
export function bucketsIn(points: readonly TracePoint[], span: Pick<ExcursionSpan, 'start' | 'end'>): TracePoint[] {
  return points.filter((point) => point.endS >= span.start && point.startS <= span.end)
}

function gapFreeStretches(points: readonly TracePoint[]): TracePoint[][] {
  const stretches: TracePoint[][] = []
  let stretch: TracePoint[] = []
  let previous: TracePoint | null = null
  for (const point of points) {
    if (previous !== null && point.startS - previous.endS > GAP_S) {
      stretches.push(stretch)
      stretch = []
    }
    stretch.push(point)
    previous = point
  }
  if (stretch.length > 0) {
    stretches.push(stretch)
  }
  return stretches
}

/**
 * A band counts as settled where it is at most this many times the view's median band wide. While the good runs ramp
 * up, and at the slot where the gases switch, they disagree by a lot and the band balloons to hundreds of times its
 * usual width; fitting the axis to that would flatten the reading again.
 */
const SETTLED_WIDTHS = 4

/** How much room the fitted axis leaves past the data, as a share of its span. */
const FIT_PAD = 0.05

/** About how many ticks the fitted axis is rounded to. */
const FIT_TICKS = 5

/** Where the y axis of an etch or cycles view runs, and the bucket the fit starts from. */
export interface TraceFit {
  readonly domain: Interval
  /** The first bucket the fit covers; the buckets before it are the start-up ramp. Null when nothing could be fitted. */
  readonly from: number | null
}

/**
 * The y axis for the etch and cycles views. It fits the reading and the settled band from the first bucket where the
 * reading sits inside a settled band; what comes before is the start-up ramp, which would otherwise squash the rest of
 * the reading into a sliver. A reading that never enters the band is fitted whole. The fit is padded about 5 percent
 * and rounded out to tidy ticks; what falls outside it is clipped, and `clipNote` says what.
 */
export function fitTraceDomain(points: readonly TracePoint[], k: number | null): TraceFit {
  if (points.length === 0) {
    return { domain: [0, 1], from: null }
  }
  const bands = points.map((point) => bandAt(point, k))
  const widths = bands.flatMap((band) => (band === null ? [] : [band.high - band.low])).sort((a, b) => a - b)
  const median = widths.length === 0 ? null : widths[Math.floor((widths.length - 1) / 2)] ?? null
  const settled = (band: BandVertex | null): band is BandVertex => band !== null && median !== null && band.high - band.low <= SETTLED_WIDTHS * median
  const entered = points.findIndex((point, index) => {
    const band = bands[index] ?? null
    return settled(band) && point.min >= band.low && point.max <= band.high
  })
  const from = entered === -1 ? 0 : entered
  let low = Infinity
  let high = -Infinity
  points.forEach((point, index) => {
    if (index < from) {
      return
    }
    low = Math.min(low, point.min)
    high = Math.max(high, point.max)
    const band = bands[index] ?? null
    if (settled(band)) {
      low = Math.min(low, band.low)
      high = Math.max(high, band.high)
    }
  })
  const pad = (high - low) * FIT_PAD
  return { domain: niceInterval([low - pad, high + pad], FIT_TICKS), from }
}

/** A clipped side of the reading, worked out so the note can be written in words. */
export interface Clip {
  readonly side: 'below' | 'above'
  /** The edge of the axis the reading went past. */
  readonly edge: number
  /** True when the reading is past the edge only at the start, as during the start-up ramp. */
  readonly atStart: boolean
  /** Where the clipped stretch at the start ends, in record seconds. */
  readonly untilS: number
  /** The first value, for a clip at the start; the most extreme one otherwise. */
  readonly value: number
  /** When the most extreme value came. */
  readonly atS: number
  /** How many separate stretches go past the edge. */
  readonly stretches: number
}

/** The parts of the reading the axis cuts off, below its bottom edge and above its top, in that order. */
export function clips(points: readonly TracePoint[], domain: Interval): Clip[] {
  const [bottom, top] = domain
  const sides = [
    { side: 'below' as const, edge: bottom, past: (point: TracePoint) => point.min < bottom, value: (point: TracePoint) => point.min, worse: (a: number, b: number) => a < b },
    { side: 'above' as const, edge: top, past: (point: TracePoint) => point.max > top, value: (point: TracePoint) => point.max, worse: (a: number, b: number) => a > b },
  ]
  return sides.flatMap(({ side, edge, past, value, worse }) => {
    const out = points.map(past)
    if (!out.includes(true)) {
      return []
    }
    const stretches = out.filter((isOut, index) => isOut && (index === 0 || out[index - 1] !== true)).length
    const atStart = out[0] === true && stretches === 1
    const lastOut = out.lastIndexOf(true)
    const extreme = points.reduce<TracePoint | null>((best, point, index) => (out[index] === true && (best === null || worse(value(point), value(best))) ? point : best), null)
    const first = points[0]
    if (extreme === null || first === undefined) {
      return []
    }
    return [{
      side,
      edge,
      atStart,
      untilS: points[lastOut]?.endS ?? first.endS,
      value: atStart ? value(first) : value(extreme),
      atS: bucketTime(extreme),
      stretches,
    }]
  })
}
