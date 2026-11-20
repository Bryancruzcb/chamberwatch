import type { Channel } from './api/schema'

// Where a run's channels left their range along the etch, as shares of the etch from 0 to 1. Only calculations: the
// run page draws them.

/** One stretch on a channel's lane: an excursion past the limit, or a hold on one value. */
export interface Span {
  readonly kind: 'excursion' | 'hold'
  readonly start: number
  readonly width: number
}

/** A channel that left its range during the etch, with every stretch it spent out. */
export interface Lane {
  readonly channel: Channel
  readonly spans: readonly Span[]
}

export interface Tick {
  readonly s: number
  readonly at: number
}

export interface Timeline {
  readonly lanes: readonly Lane[]
  /** Channels that left their range but did not fit on the page. */
  readonly hidden: number
  readonly ticks: readonly Tick[]
}

/** More lanes than this read as a wall; the channels table below lists every channel anyway. */
const MAX_LANES = 6
/** Tick steps in seconds, the first that keeps the axis to six labels or fewer wins. */
const TICK_STEPS = [10, 20, 50, 100, 200] as const
const LONGEST_TICK_STEP = 500
const MAX_TICKS = 6

/** Where `s` falls in the etch from `fromS` to `toS`, clamped to its edges. */
export function positionIn(fromS: number, toS: number, s: number): number {
  return toS <= fromS ? 0 : Math.min(Math.max((s - fromS) / (toS - fromS), 0), 1)
}

/**
 * The lanes of the channels that left their range, in rank order, so the first one is the channel that left first. A
 * channel only flagged on a phase mean or spread has no moment to draw and stays off the timeline.
 */
export function etchTimeline(channels: readonly Channel[], fromS: number, toS: number): Timeline {
  const spanOf = (kind: Span['kind'], startS: number, endS: number | null): Span => {
    const start = positionIn(fromS, toS, startS)
    return { kind, start, width: Math.max(positionIn(fromS, toS, endS ?? startS) - start, 0) }
  }
  const lanes = [...channels]
    .sort((a, b) => a.rank - b.rank)
    .flatMap((channel) => {
      const spans = [
        ...channel.excursions.flatMap((excursion) => (excursion.startTimeS === null
          ? []
          : [spanOf('excursion', excursion.startTimeS, excursion.endTimeS)])),
        ...channel.holds.flatMap((hold) => (hold.startTimeS === null ? [] : [spanOf('hold', hold.startTimeS, hold.endTimeS)])),
      ]
      return spans.length === 0 ? [] : [{ channel, spans }]
    })
  return {
    lanes: lanes.slice(0, MAX_LANES),
    hidden: Math.max(0, lanes.length - MAX_LANES),
    ticks: ticksBetween(fromS, toS).map((s) => ({ s, at: positionIn(fromS, toS, s) })),
  }
}

/** Round seconds between the etch's edges, at the smallest step that keeps the axis to six labels or fewer. */
export function ticksBetween(fromS: number, toS: number): number[] {
  if (toS <= fromS) {
    return []
  }
  const step: number = TICK_STEPS.find((candidate) => (toS - fromS) / candidate <= MAX_TICKS) ?? LONGEST_TICK_STEP
  const ticks: number[] = []
  for (let s = Math.ceil(fromS / step) * step; s <= toS; s += step) {
    ticks.push(s)
  }
  return ticks
}

/** The channel that came closest to the limit, for a run where none left its range. */
export function closestChannel(channels: readonly Channel[]): Channel | null {
  return channels.reduce<Channel | null>((best, channel) => (best === null || channel.persistentZ > best.persistentZ ? channel : best), null)
}
