import { describe, expect, it } from 'vitest'
import { type DriftChannel, type DriftState, lotDriftSchema, runsPageSchema } from './api/schema'
import { describeLot, driftCounts } from './lotSummary'

const fixtures = import.meta.glob('../e2e/fixtures/*.json', { eager: true, import: 'default' })

function fixture(name: string): unknown {
  const key = `../e2e/fixtures/${name}`
  if (!(key in fixtures)) {
    throw new Error(`no fixture ${name}`)
  }
  return fixtures[key]
}

const lot6 = lotDriftSchema.parse(fixture('drift-6.json'))
const lot6Runs = runsPageSchema.parse(fixture('runs.json')).runs.filter((run) => run.lotNo === 6)

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

  it('says so when no wafer of the lot is out of range', () => {
    const lot1 = runsPageSchema.parse(fixture('runs.json')).runs.filter((run) => run.lotNo === 1)

    expect(describeLot({ runs: lot1, channels: [], phase: 'SF6' })).toMatch(/^None of its 10 wafers is out of range\./)
  })
})
