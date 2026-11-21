import { describe, expect, it } from 'vitest'
import { type DriftChannel, type DriftState, lotDriftSchema, type RunRow, runsPageSchema } from './api/schema'
import { describeLot, describeLotWafers, driftCounts } from './lotSummary'

const fixtures = import.meta.glob('../e2e/fixtures/*.json', { eager: true, import: 'default' })

function fixture(name: string): unknown {
  const key = `../e2e/fixtures/${name}`
  if (!(key in fixtures)) {
    throw new Error(`no fixture ${name}`)
  }
  return fixtures[key]
}

const lot6 = lotDriftSchema.parse(fixture('drift-6.json'))
const publicRuns = runsPageSchema.parse(fixture('runs.json')).runs
const lot6Runs = publicRuns.filter((run) => run.lotNo === 6)
const lot1Runs = publicRuns.filter((run) => run.lotNo === 1)

/** Lot 6's channels with their verdicts replaced, in order, to reach the cases the captured lot does not have. */
function withStates(states: readonly DriftState[]): DriftChannel[] {
  return lot6.channels.slice(0, states.length).map((channel, index) => ({ ...channel, state: states[index] ?? channel.state }))
}

describe('lot summary', () => {
  it('counts the channels in each drift verdict, out first, leaving out the verdicts none has', () => {
    expect(driftCounts(lot6.channels)).toEqual([
      { state: 'OUT_OF_BAND', count: 4 },
      { state: 'STAYS_IN', count: 10 },
      { state: 'NO_TREND', count: 17 },
    ])
    expect(driftCounts([])).toEqual([])
  })

  it('answers with the out-of-range wafers and the channels outside the band or heading out', () => {
    expect(describeLot({ runs: lot6Runs, channels: lot6.channels, phase: 'SF6' })).toBe(
      '7 of 10 wafers are out of range: wafers 4 to 10. By the last wafer, the SF6 mean of 4 channels is outside the band, and none is heading out.',
    )
    expect(describeLot({ runs: lot6Runs, channels: withStates(['OUT_OF_BAND', 'WILL_EXIT', 'WILL_EXIT']), phase: 'C4F8' }))
      .toContain('By the last wafer, the C4F8 mean of 1 channel is outside the band, and 2 more are heading out.')
    expect(describeLot({ runs: lot6Runs, channels: withStates(['WILL_EXIT', 'NO_TREND']), phase: 'SF6' }))
      .toContain("No channel's SF6 mean is outside the band yet; 1 channel is heading out.")
    expect(describeLot({ runs: lot6Runs, channels: withStates(['NO_TREND', 'STAYS_IN']), phase: 'SF6' }))
      .toContain("No channel's SF6 mean has left the band or is heading out.")
  })

  it('says so when no wafer of the lot is out of range, and when the phase has no band to judge channels by', () => {
    expect(describeLot({ runs: lot1Runs, channels: withStates(['NO_TREND']), phase: 'SF6' }))
      .toBe("None of its 10 wafers is out of range. No channel's SF6 mean has left the band or is heading out.")
    expect(describeLot({ runs: lot1Runs, channels: [], phase: 'C4F8' }))
      .toBe('None of its 10 wafers is out of range. No channel has a good-run band for this phase yet.')
  })

  it('keeps the verb with the count: one wafer is, several are', () => {
    // public lot 8 has one out-of-range wafer of ten
    expect(describeLotWafers(publicRuns.filter((run) => run.lotNo === 8))).toBe('1 of 10 wafers is out of range: wafer 7.')
    expect(describeLotWafers(lot6Runs)).toBe('7 of 10 wafers are out of range: wafers 4 to 10.')
  })

  it('speaks of a lot of one wafer as one wafer', () => {
    const one = (run: RunRow) => describeLotWafers([run])
    const flagged = lot6Runs.find((run) => run.positionInLot === 4)
    const clean = lot1Runs[0]
    if (flagged === undefined || clean === undefined) {
      throw new Error('the fixture lacks lot 6 wafer 4 or lot 1 wafer 1')
    }

    expect(one(flagged)).toBe('Its one wafer is out of range.')
    expect(one(clean)).toBe('Its one wafer is in range.')
    expect(one({ ...clean, score: null })).toBe('Its one wafer has not been scored yet.')
    expect(one({ ...clean, alignment: 'FAILED' })).toBe('Its one wafer could not be aligned.')
  })

  it('never counts a wafer that was not scored or not aligned as in range', () => {
    const unscored = (positions: readonly number[]) => (run: RunRow): RunRow => (positions.includes(run.positionInLot) ? { ...run, score: null } : run)

    // a lot before any baseline exists
    expect(describeLotWafers(lot6Runs.map((run) => ({ ...run, score: null })))).toBe('None of its 10 wafers has been scored yet.')
    expect(describeLotWafers(lot6Runs.map(unscored([1, 2]))))
      .toBe('7 of 10 wafers are out of range: wafers 4 to 10. Of the rest, 1 is in range and 2 were not scored.')
    expect(describeLotWafers(lot1Runs.map((run) => (run.positionInLot === 10 ? { ...run, alignment: 'FAILED' as const } : run))))
      .toBe('None of its 10 wafers is out of range: 9 are in range and 1 could not be aligned.')
    expect(describeLotWafers(lot1Runs.map(unscored([3]))))
      .toBe('None of its 10 wafers is out of range: 9 are in range and 1 was not scored.')
    expect(describeLotWafers([])).toBe('None of its 0 wafers has been scored yet.')
  })
})
