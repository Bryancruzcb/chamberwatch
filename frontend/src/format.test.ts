import { describe, expect, it } from 'vitest'
import { formatScore, formatSeconds, formatValue, MISSING } from './format'

describe('format', () => {
  it('prints readings to four significant digits', () => {
    expect(formatValue(85.04593)).toBe('85.05')
    expect(formatValue(2790)).toBe('2,790')
    expect(formatValue(0.00183)).toBe('0.00183')
  })

  it('prints scores and times to one decimal', () => {
    expect(formatScore(18.81044)).toBe('18.8')
    expect(formatSeconds(407.2)).toBe('407.2 s')
  })

  it('marks a missing value', () => {
    expect(formatValue(null)).toBe(MISSING)
    expect(formatScore(null)).toBe(MISSING)
    expect(formatSeconds(null)).toBe(MISSING)
  })
})
