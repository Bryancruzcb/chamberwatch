import type { Excursion, TracePoint } from '../api/schema'
import type { Interval } from './scale'

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

/**
 * The reading as polylines, one per stretch without a recording gap. Each bucket adds its lowest and highest value,
 * whichever is nearer the previous bucket's last value first, so the line stays continuous and a one-sample spike
 * keeps its full height.
 */
export function envelopeSegments(points: readonly TracePoint[]): Vertex[][] {
  const segments: Vertex[][] = []
  let segment: Vertex[] = []
  let previous: TracePoint | null = null
  let lastValue = 0
  for (const point of points) {
    if (previous !== null && point.startS - previous.endS > GAP_S) {
      segments.push(segment)
      segment = []
    }
    const time = bucketTime(point)
    if (point.min === point.max) {
      segment.push([time, point.min])
      lastValue = point.min
    }
    else {
      const minFirst = segment.length === 0 || Math.abs(lastValue - point.min) <= Math.abs(lastValue - point.max)
      const [first, second] = minFirst ? [point.min, point.max] : [point.max, point.min]
      segment.push([time, first], [time, second])
      lastValue = second
    }
    previous = point
  }
  if (segment.length > 0) {
    segments.push(segment)
  }
  return segments
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
