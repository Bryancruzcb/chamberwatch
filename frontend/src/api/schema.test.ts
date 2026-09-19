import { describe, expect, it } from 'vitest'
import { alignmentSchema, refreshSchema, runRowSchema, tracePointSchema } from './schema'

const row = {
  id: 55, key: 'Day_2024_08_01_Wafer_05', lotId: 6, lotNo: 6, positionInLot: 5, label: 'AUTO', alignment: 'ALIGNED',
  good: false,
}

describe('refreshSchema', () => {
  const result = { baselineId: 2, goodRuns: 31, fitted: true, scored: 96, flagged: 14, current: true }

  it('folds a refresh into what the page does next', () => {
    expect(refreshSchema.parse({ id: 7, source: 'PUBLIC', state: 'RUNNING', result: null, error: null }))
      .toEqual({ kind: 'running', id: 7 })
    expect(refreshSchema.parse({ id: 7, source: 'PUBLIC', state: 'DONE', result, error: null }))
      .toEqual({ kind: 'done', id: 7, result })
    expect(refreshSchema.parse({ id: 7, source: 'PUBLIC', state: 'FAILED', result: null, error: 'out of memory' }))
      .toEqual({ kind: 'failed', id: 7, message: 'out of memory' })
  })

  it('refuses a finished refresh without its result or its error', () => {
    expect(refreshSchema.safeParse({ id: 7, source: 'PUBLIC', state: 'DONE', result: null, error: null }).success).toBe(false)
    expect(refreshSchema.safeParse({ id: 7, source: 'PUBLIC', state: 'FAILED', result: null, error: null }).success).toBe(false)
  })
})

describe('runRowSchema', () => {
  it('folds the flag counts of a scored run into its score', () => {
    const parsed = runRowSchema.parse({
      ...row, scored: true, limitFlags: 25, deviationFlags: 0, stuckFlags: 0, persistentZ: 18.81,
      firstChannel: 'PlatenRFLoadCapacitor', firstTimeS: 407.2,
    })

    expect(parsed.score).toEqual({
      limitFlags: 25, deviationFlags: 0, stuckFlags: 0, persistentZ: 18.81, firstChannel: 'PlatenRFLoadCapacitor',
      firstTimeS: 407.2,
    })
  })

  it('gives a run not yet scored no score', () => {
    const parsed = runRowSchema.parse({
      ...row, scored: false, limitFlags: null, deviationFlags: null, stuckFlags: null, persistentZ: null, firstChannel: null,
      firstTimeS: null,
    })

    expect(parsed.score).toBeNull()
  })

  it('refuses a scored run without flag counts', () => {
    const parsed = runRowSchema.safeParse({
      ...row, scored: true, limitFlags: null, deviationFlags: null, stuckFlags: null, persistentZ: null, firstChannel: null,
      firstTimeS: null,
    })

    expect(parsed.success).toBe(false)
  })
})

describe('alignmentSchema', () => {
  const report = {
    status: 'ALIGNED', note: null, etchStartS: 30.2, etchEndS: 629.3, cycle1Sf6: true, c4f8Phases: 99, lastCycle: 100,
    onsetsDetected: 198, onsetsPredicted: 0, gapStartS: null, gapLengthS: null, gapInsideEtch: null, irregularCycles: [],
  }

  it('keeps only the reason for a failed run', () => {
    const failed = { ...report, status: 'FAILED', note: 'no C4F8 phase at etch power', etchStartS: null, etchEndS: null }

    expect(alignmentSchema.parse(failed)).toEqual({ kind: 'failed', note: 'no C4F8 phase at etch power' })
  })

  it('reads a run without a recording gap as having none', () => {
    const parsed = alignmentSchema.parse(report)

    expect(parsed.kind === 'aligned' && parsed.gap).toBeNull()
  })
})

describe('tracePointSchema', () => {
  it('has no recipe position outside the etch and keeps a band mean without a band', () => {
    const outside = tracePointSchema.parse({
      startS: 0, endS: 0.2, samples: 2, min: 85, max: 85, slot: null, cycle: null, phase: null, offset: null,
      bandMean: null, bandSd: null,
    })
    const constant = tracePointSchema.parse({
      startS: 30, endS: 30, samples: 1, min: 0, max: 0, slot: 0, cycle: 1, phase: 'SF6', offset: 0, bandMean: 0,
      bandSd: null,
    })

    expect(outside.position).toBeNull()
    expect(outside.band).toBeNull()
    expect(constant.position).toEqual({ slot: 0, cycle: 1, phase: 'SF6', offset: 0 })
    expect(constant.band).toEqual({ mean: 0, sd: null })
  })
})
