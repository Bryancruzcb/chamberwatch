import { describe, expect, it } from 'vitest'
import { type Channel, runDetailSchema } from './api/schema'
import { closestChannel, deviatingChannels, etchTimeline, positionIn, ticksBetween } from './timeline'

const fixtures = import.meta.glob('../e2e/fixtures/run-*.json', { eager: true, import: 'default' })

function run(id: number) {
  const key = `../e2e/fixtures/run-${id}.json`
  if (!(key in fixtures)) {
    throw new Error(`no fixture run-${id}.json`)
  }
  const detail = runDetailSchema.parse(fixtures[key])
  if (detail.alignment.kind !== 'aligned') {
    throw new Error(`run ${id} did not align`)
  }
  return { detail, fromS: detail.alignment.etchStartS, toS: detail.alignment.etchEndS }
}

describe('timeline', () => {
  it('places a moment as a share of the etch, clamped to its edges', () => {
    expect(positionIn(100, 300, 200)).toBe(0.5)
    expect(positionIn(100, 300, 50)).toBe(0)
    expect(positionIn(100, 300, 400)).toBe(1)
    expect(positionIn(100, 100, 100)).toBe(0)
  })

  it('labels the axis in round seconds, six labels at most', () => {
    expect(ticksBetween(30.2, 629.3)).toEqual([100, 200, 300, 400, 500, 600])
    expect(ticksBetween(0, 50)).toEqual([0, 10, 20, 30, 40, 50])
    // both ends on a round second would make a seventh label at the finer step
    expect(ticksBetween(0, 60)).toEqual([0, 20, 40, 60])
    expect(ticksBetween(100, 700)).toEqual([200, 400, 600])
    expect(ticksBetween(0, 5000)).toEqual([0, 1000, 2000, 3000, 4000, 5000])
    expect(ticksBetween(10, 10)).toEqual([])
    for (const [from, to] of [[0, 60], [100, 700], [0, 1200], [0, 5000], [7.3, 29999], [30.2, 629.3], [118.6, 710.9]] as const) {
      expect(ticksBetween(from, to).length).toBeLessThanOrEqual(6)
      expect(ticksBetween(from, to).length).toBeGreaterThanOrEqual(2)
    }
  })

  it('lists the channels caught only on a phase mean or spread, in rank order, when there is no moment to draw', () => {
    const { detail, fromS, toS } = run(11)
    const off = ['Gas1Flow', 'PlatenRFPeakToPeak', 'Emission623']
    const channels: Channel[] = detail.channels.map((channel) => (off.includes(channel.channel) ? { ...channel, deviation: true } : channel))

    expect(etchTimeline(channels, fromS, toS).lanes).toEqual([])
    expect(deviatingChannels(channels).shown.map((channel) => channel.channel)).toEqual(['Gas1Flow', 'PlatenRFPeakToPeak', 'Emission623'])
    expect(deviatingChannels(channels).hidden).toBe(0)
    // the channel closest to the limit is not one of them, which is why the page must not show it for this run
    expect(off).not.toContain(closestChannel(channels)?.channel)
    // run 133 has nine deviating channels: six are listed and three counted
    expect(deviatingChannels(run(133).detail.channels)).toMatchObject({ hidden: 3 })
    expect(deviatingChannels(run(133).detail.channels).shown).toHaveLength(6)
    expect(deviatingChannels(detail.channels)).toEqual({ shown: [], hidden: 0 })
  })

  it('draws a lane for each channel that left its range, in rank order, with every excursion on it', () => {
    const { detail, fromS, toS } = run(55)
    const timeline = etchTimeline(detail.channels, fromS, toS)

    expect(timeline.lanes.map((lane) => lane.channel.channel)).toEqual(['PlatenRFLoadCapacitor', 'PlatenRFTuningCapacitor'])
    expect(timeline.lanes.map((lane) => lane.spans.length)).toEqual([21, 4])
    expect(timeline.hidden).toBe(0)
    // the load capacitor's first excursion starts at 407.2 s of an etch from 30.2 to 629.3 s
    expect(timeline.lanes[0]?.spans[0]?.start).toBeCloseTo((407.2 - 30.2) / (629.3 - 30.2), 2)
    for (const span of timeline.lanes.flatMap((lane) => lane.spans)) {
      expect(span.start).toBeGreaterThanOrEqual(0)
      expect(span.start + span.width).toBeLessThanOrEqual(1)
    }
  })

  it('keeps a channel only flagged on a phase mean or spread off the timeline', () => {
    const { detail, fromS, toS } = run(133)
    const timeline = etchTimeline(detail.channels, fromS, toS)

    expect(timeline.lanes.map((lane) => lane.channel.channel)).toEqual(['Gas5Flow', 'ForeLinePressure'])
    expect(detail.channels.filter((channel) => channel.deviation)).toHaveLength(9)
  })

  it('draws a stuck value as a hold', () => {
    const { detail, fromS, toS } = run(136)
    const timeline = etchTimeline(detail.channels, fromS, toS)

    expect(timeline.lanes).toHaveLength(1)
    expect(timeline.lanes[0]?.spans.map((span) => span.kind)).toEqual(['hold'])
  })

  it('shows six lanes at most and counts the rest', () => {
    const { detail, fromS, toS } = run(55)
    const template = detail.channels[0]
    if (template === undefined) {
      throw new Error('run 55 has no channels')
    }
    const many: Channel[] = Array.from({ length: 8 }, (_, index) => ({ ...template, channel: `Channel${index}`, rank: index + 1 }))

    const timeline = etchTimeline(many, fromS, toS)
    expect(timeline.lanes).toHaveLength(6)
    expect(timeline.hidden).toBe(2)
  })

  it('draws nothing for a run no channel left, and names the one that came closest', () => {
    const { detail, fromS, toS } = run(11)

    expect(etchTimeline(detail.channels, fromS, toS).lanes).toEqual([])
    expect(closestChannel(detail.channels)?.channel).toBe('PlatenRFLoadCapacitor')
    expect(closestChannel([])).toBeNull()
  })
})
