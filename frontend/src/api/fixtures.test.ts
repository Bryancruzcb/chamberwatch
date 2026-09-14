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
    ['trace-55.json', traceSchema],
    ['measurements-55.json', measurementsSchema],
    ['measurements-55-nine.json', measurementsSchema],
    ['drift-6.json', lotDriftSchema],
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

  it('put the tuning capacitor first in lot 6, out of the band, with no fit at the first wafer', () => {
    const drift = lotDriftSchema.parse(fixture('drift-6.json'))
    const first = drift.channels[0]

    expect(first?.channel).toBe('PlatenRFTuningCapacitor')
    expect(first?.state).toBe('OUT_OF_BAND')
    expect(first?.points[0]?.fit).toBeNull()
    expect(first?.points[1]?.fit?.tStat).toBeNull()
  })
})
