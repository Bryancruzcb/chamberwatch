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

/** The first moment any lane leaves its range, which the timeline labels with a leader. */
export interface FirstDeparture {
  readonly kind: Span['kind']
  readonly s: number
  readonly at: number
}

export interface Timeline {
  readonly lanes: readonly Lane[]
  /** The earliest excursion or stuck value on any lane; on a tie the excursion, as the detectors time it. */
  readonly first: FirstDeparture | null
  /** Channels that left their range but did not fit on the page. */
  readonly hidden: number
  readonly ticks: readonly Tick[]
}

/** More lanes than this read as a wall; the channels table below lists every channel anyway. */
const MAX_LANES = 6
/** Tick steps in seconds, the first that keeps the axis to six labels or fewer wins. The longest covers an etch of hours. */
const TICK_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000] as const
const LONGEST_TICK_STEP = 5000
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
  const starts = lanes.flatMap(({ channel }) => [
    ...channel.excursions.flatMap((excursion) => (excursion.startTimeS === null ? [] : [{ kind: 'excursion' as const, s: excursion.startTimeS }])),
    ...channel.holds.flatMap((hold) => (hold.startTimeS === null ? [] : [{ kind: 'hold' as const, s: hold.startTimeS }])),
  ])
  const earliest = starts.reduce<(typeof starts)[number] | null>(
    (best, start) => (best === null || start.s < best.s || (start.s === best.s && start.kind === 'excursion') ? start : best),
    null,
  )
  return {
    lanes: lanes.slice(0, MAX_LANES),
    first: earliest === null ? null : { ...earliest, at: positionIn(fromS, toS, earliest.s) },
    hidden: Math.max(0, lanes.length - MAX_LANES),
    ticks: ticksBetween(fromS, toS).map((s) => ({ s, at: positionIn(fromS, toS, s) })),
  }
}

/** Round seconds between the etch's edges, at the smallest step that keeps the axis to six labels or fewer. */
export function ticksBetween(fromS: number, toS: number): number[] {
  if (toS <= fromS) {
    return []
  }
  // count the labels a step would draw, not the intervals between them: both ends on a round second make one more
  const labels = (candidate: number) => Math.floor(toS / candidate) - Math.ceil(fromS / candidate) + 1
  const step: number = TICK_STEPS.find((candidate) => labels(candidate) <= MAX_TICKS) ?? LONGEST_TICK_STEP
  const ticks: number[] = []
  for (let s = Math.ceil(fromS / step) * step; s <= toS; s += step) {
    ticks.push(s)
  }
  return ticks
}

/**
 * The channels caught on a phase mean or spread, in rank order, for an out-of-range run with no moment to draw. As many
 * as the timeline has lanes; `hidden` counts the rest.
 */
export function deviatingChannels(channels: readonly Channel[]): { shown: Channel[]; hidden: number } {
  const deviating = channels.filter((channel) => channel.deviation).sort((a, b) => a.rank - b.rank)
  return { shown: deviating.slice(0, MAX_LANES), hidden: Math.max(0, deviating.length - MAX_LANES) }
}

/** The channel that came closest to the limit, for a run where none left its range. */
export function closestChannel(channels: readonly Channel[]): Channel | null {
  return channels.reduce<Channel | null>((best, channel) => (best === null || channel.persistentZ > best.persistentZ ? channel : best), null)
}
