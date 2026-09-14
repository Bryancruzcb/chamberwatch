import { describe, expect, it } from 'vitest'
import { linearScale, niceInterval, niceTicks } from './scale'

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
