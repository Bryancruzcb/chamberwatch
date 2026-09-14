import { describe, expect, it } from 'vitest'
import { binIndex } from './sequential'

describe('binIndex', () => {
  it('splits the range into equal steps and clamps the ends', () => {
    expect(binIndex(40, [40, 52], 6)).toBe(0)
    expect(binIndex(46, [40, 52], 6)).toBe(3)
    expect(binIndex(52, [40, 52], 6)).toBe(5)
    expect(binIndex(60, [40, 52], 6)).toBe(5)
  })

  it('puts every value of a flat range in the first step', () => {
    expect(binIndex(41, [41, 41], 6)).toBe(0)
  })
})
