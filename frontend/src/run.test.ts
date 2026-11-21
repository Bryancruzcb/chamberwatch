import { describe, expect, it } from 'vitest'
import { type Channel, runDetailSchema, type RunDetail, runsPageSchema, type Score } from './api/schema'
import {
  describeClosest, describeHiddenChannels, describeUnscored, describeVerdict, lotStrip, lotWafers, runDetailState, runHeadline, runTitle,
  splitLineup,
} from './run'

const fixtures = import.meta.glob('../e2e/fixtures/*.json', { eager: true, import: 'default' })

function fixture(name: string): unknown {
  const key = `../e2e/fixtures/${name}`
  if (!(key in fixtures)) {
    throw new Error(`no fixture ${name}`)
  }
  return fixtures[key]
}

const run55 = runDetailSchema.parse(fixture('run-55.json'))
const run11 = runDetailSchema.parse(fixture('run-11.json'))
const run133 = runDetailSchema.parse(fixture('run-133.json'))
const publicRuns = runsPageSchema.parse(fixture('runs.json')).runs
const simulatedRuns = runsPageSchema.parse(fixture('runs-synthetic.json')).runs

const FAILED = { kind: 'failed', note: 'no SF6 onset found' } as const

function score(flags: Partial<Score> = {}): Score {
  return { limitFlags: 0, deviationFlags: 0, stuckFlags: 0, persistentZ: 2, firstChannel: null, firstTimeS: null, ...flags }
}

function channel(name: string, rank: number, persistentZ: number): Channel {
  return { channel: name, rank, persistentZ, deviation: false, maxAbsSummaryZ: 0, longestHold: 0, phases: [], excursions: [], holds: [] }
}

describe('the run page head', () => {
  it('says how the run did in a sentence, for every state', () => {
    expect(runHeadline(run55)).toBe('Wafer 5 of Lot 6 is out of range.')
    expect(runHeadline(run11)).toBe('Wafer 1 of Lot 2 is in range.')
    expect(runHeadline(run133)).toBe('Wafer 7 of Lot 901 is out of range.')
    expect(runHeadline({ ...run55, assessment: null })).toBe('Wafer 5 of Lot 6 was not scored.')
    expect(runHeadline({ ...run55, alignment: FAILED, assessment: null })).toBe('Wafer 5 of Lot 6 could not be aligned.')
  })

  it('checks a failed alignment before a missing score, as the runs table does', () => {
    expect(runDetailState({ alignment: FAILED, assessment: score() })).toBe('failed')
    expect(runDetailState({ alignment: run55.alignment, assessment: null })).toBe('unscored')
    expect(runDetailState({ alignment: run55.alignment, assessment: score({ stuckFlags: 1 }) })).toBe('out')
    expect(runDetailState({ alignment: run55.alignment, assessment: score() })).toBe('in')
  })

  it('names the browser tab by lot and wafer, not by file name', () => {
    expect(runTitle(run55)).toBe('Lot 6, wafer 5 · ChamberWatch')
  })

  it('says why a run has no score', () => {
    expect(describeUnscored({ alignment: FAILED, baseline: run55.baseline })).toBe('The aligner could not place it on the recipe grid: no SF6 onset found.')
    expect(describeUnscored({ alignment: { kind: 'failed', note: null }, baseline: null }))
      .toBe('The aligner could not place it on the recipe grid, so the detectors could not score it.')
    expect(describeUnscored({ alignment: run55.alignment, baseline: null })).toBe('There is no baseline yet, so no run has a score.')
    expect(describeUnscored({ alignment: run55.alignment, baseline: run55.baseline })).toBe('It has no score under the current baseline.')
  })

  it('states the verdict against the limit, and says which rule caught a run under it', () => {
    expect(describeVerdict(score({ limitFlags: 25, persistentZ: 18.8 }), 6)).toBe('Out of range: past the limit of 6.0')
    expect(describeVerdict(score({ persistentZ: 5.5 }), 6)).toBe('In range: under the limit of 6.0')
    expect(describeVerdict(score({ stuckFlags: 1, persistentZ: 3.6 }), 6)).toBe('Out of range: a stuck sensor, under the limit of 6.0')
    expect(describeVerdict(score({ deviationFlags: 2, persistentZ: 4 }), 6)).toBe('Out of range on a phase mean or spread, under the limit of 6.0')
    // exactly at the limit is not past it
    expect(describeVerdict(score({ deviationFlags: 1, persistentZ: 6 }), 6)).toBe('Out of range on a phase mean or spread, under the limit of 6.0')
  })

  it('names the closest channel of a run none left', () => {
    expect(describeClosest(channel('PlatenRFLoadCapacitor', 1, 5.5168), 6)).toBe('Platen RF load cap came closest to the limit of 6.0, at 5.5.')
    expect(describeClosest(channel('Gas1Flow', 1, 5.96), 6)).toBe('Gas 1 flow came closest to the limit of 6.0, at 5.96.')
    expect(describeClosest(channel('Gas1Flow', 1, 2.2), null)).toBe('Gas 1 flow came closest, at 2.2.')
  })
})

describe('the lot strip', () => {
  it('lays out the run\'s lot in order, this wafer with its score, under one bracket over wafers 1 to 3', () => {
    const strip = lotStrip(publicRuns, run55)

    expect(strip.baseline).toBe(3)
    expect(strip.slots.map((slot) => slot.text)).toEqual(['1', '2', '3', '4', '18.8', '6', '7', '8', '9', '10'])
    expect(strip.slots.map((slot) => slot.state).join(' ')).toBe('in in in out out out out out out out')
    expect(strip.slots.filter((slot) => slot.current).map((slot) => slot.id)).toEqual([55])
    expect(strip.slots[0]?.label).toBe('Lot 6, wafer 1: in range, how unusual 3.0, baseline run')
    expect(strip.slots[4]?.label).toBe('Lot 6, wafer 5: out of range, how unusual 18.8')
  })

  it('prints a step change short enough for its disc', () => {
    const strip = lotStrip(simulatedRuns, run133)

    expect(strip.slots.find((slot) => slot.current)?.text).toBe('98K')
    expect(strip.slots).toHaveLength(10)
  })

  it('takes this run from its own answer, which a relabel makes newer than the list', () => {
    const relabeled: RunDetail = { ...run55, good: true, assessment: null }
    const strip = lotStrip(publicRuns, relabeled)
    const here = strip.slots.find((slot) => slot.current)

    expect(here?.state).toBe('unscored')
    expect(here?.text).toBe('5')
    expect(here?.label).toBe('Lot 6, wafer 5: not scored, baseline run')
    // baseline runs at 1, 2, 3 and 5 are not a prefix, so each is marked on its own
    expect(strip.baseline).toBeNull()
  })

  it('draws this run even when the list does not have it yet, and nothing from other lots', () => {
    const strip = lotStrip(publicRuns.filter((row) => row.id !== 55), run55)

    expect(strip.slots.map((slot) => slot.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(lotStrip([], run55).slots.map((slot) => slot.id)).toEqual([55])
  })

  it('lays out a lot on its own page with no wafer marked as this one', () => {
    const strip = lotWafers([...publicRuns].reverse(), run55.lotId)

    expect(strip.baseline).toBe(3)
    expect(strip.slots.map((slot) => slot.text)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    expect(strip.slots.some((slot) => slot.current)).toBe(false)
    expect(strip.slots[4]?.label).toBe('Lot 6, wafer 5: out of range, how unusual 18.8')
    expect(lotWafers(publicRuns, 9999)).toEqual({ slots: [], baseline: null })
  })
})

describe('the lineup', () => {
  it('shows the first ten channels by rank and folds the rest', () => {
    const { shown, hidden } = splitLineup(run55.channels, 6)

    expect(shown).toHaveLength(10)
    expect(shown[0]?.channel).toBe('PlatenRFLoadCapacitor')
    expect(hidden).toHaveLength(21)
    expect(describeHiddenChannels(hidden)).toBe('21 more channels, all under 3.0')
  })

  it('shows every channel past the limit when more than ten are', () => {
    const many = Array.from({ length: 14 }, (_, index) => channel(`Gas${index}Flow`, index + 1, index < 12 ? 9 : 1))
    const { shown, hidden } = splitLineup(many, 6)

    expect(shown).toHaveLength(12)
    expect(hidden.map((row) => row.channel)).toEqual(['Gas12Flow', 'Gas13Flow'])
  })

  it('always shows the channel with the largest score, in rank order, on a run no channel left', () => {
    const { shown, hidden } = splitLineup(run11.channels, 6)

    expect(shown).toHaveLength(11)
    expect(shown.map((row) => row.channel)).toContain('PlatenRFLoadCapacitor')
    expect(shown.at(-1)?.channel).toBe('PlatenRFLoadCapacitor')
    expect(shown.map((row) => row.rank)).toEqual([...shown.map((row) => row.rank)].sort((a, b) => a - b))
    expect(describeHiddenChannels(hidden)).toBe('20 more channels, all under 3.0')
  })

  it('never folds away a channel that deviates or got stuck', () => {
    const deviating = Array.from({ length: 14 }, (_, index) => ({ ...channel(`Gas${index}Flow`, index + 1, 3.9 - index * 0.1), deviation: true }))
    const quiet = Array.from({ length: 6 }, (_, index) => channel(`Quiet${index}`, 15 + index, 0.5))
    const stuck = { ...channel('Pressure', 21, 0.2), holds: [{ channel: 'Pressure', startSlot: 9, confirmSlot: 12, endSlot: 40, cycle: 2, phase: 'SF6', offset: 1, startTimeS: 1, confirmTimeS: 2, endTimeS: 8, samples: 31, value: 1 }] } satisfies Channel
    const { shown, hidden } = splitLineup([...deviating, ...quiet, stuck], 4)

    expect(shown.map((row) => row.channel)).toEqual([...deviating.map((row) => row.channel), 'Pressure'])
    expect(hidden.map((row) => row.channel)).toEqual(quiet.map((row) => row.channel))
    expect(hidden.some((row) => row.deviation || row.holds.length > 0)).toBe(false)
  })

  it('orders by rank whatever order the channels arrive in, and folds nothing from a short list', () => {
    const { shown, hidden } = splitLineup([channel('B', 2, 1), channel('A', 1, 2)], 6)

    expect(shown.map((row) => row.channel)).toEqual(['A', 'B'])
    expect(hidden).toEqual([])
  })

  it('bounds the folded channels by the next whole number past the largest', () => {
    expect(describeHiddenChannels([channel('A', 11, 2.9), channel('B', 12, 1)])).toBe('2 more channels, all under 3.0')
    expect(describeHiddenChannels([channel('A', 11, 3)])).toBe('1 more channel, under 4.0')
    expect(describeHiddenChannels([])).toBe('')
  })
})
