import { describe, expect, it } from 'vitest'
import { formatConditioning, formatDate, formatMicrons, formatScore, formatSeconds, formatValue, MISSING } from './format'

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

  it('prints depths in micrometres, days as they were recorded, and how a lot was conditioned', () => {
    expect(formatMicrons(43.69129573033708)).toBe('43.69 µm')
    expect(formatDate('2024-08-01')).toBe('Aug 1, 2024')
    expect(formatConditioning(9, 'SILICON')).toBe('Conditioned 9 times on a silicon wafer')
    expect(formatConditioning(1, 'CHUCK')).toBe('Conditioned once on the bare chuck')
  })

  it('marks a missing value', () => {
    expect(formatValue(null)).toBe(MISSING)
    expect(formatScore(null)).toBe(MISSING)
    expect(formatSeconds(null)).toBe(MISSING)
  })
})
