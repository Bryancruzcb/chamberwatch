import { describe, expect, it } from 'vitest'
import type { Excursion, TracePoint } from '../api/schema'
import { linearScale } from './scale'
import { bandSegments, bucketsIn, clips, envelopeOutlines, excursionSpans, fitTraceDomain, nearestIndex, railMark, spansIn, traceExtent } from './trace'

function bucket({ at, min, max = min, band = null }: { at: number; min: number; max?: number; band?: TracePoint['band'] }): TracePoint {
  return { startS: at, endS: at, samples: min === max ? 1 : 2, min, max, position: null, band }
}

describe('envelopeOutlines', () => {
  it("runs along each bucket's highest value and back along its lowest, so a one-sample spike keeps its height", () => {
    const outlines = envelopeOutlines([bucket({ at: 0, min: 10 }), bucket({ at: 0.2, min: 10, max: 50 }), bucket({ at: 0.4, min: 11 })])

    expect(outlines).toEqual([[[0, 10], [0.2, 50], [0.4, 11], [0.4, 11], [0.2, 10], [0, 10]]])
  })

  it('breaks the outline at a recording gap', () => {
    const outlines = envelopeOutlines([bucket({ at: 0, min: 1 }), bucket({ at: 0.2, min: 1 }), bucket({ at: 41.3, min: 2, max: 3 })])

    expect(outlines).toEqual([[[0, 1], [0.2, 1], [0.2, 1], [0, 1]], [[41.3, 3], [41.3, 2]]])
    expect(envelopeOutlines([])).toEqual([])
  })
})

describe('spansIn', () => {
  it('keeps the spans that overlap the drawn time range, edges included, in their order', () => {
    const spans = [{ start: 1, end: 2 }, { start: 9, end: 10.5 }, { start: 12, end: 13 }, { start: 30, end: 31 }]

    expect(spansIn(spans, [10, 20])).toEqual([{ start: 9, end: 10.5 }, { start: 12, end: 13 }])
    expect(spansIn(spans, [2, 9])).toEqual([{ start: 1, end: 2 }, { start: 9, end: 10.5 }])
    expect(spansIn(spans, [14, 29])).toEqual([])
  })
})

describe('railMark', () => {
  const x = linearScale([10, 20], [50, 150])

  it('maps a span inside the view to pixels', () => {
    expect(railMark({ start: 12, end: 14 }, x, 2.5)).toEqual({ x: 70, width: 20 })
  })

  it('cuts a span that runs past either edge at the plot', () => {
    expect(railMark({ start: 8, end: 11 }, x, 2.5)).toEqual({ x: 50, width: 10 })
    expect(railMark({ start: 19, end: 40 }, x, 2.5)).toEqual({ x: 140, width: 10 })
    expect(railMark({ start: 0, end: 40 }, x, 2.5)).toEqual({ x: 50, width: 100 })
  })

  it('keeps a mark at least the narrowest width, still inside the plot', () => {
    expect(railMark({ start: 15, end: 15 }, x, 2.5)).toEqual({ x: 100, width: 2.5 })
    expect(railMark({ start: 20, end: 20 }, x, 2.5)).toEqual({ x: 147.5, width: 2.5 })
  })
})

describe('bucketsIn', () => {
  it('keeps the buckets an excursion touches, edges included', () => {
    const points = [0, 0.2, 0.4, 0.6].map((at) => bucket({ at, min: at }))

    expect(bucketsIn(points, { start: 0.2, end: 0.4 }).map((point) => point.startS)).toEqual([0.2, 0.4])
    expect(bucketsIn(points, { start: 0.25, end: 0.3 })).toEqual([])
  })
})

describe('fitTraceDomain', () => {
  // a start-up ramp: the reading climbs from 5 while the good runs disagree so much the band is 120 wide, then it
  // settles near 90 inside a band 12 wide
  const ramp = [
    bucket({ at: 0, min: 5, band: { mean: 10, sd: 10 } }),
    bucket({ at: 0.2, min: 40, band: { mean: 45, sd: 10 } }),
    ...[0.4, 0.6, 0.8, 1, 1.2, 1.4].map((at) => bucket({ at, min: 88, max: 92, band: { mean: 90, sd: 1 } })),
  ]

  it('fits the reading and the band from where the reading sits inside a settled band', () => {
    const fit = fitTraceDomain(ramp, 6)

    expect(fit.from).toBe(2)
    // 84 to 96, padded 5 percent and rounded out to tidy ticks
    expect(fit.domain).toEqual([82, 98])
  })

  it('fits everything when the reading never enters the band', () => {
    const away = ramp.map((point) => ({ ...point, min: point.min + 200, max: point.max + 200 }))
    const fit = fitTraceDomain(away, 6)

    expect(fit.from).toBe(0)
    expect(fit.domain[0]).toBeLessThanOrEqual(84)
    expect(fit.domain[1]).toBeGreaterThanOrEqual(292)
  })

  it('leaves a ballooning band out of the fit wherever it comes', () => {
    const switching = [...ramp, bucket({ at: 1.6, min: 90, band: { mean: 90, sd: 500 } })]

    expect(fitTraceDomain(switching, 6).domain).toEqual([82, 98])
  })

  it('fits the reading alone when there is no band, and copes with no buckets', () => {
    const plain = [bucket({ at: 0, min: 10 }), bucket({ at: 0.2, min: 20 })]

    expect(fitTraceDomain(plain, null)).toEqual({ domain: [8, 22], from: 0 })
    expect(fitTraceDomain([], 6)).toEqual({ domain: [0, 1], from: null })
  })
})

describe('clips', () => {
  it('names a ramp cut off at the start by where it ends and where it began', () => {
    const points = [bucket({ at: 0, min: 6.9 }), bucket({ at: 0.2, min: 40 }), bucket({ at: 0.4, min: 70 }), bucket({ at: 0.6, min: 90 })]

    expect(clips(points, [60, 100])).toEqual([{ side: 'below', edge: 60, atStart: true, untilS: 0.2, value: 6.9, atS: 0, stretches: 1 }])
  })

  it('counts separate stretches past an edge and finds the most extreme value', () => {
    const points = [bucket({ at: 0, min: 90 }), bucket({ at: 0.2, min: 90, max: 105 }), bucket({ at: 0.4, min: 90 }), bucket({ at: 0.6, min: 90, max: 112 })]

    expect(clips(points, [60, 100])).toEqual([{ side: 'above', edge: 100, atStart: false, untilS: 0.6, value: 112, atS: 0.6, stretches: 2 }])
  })

  it('finds nothing to note when the reading fits', () => {
    expect(clips([bucket({ at: 0, min: 70, max: 80 })], [60, 100])).toEqual([])
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
