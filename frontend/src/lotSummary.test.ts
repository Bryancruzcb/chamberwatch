import { describe, expect, it } from 'vitest'
import { type DriftChannel, type DriftState, type Lot, lotDriftSchema, lotsSchema, type RunRow, runsPageSchema } from './api/schema'
import { describeLotScores, describeWaferKey, driftCounts, driftWarns, lotHeadline, lotLead, lotsAnswer } from './lotSummary'

const fixtures = import.meta.glob('../e2e/fixtures/*.json', { eager: true, import: 'default' })

function fixture(name: string): unknown {
  const key = `../e2e/fixtures/${name}`
  if (!(key in fixtures)) {
    throw new Error(`no fixture ${name}`)
  }
  return fixtures[key]
}

const lot6 = lotDriftSchema.parse(fixture('drift-6.json'))
const lots = lotsSchema.parse(fixture('lots.json'))
const publicLots = lots.filter((lot) => lot.source === 'PUBLIC')
const simulatedLots = lots.filter((lot) => lot.source === 'SYNTHETIC')
const publicRuns = runsPageSchema.parse(fixture('runs.json')).runs
const lot6Runs = publicRuns.filter((run) => run.lotNo === 6)
const lot1Runs = publicRuns.filter((run) => run.lotNo === 1)

/** Lot 6's channels with their verdicts replaced, in order, to reach the cases the captured lot does not have. */
function withStates(states: readonly DriftState[]): DriftChannel[] {
  return lot6.channels.slice(0, states.length).map((channel, index) => ({ ...channel, state: states[index] ?? channel.state }))
}

function lotOf(lotNo: number, runs: number, flaggedRuns: number): Lot {
  return { id: lotNo, source: 'PUBLIC', lotNo, runDate: null, conditioningCount: null, conditioningSurface: null, runs, flaggedRuns }
}

describe('the Lots page answer', () => {
  it('names the lots that hold every out-of-range run, then what the other lots ran', () => {
    expect(lotsAnswer(publicLots, true)).toEqual({
      title: 'Lots 6 to 9 hold all 15 out-of-range runs.',
      lead: 'The other 6 lots ran 60 wafers with none out of range.',
    })
    expect(lotsAnswer(simulatedLots, true)).toEqual({
      title: 'Lots 6, 7 and 901 hold all 8 out-of-range runs.',
      lead: 'The other 8 lots ran 24 wafers with none out of range.',
    })
  })

  it('speaks of one lot, and of one run, in the singular', () => {
    expect(lotsAnswer([lotOf(6, 10, 7), lotOf(7, 10, 0)], true)).toEqual({
      title: 'Lot 6 holds all 7 out-of-range runs.',
      lead: 'The other lot ran 10 wafers with none out of range.',
    })
    expect(lotsAnswer([lotOf(8, 10, 1), lotOf(9, 1, 0)], true)).toEqual({
      title: 'Lot 8 holds the one out-of-range run.',
      lead: 'The other lot ran 1 wafer with none out of range.',
    })
    expect(lotsAnswer([lotOf(6, 10, 7)], true)).toEqual({ title: 'Lot 6 holds all 7 out-of-range runs.', lead: null })
  })

  it('says so when every lot holds one, and when none does', () => {
    expect(lotsAnswer([lotOf(1, 10, 2), lotOf(2, 10, 1)], true)).toEqual({
      title: 'Lots 1 and 2 hold all 3 out-of-range runs.',
      lead: 'Every lot has at least one.',
    })
    expect(lotsAnswer(publicLots.map((lot) => ({ ...lot, flaggedRuns: 0 })), true))
      .toEqual({ title: 'None of the 10 lots has an out-of-range run.', lead: null })
    expect(lotsAnswer([lotOf(3, 10, 0)], true)).toEqual({ title: 'Lot 3 has no out-of-range run.', lead: null })
  })

  it('never calls a source with no baseline clean, and has a sentence for an empty source', () => {
    expect(lotsAnswer(publicLots, false)).toEqual({
      title: 'None of the 10 lots has been scored yet.',
      lead: 'There is no baseline yet, so no run has a score.',
    })
    expect(lotsAnswer([lotOf(1, 3, 0)], false).title).toBe('Lot 1 has not been scored yet.')
    expect(lotsAnswer([], true)).toEqual({ title: 'No lots yet.', lead: null })
    expect(lotsAnswer([], false)).toEqual({ title: 'No lots yet.', lead: null })
  })
})

describe('a lot page answer', () => {
  it('names the out-of-range wafers in the run page\'s words, keeping "Lot 6" on one line', () => {
    expect(lotHeadline(6, lot6Runs)).toBe('Wafers 4 to 10 of Lot 6 are out of range.')
    // public lot 8 has one out-of-range wafer of ten
    expect(lotHeadline(8, publicRuns.filter((run) => run.lotNo === 8))).toBe('Wafer 7 of Lot 8 is out of range.')
    expect(lotHeadline(6, lot6Runs.filter((run) => run.positionInLot > 3))).toBe('Every wafer of Lot 6 is out of range.')
  })

  it('says a lot is in range only when every wafer was scored in range', () => {
    expect(lotHeadline(1, lot1Runs)).toBe('Every wafer of Lot 1 is in range.')
    expect(lotHeadline(1, lot1Runs.map((run) => (run.positionInLot === 10 ? { ...run, alignment: 'FAILED' as const } : run))))
      .toBe('No wafer of Lot 1 is out of range.')
    expect(lotHeadline(6, lot6Runs.map((run) => ({ ...run, score: null })))).toBe('No wafer of Lot 6 has been scored yet.')
    expect(lotHeadline(6, [])).toBe('Lot 6 has no runs yet.')
  })

  it('speaks of a lot of one wafer as that wafer', () => {
    const one = (run: RunRow) => lotHeadline(run.lotNo, [run])
    const flagged = lot6Runs.find((run) => run.positionInLot === 4)
    const clean = lot1Runs[0]
    if (flagged === undefined || clean === undefined) {
      throw new Error('the fixture lacks lot 6 wafer 4 or lot 1 wafer 1')
    }

    expect(one(flagged)).toBe('Wafer 4 of Lot 6 is out of range.')
    expect(one(clean)).toBe('Wafer 1 of Lot 1 is in range.')
    expect(one({ ...clean, score: null })).toBe('Wafer 1 of Lot 1 was not scored.')
    expect(one({ ...clean, alignment: 'FAILED' })).toBe('Wafer 1 of Lot 1 could not be aligned.')
  })

  it('leads with the channels outside the band or heading out by the last wafer', () => {
    expect(lotLead({ runs: lot6Runs, channels: lot6.channels, phase: 'SF6' }))
      .toBe('By the last wafer, the SF6 mean of 4 channels is outside the band, and none is heading out.')
    expect(lotLead({ runs: lot6Runs, channels: withStates(['OUT_OF_BAND', 'WILL_EXIT', 'WILL_EXIT']), phase: 'C4F8' }))
      .toBe('By the last wafer, the C4F8 mean of 1 channel is outside the band, and 2 more are heading out.')
    expect(lotLead({ runs: lot6Runs, channels: withStates(['OUT_OF_BAND', 'WILL_EXIT']), phase: 'SF6' }))
      .toBe('By the last wafer, the SF6 mean of 1 channel is outside the band, and 1 more is heading out.')
    expect(lotLead({ runs: lot6Runs, channels: withStates(['WILL_EXIT', 'NO_TREND']), phase: 'SF6' }))
      .toBe("No channel's SF6 mean is outside the band yet; 1 channel is heading out.")
    expect(lotLead({ runs: lot1Runs, channels: withStates(['NO_TREND', 'STAYS_IN']), phase: 'SF6' }))
      .toBe("No channel's SF6 mean has left the band or is heading out.")
    expect(lotLead({ runs: lot1Runs, channels: [], phase: 'C4F8' })).toBe('No channel has a good-run band for this phase yet.')
  })

  it('says how the rest divide when some wafers were not scored or could not be aligned', () => {
    const unscored = (positions: readonly number[]) => (run: RunRow): RunRow => (positions.includes(run.positionInLot) ? { ...run, score: null } : run)
    const channels = withStates(['NO_TREND'])
    const quiet = " No channel's SF6 mean has left the band or is heading out."

    expect(lotLead({ runs: lot6Runs.map(unscored([1, 2])), channels, phase: 'SF6' }))
      .toBe(`Of the rest, 1 is in range and 2 were not scored.${quiet}`)
    expect(lotLead({ runs: lot1Runs.map((run) => (run.positionInLot === 10 ? { ...run, alignment: 'FAILED' as const } : run)), channels, phase: 'SF6' }))
      .toBe(`9 are in range and 1 could not be aligned.${quiet}`)
    expect(lotLead({ runs: lot1Runs.map(unscored([3])), channels, phase: 'SF6' })).toBe(`9 are in range and 1 was not scored.${quiet}`)
    // a lot nobody has scored already says so in its headline
    expect(lotLead({ runs: lot6Runs.map((run) => ({ ...run, score: null })), channels, phase: 'SF6' })).toBe(quiet.trim())
  })
})

describe('drift verdicts', () => {
  it('counts the channels in each verdict, out first, leaving out the verdicts none has', () => {
    expect(driftCounts(lot6.channels)).toEqual([
      { state: 'OUT_OF_BAND', count: 4 },
      { state: 'STAYS_IN', count: 10 },
      { state: 'NO_TREND', count: 17 },
    ])
    expect(driftCounts([])).toEqual([])
  })

  it('warns only for a channel past the band or heading out of it', () => {
    const states: readonly DriftState[] = ['OUT_OF_BAND', 'WILL_EXIT', 'STAYS_IN', 'NO_TREND', 'INSUFFICIENT_RUNS']

    expect(states.map((state) => driftWarns(state))).toEqual([true, true, false, false, false])
  })
})

describe('the lot table key', () => {
  const kinds = { inRange: true, outOfRange: true, unmeasured: false, missing: true, baseline: true }

  it('names only the marks the table holds, and how it marks the baseline', () => {
    expect(describeWaferKey(kinds, 3)).toBe('Filled: out of range. Ring: in range. Dash: not run. The bracket marks wafers 1 to 3, the baseline runs.')
    expect(describeWaferKey({ ...kinds, missing: false, unmeasured: true }, null))
      .toBe('Filled: out of range. Ring: in range. Dashed ring: not scored or not aligned. A centre dot marks a baseline run.')
    expect(describeWaferKey({ ...kinds, outOfRange: false, missing: false }, 1)).toBe('Ring: in range. The bracket marks wafer 1, the baseline runs.')
    expect(describeWaferKey({ inRange: false, outOfRange: false, unmeasured: true, missing: false, baseline: false }, null))
      .toBe('Dashed ring: not scored or not aligned.')
  })
})

describe('the lot scores answer', () => {
  it('names the highest score and the scale every line shares', () => {
    const top = lot6Runs.reduce((best, run) => ((run.score?.persistentZ ?? 0) > (best.score?.persistentZ ?? 0) ? run : best))

    expect(describeLotScores(lot6Runs, 6, 25, 0))
      .toBe(`The highest score is ${(top.score?.persistentZ ?? 0).toFixed(1)}, wafer ${top.positionInLot}. Each line runs from 0 to 25; the tick is the limit, 6.0.`)
    expect(describeLotScores(lot6Runs, 6, 20, 1)).toMatch(/, and 1 score runs past its end\.$/)
    expect(describeLotScores(lot6Runs, 6, 20, 2)).toMatch(/, and 2 scores run past its end\.$/)
    // a step change prints in full, not to a tenth
    expect(describeLotScores([{ ...top, score: top.score === null ? null : { ...top.score, persistentZ: 97795.1 } }], 6, 60, 1))
      .toMatch(/^The highest score is 97,795, wafer /)
  })

  it('says nothing for a lot with no score', () => {
    expect(describeLotScores(lot6Runs.map((run) => ({ ...run, score: null })), 6, 25, 0)).toBeNull()
    expect(describeLotScores([], 6, 25, 0)).toBeNull()
  })
})
