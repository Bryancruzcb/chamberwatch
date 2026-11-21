import { describe, expect, it } from 'vitest'
import { lotDriftSchema, lotsSchema, type Lot, type LotDrift, type RunRow, runsPageSchema } from './api/schema'
import {
  clusterByLot, describeClean, describeDrift, describeFirstChannels, describeLots, describeWafers, headline, type LotDriftAnswer,
  runState, sortRuns, summarize, summarizeDrift,
} from './summary'

const fixtures = import.meta.glob('../e2e/fixtures/*.json', { eager: true, import: 'default' })

function fixture(name: string): unknown {
  const key = `../e2e/fixtures/${name}`
  if (!(key in fixtures)) {
    throw new Error(`no fixture ${name}`)
  }
  return fixtures[key]
}

const lots = lotsSchema.parse(fixture('lots.json'))
const publicRuns = runsPageSchema.parse(fixture('runs.json')).runs
const simulatedRuns = runsPageSchema.parse(fixture('runs-synthetic.json')).runs

/** The whole answer as a reader sees it: the lead, then the start sentence or how the runs split. */
function read(runs: readonly RunRow[], lotList: readonly Lot[] = lots): string[] {
  const said = headline(summarize(runs, lotList))
  return [said.lead, `${said.startStrong}${said.startText}`, said.detail ?? ''].filter((part) => part !== '')
}

/** Fig. 2's answer: which channel left its range first, over the out-of-range runs. */
function channels(runs: readonly RunRow[]): string {
  const summary = summarize(runs, lots)
  return describeFirstChannels(summary.firstChannels, summary.out.length)
}

let nextId = 1000

/** A run row for the cases the captured data does not have. `z` null means not scored. */
function run(lotNo: number, position: number, flags: number, z: number | null = flags > 0 ? 9 : 1, channel: string | null = 'Gas5Flow'): RunRow {
  nextId += 1
  return {
    id: nextId,
    key: `L${lotNo}-W${position}`,
    lotId: 500 + lotNo,
    lotNo,
    positionInLot: position,
    label: 'AUTO',
    alignment: 'ALIGNED',
    good: false,
    score: z === null
      ? null
      : { limitFlags: flags, deviationFlags: 0, stuckFlags: 0, persistentZ: z, firstChannel: flags > 0 ? channel : null, firstTimeS: flags > 0 ? 100 : null },
  }
}

describe('the answer at the top of the runs page', () => {
  it('names the lots and the lot with the most out-of-range runs on the public wafers, in one line each', () => {
    expect(read(publicRuns)).toEqual([
      '15 of 96 runs are out of range, all in lots 6 to 9.',
      'Start with Lot 6: wafers 4 to 10 of 10 are out.',
    ])
    expect(channels(publicRuns)).toBe('Platen RF load cap in 10 of the 15 runs and Platen RF tuning cap in 5.')
  })

  it('sets the out-of-range count apart, and only when there is one', () => {
    const said = headline(summarize(publicRuns, lots))

    expect(said.signal).toBe('15')
    expect(said.lead.startsWith(`${said.signal} `)).toBe(true)
    expect(headline(summarize([run(1, 1, 0)], [])).signal).toBeNull()
    expect(headline(summarize([], [])).signal).toBeNull()
  })

  it('starts the simulated wafers at lot 901 and counts single channels together', () => {
    expect(read(simulatedRuns)).toEqual([
      '8 of 40 runs are out of range, all in lots 6, 7 and 901.',
      'Start with Lot 901: wafers 5 to 7, 9 and 10 of 10 are out.',
    ])
    expect(channels(simulatedRuns)).toBe('Platen RF load cap in 3 of the 8 runs, Helium backside pressure in 2 and 3 other channels in 1 each.')
  })

  it('says "is" for a lot with one wafer out', () => {
    expect(read([run(4, 1, 0), run(4, 2, 2)], [])[1]).toBe('Start with Lot 4: wafer 2 of 2 is out.')
  })

  it('names every lot that ties for the most out-of-range runs and picks none of them', () => {
    const runs = [run(3, 1, 0), run(3, 2, 4), run(3, 3, 2), run(5, 1, 0), run(5, 2, 1), run(5, 3, 7), run(8, 1, 1), run(8, 2, 0)]
    const said = headline(summarize(runs, []))

    expect(said.start).toEqual({ kind: 'tie', lotNos: [3, 5], count: 2 })
    expect(said.startStrong).toBe('')
    expect(read(runs, [])).toEqual([
      '5 of 8 runs are out of range, all in lots 3, 5 and 8.',
      'Lots 3 and 5 tie for the most: 2 out each.',
    ])
    expect(describeFirstChannels(summarize(runs, []).firstChannels, 5)).toBe('Gas 5 flow in 5 of the 5 runs.')
  })

  it('names the start lot even when the tied lots are not the most unusual', () => {
    const runs = [run(2, 1, 3, 30), run(4, 1, 1), run(4, 2, 1)]

    expect(headline(summarize(runs, [])).start).toEqual({ kind: 'one', lotNo: 4, wafers: [1, 2], of: 2 })
  })

  it('says every run is in range only when every run is', () => {
    expect(read([run(1, 1, 0), run(1, 2, 0)], [])).toEqual(['All 2 runs are in range.'])
    expect(read([run(1, 1, 0), run(1, 2, 0, null)], [])).toEqual([
      'None of the 2 runs are out of range.',
      'Of those, 1 is in range and 1 was not scored.',
    ])
  })

  it('says when a source has no runs', () => {
    expect(read([], [])).toEqual(['No runs stored for this source yet.'])
  })

  it('counts runs that name no first channel apart from the channels', () => {
    expect(describeFirstChannels([{ channel: 'Gas5Flow', count: 2 }, { channel: null, count: 1 }], 3))
      .toBe('Gas 5 flow in 2 of the 3 runs. 1 run names no first channel.')
    expect(describeFirstChannels([{ channel: null, count: 2 }], 2)).toBe('No out-of-range run names a first channel.')
    expect(describeFirstChannels([{ channel: 'Pressure', count: 1 }], 1)).toBe('Chamber pressure in 1 of the 1 run.')
  })
})

describe('the first channels, clustered by lot', () => {
  it('keeps each channel\'s runs and clusters them by lot in lot order', () => {
    const summary = summarize(publicRuns, lots)
    const [load, tuning] = summary.firstChannels
    const clusters = (runs: readonly RunRow[]) => clusterByLot(runs).map((cluster) => `${cluster.lotNo}:${cluster.runs.map((row) => row.positionInLot).join(',')}`)

    expect(load?.channel).toBe('PlatenRFLoadCapacitor')
    expect(clusters(load?.runs ?? [])).toEqual(['6:4,5,6,7', '7:4,5,6', '8:7', '9:7,8'])
    expect(clusters(tuning?.runs ?? [])).toEqual(['6:8,9,10', '9:9,10'])
    expect(clusterByLot([])).toEqual([])
  })
})

describe('the clean lots in one line', () => {
  it('counts the wafers of the lots with nothing out of range', () => {
    expect(describeClean(summarize(publicRuns, lots).clean)).toBe('Lots 1 to 5 and 10: 60 wafers, none out of range.')
    expect(describeClean(summarize([run(3, 1, 0)], []).clean)).toBe('Lot 3: 1 wafer, none out of range.')
    expect(describeClean([])).toBeNull()
  })
})

describe('lots and wafers in words', () => {
  it('writes three or more in a row as a span', () => {
    expect(describeLots([8])).toBe('lot 8')
    expect(describeLots([9, 6, 7, 8])).toBe('lots 6 to 9')
    expect(describeLots([6, 7, 901])).toBe('lots 6, 7 and 901')
    expect(describeLots([1, 2, 3, 4, 5, 7, 8, 9, 10])).toBe('lots 1 to 5 and 7 to 10')
    expect(describeWafers([7])).toBe('wafer 7')
    expect(describeWafers([1, 2])).toBe('wafers 1 and 2')
  })
})

describe('run states and the table orders', () => {
  it('checks alignment before the score', () => {
    const failed = { ...run(1, 1, 3), alignment: 'FAILED' as const }

    expect(runState(failed)).toBe('failed')
    expect(runState(run(1, 2, 0, null))).toBe('unscored')
    expect(runState(run(1, 3, 2))).toBe('out')
    expect(runState(run(1, 4, 0))).toBe('in')
  })

  it('orders the public wafers most unusual first', () => {
    expect(sortRuns(publicRuns, 'z').slice(0, 2).map((row) => row.key)).toEqual(['Day_2024_08_01_Wafer_06', 'Day_2024_08_21_Wafer_10'])
    expect(sortRuns(publicRuns, 'out').slice(0, 15).every((row) => runState(row) === 'out')).toBe(true)
    expect(sortRuns(publicRuns, 'lot')[0]?.key).toBe(sortRuns(publicRuns, 'lot').find((row) => row.lotNo === 1 && row.positionInLot === 1)?.key)
  })
})

describe('lot drift on the runs page', () => {
  const drift6 = lotDriftSchema.parse(fixture('drift-6.json'))
  const drift21 = lotDriftSchema.parse(fixture('drift-21.json'))

  function answers(entries: ReadonlyArray<readonly [number, LotDriftAnswer]>): ReadonlyMap<number, LotDriftAnswer> {
    return new Map(entries)
  }

  it('lists the channels outside the band and says which lots have no drift data', () => {
    const summary = summarize(publicRuns, lots)
    const missing = summary.lots.filter((group) => group.lotId !== 6).map((group) => [group.lotId, { kind: 'missing' }] as const)
    const drift = summarizeDrift(summary.lots, answers([[6, { kind: 'ready', drift: drift6 }], ...missing]))

    expect(drift.lines.map((line) => line.text)).toEqual(Array(4).fill('outside the band in lot 6'))
    expect(drift.lines[0]?.channel).toBe('PlatenRFPeakToPeak')
    expect(drift.groups).toEqual([{ label: 'No drift data', lotNos: [1, 2, 3, 4, 5, 7, 8, 9, 10] }])
    expect(drift.loading).toEqual([])
    expect(drift.k).toBe(3)
    expect(describeDrift(drift)).toBe('4 channels are outside the band or heading out, by each lot\'s last wafer.')
  })

  it('answers the drift figure only once a lot has answered', () => {
    expect(describeDrift({ lines: [], groups: [], loading: [1, 2], k: null })).toBeNull()
    expect(describeDrift({ lines: [], groups: [{ label: 'No drift data', lotNos: [1] }], loading: [], k: null }))
      .toBe('No channel is outside the band or heading out, by each lot\'s last wafer.')
    expect(describeDrift({ lines: [{ channel: 'Pressure', text: 'heading out in lot 2' }], groups: [], loading: [], k: 3 }))
      .toBe('1 channel is outside the band or heading out, by each lot\'s last wafer.')
  })

  it('accounts for every simulated lot, the ones still loading included', () => {
    const summary = summarize(simulatedRuns, lots)
    const drift = summarizeDrift(summary.lots, answers([[21, { kind: 'ready', drift: drift21 }], [11, { kind: 'failed' }], [12, { kind: 'missing' }]]))

    expect(drift.lines).toHaveLength(6)
    expect(drift.groups).toEqual([{ label: 'No drift data', lotNos: [2] }, { label: 'Drift did not load', lotNos: [1] }])
    expect(drift.loading).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('says all lots when a channel is out in every one, and names the lots heading out', () => {
    const states = (state: 'OUT_OF_BAND' | 'WILL_EXIT' | 'NO_TREND' | 'INSUFFICIENT_RUNS'): LotDrift => ({
      ...drift6,
      channels: [{ ...drift6.channels[0]!, channel: 'PlatenRFTuningCapacitor', state }],
    })
    const runs = [run(1, 1, 0), run(2, 1, 0), run(3, 1, 0), run(4, 1, 0)]
    const summary = summarize(runs, [])
    const both = summarizeDrift(summary.lots.slice(0, 2), answers([[501, { kind: 'ready', drift: states('OUT_OF_BAND') }], [502, { kind: 'ready', drift: states('OUT_OF_BAND') }]]))
    const mixed = summarizeDrift(summary.lots, answers([
      [501, { kind: 'ready', drift: states('OUT_OF_BAND') }],
      [502, { kind: 'ready', drift: states('WILL_EXIT') }],
      [503, { kind: 'ready', drift: states('NO_TREND') }],
      [504, { kind: 'ready', drift: states('INSUFFICIENT_RUNS') }],
    ]))

    expect(both.lines).toEqual([{ channel: 'PlatenRFTuningCapacitor', text: 'outside the band in all 2 lots' }])
    expect(mixed.lines).toEqual([{ channel: 'PlatenRFTuningCapacitor', text: 'outside the band in lot 1; heading out in lot 2' }])
    expect(mixed.groups).toEqual([
      { label: 'No channel outside the band or heading out', lotNos: [3] },
      { label: 'Too few wafers to judge a trend', lotNos: [4] },
    ])
  })
})
