import { describe, expect, it } from 'vitest'
import type { Excursion, TracePoint } from '../api/schema'
import { bandSegments, envelopeSegments, excursionSpans, nearestIndex, traceExtent } from './trace'

function bucket({ at, min, max = min, band = null }: { at: number; min: number; max?: number; band?: TracePoint['band'] }): TracePoint {
  return { startS: at, endS: at, samples: min === max ? 1 : 2, min, max, position: null, band }
}

describe('envelopeSegments', () => {
  it('keeps the full height of a one-sample spike', () => {
    const segments = envelopeSegments([bucket({ at: 0, min: 10 }), bucket({ at: 0.2, min: 10, max: 50 }), bucket({ at: 0.4, min: 11 })])

    expect(segments).toEqual([[[0, 10], [0.2, 10], [0.2, 50], [0.4, 11]]])
  })

  it('enters a bucket from whichever end is nearer', () => {
    const segments = envelopeSegments([bucket({ at: 0, min: 60 }), bucket({ at: 0.2, min: 10, max: 50 })])

    expect(segments).toEqual([[[0, 60], [0.2, 50], [0.2, 10]]])
  })

  it('breaks the line at a recording gap', () => {
    const segments = envelopeSegments([bucket({ at: 0, min: 1 }), bucket({ at: 0.2, min: 1 }), bucket({ at: 41.3, min: 2 })])

    expect(segments).toEqual([[[0, 1], [0.2, 1]], [[41.3, 2]]])
  })
})

describe('bandSegments', () => {
  it('draws the band only where the slot has one', () => {
    const points = [
      bucket({ at: 0, min: 10, band: { mean: 10, sd: 1 } }),
      bucket({ at: 0.2, min: 10, band: { mean: 10, sd: null } }),
      bucket({ at: 0.4, min: 12, band: { mean: 12, sd: 1 } }),
    ]

    expect(bandSegments(points, 6)).toEqual([
      [{ time: 0, low: 4, high: 16, mean: 10 }],
      [{ time: 0.4, low: 6, high: 18, mean: 12 }],
    ])
    expect(bandSegments(points, null)).toEqual([])
  })
})

describe('traceExtent', () => {
  it('spans the readings and the band means but not the band edges', () => {
    const extent = traceExtent([bucket({ at: 30, min: 10, max: 12, band: { mean: 30, sd: 50 } }), bucket({ at: 31, min: 11 })])

    expect(extent).toEqual({ time: [30, 31], value: [10, 30] })
    expect(traceExtent([])).toBeNull()
  })
})

describe('excursionSpans', () => {
  it('leaves out an excursion without record times', () => {
    const timed: Excursion = {
      channel: 'Pressure', startSlot: 2520, confirmSlot: 2524, endSlot: 2526, cycle: 64, phase: 'SF6', offset: 0,
      startTimeS: 407.2, confirmTimeS: 408, endTimeS: 408.4, outSamples: 7, peakZ: -8.6,
    }

    expect(excursionSpans([timed, { ...timed, startTimeS: null }])).toEqual([{ start: 407.2, end: 408.4, excursion: timed }])
  })
})

describe('nearestIndex', () => {
  it('finds the bucket closest in time', () => {
    const points = [0, 0.2, 0.4, 0.6].map((at) => bucket({ at, min: at }))

    expect(nearestIndex(points, 0.29)).toBe(1)
    expect(nearestIndex(points, 0.31)).toBe(2)
    expect(nearestIndex(points, 9)).toBe(3)
    expect(nearestIndex([], 1)).toBeNull()
  })
})
