import { describe, expect, it } from 'vitest'
import {
  driftVsDepthSchema,
  isFlagged,
  lotDriftSchema,
  lotsSchema,
  measurementsSchema,
  runDetailSchema,
  runsPageSchema,
  traceSchema,
} from './schema'

// Responses captured from the real API on the public data, the same ones the end-to-end tests serve. The pages read
// these shapes, so each one must parse.
const fixtures = import.meta.glob('../../e2e/fixtures/*.json', { eager: true, import: 'default' })

function fixture(name: string): unknown {
  const key = `../../e2e/fixtures/${name}`
  if (!(key in fixtures)) {
    throw new Error(`no fixture ${name}`)
  }
  return fixtures[key]
}

describe('captured API responses', () => {
  it.each([
    ['lots.json', lotsSchema],
    ['runs.json', runsPageSchema],
    ['run-55.json', runDetailSchema],
    ['run-11.json', runDetailSchema],
    ['runs-synthetic.json', runsPageSchema],
    ['run-133.json', runDetailSchema],
    ['run-136.json', runDetailSchema],
    ['drift-vs-depth-synthetic.json', driftVsDepthSchema],
    ['trace-55.json', traceSchema],
    ['trace-133.json', traceSchema],
    ['trace-136.json', traceSchema],
    ['measurements-55.json', measurementsSchema],
    ['measurements-55-nine.json', measurementsSchema],
    ['drift-6.json', lotDriftSchema],
    ['drift-21.json', lotDriftSchema],
    ['drift-vs-depth.json', driftVsDepthSchema],
  ] as const)('%s parses', (name, schema) => {
    const parsed = schema.safeParse(fixture(name))

    expect(parsed.error?.issues ?? []).toEqual([])
  })

  it('count the 15 flagged public wafers', () => {
    const page = runsPageSchema.parse(fixture('runs.json'))

    expect(page.runs).toHaveLength(96)
    expect(page.runs.filter((run) => isFlagged(run.score))).toHaveLength(15)
  })

  it('count the 40 simulated wafers, 8 flagged, and carry the fault put into wafer 7 of lot 901', () => {
    const page = runsPageSchema.parse(fixture('runs-synthetic.json'))
    const run = runDetailSchema.parse(fixture('run-133.json'))

    expect(page.runs).toHaveLength(40)
    expect(page.runs.filter((run) => isFlagged(run.score))).toHaveLength(8)
    expect(run.source).toBe('SYNTHETIC')
    expect(run.injectedFault?.kind).toBe('GAS_FLOW_STUCK_LOW')
    expect(run.injectedFault?.channel).toBe('Gas5Flow')
    expect(run.injectedFault?.durationS).toBeNull()
    expect(run.assessment?.firstChannel).toBe('Gas5Flow')
    // the knock-on: the foreline fell with the missing flow and ranks right behind it
    expect(run.channels[1]?.channel).toBe('ForeLinePressure')
    expect(run.channels[1]?.excursions.length).toBeGreaterThan(0)
    expect(runDetailSchema.parse(fixture('run-55.json')).injectedFault).toBeNull()
    expect(run.measuredDepth).toEqual([])
  })

  it('carry the measured depth of the flagged public wafer, 0.31 µm shallower than its lot began', () => {
    const [deep, nine] = runDetailSchema.parse(fixture('run-55.json')).measuredDepth

    expect(deep?.set).toBe('EIGHTY_NINE_POINT')
    expect(deep?.points).toBe(89)
    expect(deep?.meanDepthUm).toBeCloseTo(43.691, 3)
    expect(deep?.lossUm).toBeCloseTo(0.313, 3)
    expect(nine?.set).toBe('NINE_POINT')
    expect(nine?.lossUm).toBeCloseTo(0.288, 3)
  })

  it('carry the stuck sensor of wafer 10 of lot 901 as a hold the rule caught', () => {
    const run = runDetailSchema.parse(fixture('run-136.json'))

    expect(run.injectedFault?.kind).toBe('SENSOR_STUCK')
    expect(run.injectedFault?.channel).toBe('HeliumBPPressure')
    expect(run.assessment?.stuckFlags).toBe(1)
    expect(run.assessment?.firstChannel).toBe('HeliumBPPressure')
    expect(run.channels[0]?.holds).toHaveLength(1)
    expect(run.channels[0]?.longestHold).toBe(34)
    expect(runDetailSchema.parse(fixture('run-55.json')).assessment?.stuckFlags).toBe(0)
  })

  it('put the tuning capacitor first in lot 6, out of the band, with no fit at the first wafer', () => {
    const drift = lotDriftSchema.parse(fixture('drift-6.json'))
    const first = drift.channels[0]

    expect(first?.channel).toBe('PlatenRFTuningCapacitor')
    expect(first?.state).toBe('OUT_OF_BAND')
    expect(first?.points[0]?.fit).toBeNull()
    expect(first?.points[1]?.fit?.tStat).toBeNull()
  })
})
