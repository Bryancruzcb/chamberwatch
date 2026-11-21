import { describe, expect, it } from 'vitest'
import { linearScale, niceInterval, niceTicks, roundUpTo, scoreLineEnd, spreadLabels, timeLineEnd, verdictEnd } from './scale'

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
