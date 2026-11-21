import { describe, expect, it } from 'vitest'
import {
  endClearsLimit, linearScale, niceInterval, niceTicks, roundUpTo, scoreLineEnd, spreadLabels, startClearsLimit, tickFormat, timeAxisLabels, timeLineEnd,
  verdictEnd,
} from './scale'

describe('endClearsLimit', () => {
  it("keeps the end's label only where it sits at least the gap clear of the limit's centred label", () => {
    // run 11's lineup: the limit 6.0 at 60% of a 10 scale; "10" is 14.4px
    expect(endClearsLimit(133, 0.6, 'limit 6.0', '10', 12, 8)).toBe(false)
    expect(endClearsLimit(362, 0.6, 'limit 6.0', '10', 12, 8)).toBe(true)
    // run 55's: the limit at 30% of a 20 scale leaves the end plenty of room
    expect(endClearsLimit(129.7, 0.3, 'limit 6.0', '20', 12, 8)).toBe(true)
    // the edge: 14.4 + 8 = 0.4 * w - 32.4 at w = 137
    expect(endClearsLimit(136.9, 0.6, 'limit 6.0', '10', 12, 8)).toBe(false)
    expect(endClearsLimit(137.1, 0.6, 'limit 6.0', '10', 12, 8)).toBe(true)
    // run 133's: a limit near 0 sets its label rightward from the limit, so all of it counts
    expect(endClearsLimit(129.7, 0.1, 'limit 6.0', '60+', 12, 8, false)).toBe(true)
    expect(endClearsLimit(100, 0.1, 'limit 6.0', '60+', 12, 8, false)).toBe(false)
  })
})

describe('tickFormat', () => {
  it('prints every tick of an axis with the decimals its step needs, and no more', () => {
    const tenths = niceTicks([27.02, 27.68], 5)
    expect(tenths.map(tickFormat(tenths))).toEqual(['27.1', '27.2', '27.3', '27.4', '27.5', '27.6'])
    expect([0, 20, 40, 140].map(tickFormat([0, 20, 40]))).toEqual(['0', '20', '40', '140'])
    expect([0.6, 0.8, 1, 1.2, 1.4].map(tickFormat([0.6, 0.8, 1]))).toEqual(['0.6', '0.8', '1.0', '1.2', '1.4'])
    expect([0, 0.05, 0.1].map(tickFormat([0, 0.05, 0.1]))).toEqual(['0.00', '0.05', '0.10'])
    expect([2000, 4000].map(tickFormat([2000, 4000]))).toEqual(['2,000', '4,000'])
  })

  it('takes the step from the first two ticks, through the binary noise of a sum', () => {
    expect([0.2, 0.30000000000000004].map(tickFormat([0.2, 0.30000000000000004]))).toEqual(['0.2', '0.3'])
  })

  it('prints a lone tick as it is', () => {
    expect(tickFormat([27.25])(27.25)).toBe('27.25')
    expect(tickFormat([])(5)).toBe('5')
  })
})

describe('startClearsLimit', () => {
  it("keeps the 0 only where it sits at least the gap clear of the limit's centred label", () => {
    // run 55's lineup: the limit 6.0 at 30% of a 20 scale; "0" is 7.2px and "limit 6.0" 64.8px in 12px mono
    expect(startClearsLimit(129.7, 0.3, 'limit 6.0', 12, 8)).toBe(false)
    expect(startClearsLimit(133, 0.3, 'limit 6.0', 12, 8)).toBe(false)
    expect(startClearsLimit(362, 0.3, 'limit 6.0', 12, 8)).toBe(true)
    // the edge: 7.2 + 8 = 0.3 * w - 32.4 at w = 158.67
    expect(startClearsLimit(158.6, 0.3, 'limit 6.0', 12, 8)).toBe(false)
    expect(startClearsLimit(158.7, 0.3, 'limit 6.0', 12, 8)).toBe(true)
    expect(startClearsLimit(0, 0.3, 'limit 6.0', 12, 8)).toBe(false)
  })
})

describe('linearScale', () => {
  it('maps the domain onto the range and back', () => {
    const scale = linearScale([0, 600], [40, 1240])

    expect(scale.map(0)).toBe(40)
    expect(scale.map(600)).toBe(1240)
    expect(scale.invert(scale.map(407.2))).toBeCloseTo(407.2, 9)
  })

  it('maps onto a flipped range for a y axis', () => {
    const scale = linearScale([80, 100], [300, 20])

    expect(scale.map(80)).toBe(300)
    expect(scale.map(100)).toBe(20)
  })

  it('draws a flat channel mid-plot', () => {
    expect(linearScale([2790, 2790], [300, 20]).map(2790)).toBeCloseTo(160, 9)
  })
})

describe('niceTicks', () => {
  it('steps by 1, 2 or 5 times a power of ten', () => {
    expect(niceTicks([0, 629.3], 6)).toEqual([0, 100, 200, 300, 400, 500, 600])
    expect(niceTicks([0.02, 0.14], 5)).toEqual([0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.14])
  })

  it('accepts the interval in either order', () => {
    expect(niceTicks([100, 80], 4)).toEqual(niceTicks([80, 100], 4))
  })
})

describe('niceInterval', () => {
  it('grows outward to round values', () => {
    expect(niceInterval([85.04, 97.2], 5)).toEqual([84, 98])
  })
})

describe('the ends of the score and time lines', () => {
  it('rounds up to the next step and never ends at 0', () => {
    expect(roundUpTo(24.9, 5)).toBe(25)
    expect(roundUpTo(25, 5)).toBe(25)
    expect(roundUpTo(25.01, 5)).toBe(30)
    expect(roundUpTo(0, 5)).toBe(5)
    expect(roundUpTo(551.4, 100)).toBe(600)
  })

  it('ends a score line past the largest score and past the limit', () => {
    expect(scoreLineEnd([12.3, 24.9, 9.6], 6)).toEqual({ end: 25, past: 0 })
    // every score under the limit: the line still reaches past it, so the tick shows
    expect(scoreLineEnd([3.1, 4.2], 6)).toEqual({ end: 10, past: 0 })
    expect(scoreLineEnd([], 6)).toEqual({ end: 10, past: 0 })
    expect(scoreLineEnd([], null)).toEqual({ end: 5, past: 0 })
  })

  it('stops a score line at ten limits and counts what runs past it', () => {
    // the simulated lot 901 holds a step change at 97,795
    expect(scoreLineEnd([9.4, 32.5, 97795.1, 9805.6], 6)).toEqual({ end: 60, past: 2 })
    expect(scoreLineEnd([97795.1], null)).toEqual({ end: 97800, past: 0 })
  })

  it('ends a time line at the next 100 s', () => {
    expect(timeLineEnd([537, 407.2, 551.4])).toBe(600)
    expect(timeLineEnd([600])).toBe(600)
    expect(timeLineEnd([])).toBe(100)
  })

  it('ends the verdict line at four limits or past the score, and stops it at ten limits', () => {
    expect(verdictEnd(18.8, 6)).toBe(25)
    expect(verdictEnd(3.6, 6)).toBe(25)
    expect(verdictEnd(27, 6)).toBe(30)
    expect(verdictEnd(97795, 6)).toBe(60)
    expect(verdictEnd(4, 0)).toBe(5)
  })
})

describe('spreadLabels', () => {
  it('leaves labels that are far enough apart where they are', () => {
    expect(spreadLabels([40, 120, 80], 30, 0, 200)).toEqual([40, 120, 80])
  })

  it('moves the lower of two colliding labels down, keeping the order they came in', () => {
    // the 89-point line ends at 0.90 just above the 9-point line's 0.84
    expect(spreadLabels([52, 40], 34, 0, 200)).toEqual([74, 40])
    expect(spreadLabels([100, 100, 100], 20, 0, 400)).toEqual([100, 120, 140])
  })

  it('pushes labels back up from the bottom edge and keeps them under the top one', () => {
    expect(spreadLabels([190, 195], 30, 0, 200)).toEqual([170, 200])
    expect(spreadLabels([-10, 5], 30, 0, 200)).toEqual([0, 30])
  })

  it('keeps the gap when there is not room, letting the last label run past the bottom', () => {
    expect(spreadLabels([10, 20, 30], 40, 0, 50)).toEqual([0, 40, 80])
    expect(spreadLabels([], 30, 0, 100)).toEqual([])
  })
})

describe('timeAxisLabels', () => {
  it('prints the unit with the last tick only, and centres each label on its mark', () => {
    const labels = timeAxisLabels([{ x: 100, text: '100' }, { x: 200, text: '200' }, { x: 300, text: '300' }], 's', 12, 400)
    expect(labels).toEqual([
      { x: 100, text: '100', anchor: 'middle' },
      { x: 200, text: '200', anchor: 'middle' },
      { x: 300, text: '300 s', anchor: 'middle' },
    ])
  })

  it('ends a label on its mark when, centred, it would pass the end of the axis', () => {
    // "700 s" is 36px of 12px mono, so centred at 330 it reaches 348
    expect(timeAxisLabels([{ x: 330, text: '700' }], 's', 12, 348)).toEqual([{ x: 330, text: '700 s', anchor: 'middle' }])
    expect(timeAxisLabels([{ x: 331, text: '700' }], 's', 12, 348)).toEqual([{ x: 331, text: '700 s', anchor: 'end' }])
    expect(timeAxisLabels([{ x: 348, text: '700' }], 's', 12, 348)).toEqual([{ x: 348, text: '700 s', anchor: 'end' }])
  })

  it('leaves a label out, keeping its mark, where it would run into the longer last one', () => {
    // at 320px the timeline's 600 and 700 sit 49px apart; "700 s" ending on its mark reaches back to 600's label
    const labels = timeAxisLabels([{ x: 190, text: '500' }, { x: 239, text: '600' }, { x: 288, text: '700' }], 's', 12, 288)
    expect(labels.map((label) => label.text)).toEqual(['500', '', '700 s'])
    expect(labels.map((label) => label.x)).toEqual([190, 239, 288])
    // with room for a character between them, both stay
    expect(timeAxisLabels([{ x: 200, text: '600' }, { x: 300, text: '700' }], 's', 12, 400).map((label) => label.text)).toEqual(['600', '700 s'])
  })

  it('has nothing to label on an axis with no ticks', () => {
    expect(timeAxisLabels([], 's', 12, 300)).toEqual([])
  })
})
