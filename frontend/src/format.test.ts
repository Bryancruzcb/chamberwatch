import { describe, expect, it } from 'vitest'
import {
  describeFault,
  formatConditioning,
  formatDate,
  formatFaultKind,
  formatMicrons,
  formatScore,
  formatSeconds,
  formatValue,
  MISSING,
} from './format'

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

  it('says what the simulator did to a channel', () => {
    const stuck = { kind: 'GAS_FLOW_STUCK_LOW', channel: 'Gas5Flow', startS: 187.89386, endS: 716.46735, durationS: null, magnitude: 0.35579 } as const
    const dropout = { kind: 'SENSOR_DROPOUT', channel: 'HeliumBPPressure', startS: 618.3042, endS: 628.0, durationS: 9.7, magnitude: 0 } as const

    expect(formatFaultKind('REFLECTED_POWER_RISE')).toBe('Reflected power rise')
    expect(describeFault(stuck)).toBe('Gas5Flow delivers 36% of its flow from 187.9 s to the end of the etch.')
    expect(describeFault(dropout)).toBe('HeliumBPPressure reads 0 for 9.7 s from 618.3 s.')
    expect(describeFault({ kind: 'PRESSURE_SPIKE', channel: 'Pressure', startS: 135.3, endS: 136.8, durationS: 1.5, magnitude: 0.08 }))
      .toBe('Pressure rises 8% for 1.5 s from 135.3 s.')
    expect(describeFault({ kind: 'REFLECTED_POWER_RISE', channel: 'SourceRFReflectedPower', startS: 299.2, endS: 716.5, durationS: 11.2, magnitude: 28.4 }))
      .toBe('SourceRFReflectedPower climbs 28.4 W over 11.2 s from 299.2 s, then holds.')
    expect(describeFault({ kind: 'SENSOR_STUCK', channel: 'HeliumBPPressure', startS: 499.0046, endS: 505.6034, durationS: 6.5988, magnitude: 0 }))
      .toBe('HeliumBPPressure repeats its last reading for 6.6 s from 499.0 s.')
    expect(formatFaultKind('SENSOR_STUCK')).toBe('Sensor stuck')
  })

  it('marks a missing value', () => {
    expect(formatValue(null)).toBe(MISSING)
    expect(formatScore(null)).toBe(MISSING)
    expect(formatSeconds(null)).toBe(MISSING)
  })
})
