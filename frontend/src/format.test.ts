import { describe, expect, it } from 'vitest'
import {
  describeCatch,
  describeDepthLoss,
  describeFault,
  describeResidual,
  formatChannelName,
  formatCount,
  formatConditioning,
  formatDate,
  formatDepthFeature,
  formatDepthMethod,
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
    expect(describeFault(stuck)).toBe(
      'Gas 5 flow delivers 36% of its flow from 187.9 s to the end of the etch, and the foreline pressure falls with the missing flow.',
    )
    expect(describeFault(dropout)).toBe('Helium backside pressure reads 0 for 9.7 s from 618.3 s.')
    expect(describeFault({ kind: 'PRESSURE_SPIKE', channel: 'Pressure', startS: 135.3, endS: 136.8, durationS: 1.5, magnitude: 0.08 }))
      .toBe('Chamber pressure rises 8% for 1.5 s from 135.3 s.')
    expect(describeFault({ kind: 'REFLECTED_POWER_RISE', channel: 'SourceRFReflectedPower', startS: 299.2, endS: 716.5, durationS: 11.2, magnitude: 28.4 }))
      .toBe('Source RF reflected power climbs 28.4 W over 11.2 s from 299.2 s, then holds.')
    expect(describeFault({ kind: 'SENSOR_STUCK', channel: 'HeliumBPPressure', startS: 499.0046, endS: 505.6034, durationS: 6.5988, magnitude: 0 }))
      .toBe('Helium backside pressure repeats its last reading for 6.6 s from 499.0 s.')
    expect(formatFaultKind('SENSOR_STUCK')).toBe('Sensor stuck')
  })

  it('says how the depth of a wafer compares with the first wafers of its lot', () => {
    const depth = { set: 'EIGHTY_NINE_POINT', points: 89, meanDepthUm: 43.6913, lossUm: 0.31345, referenceWafers: 3 } as const

    expect(describeDepthLoss(depth)).toBe('0.31 µm shallower than wafers 1 to 3 of its lot, 89-point set')
    expect(describeDepthLoss({ ...depth, set: 'NINE_POINT', lossUm: -0.0154 }))
      .toBe('0.02 µm deeper than wafers 1 to 3 of its lot, 9-point set')
    expect(describeDepthLoss({ ...depth, lossUm: null }))
      .toBe("89-point set, none of its lot's first 3 wafers was measured")
  })

  it('names the depth model\'s features and methods, and says how a prediction missed', () => {
    expect(formatDepthFeature('ForeLinePressure/C4F8/spread')).toBe('Foreline pressure, C4F8 spread')
    expect(formatDepthFeature('NotAFeature')).toBe('NotAFeature')
    expect(formatDepthMethod('FIRST_WAFERS')).toBe("The lot's first wafers")
    expect(describeResidual(-0.0627)).toBe('Predicted 0.06 µm shallower than measured')
    expect(describeResidual(0.2)).toBe('Predicted 0.20 µm deeper than measured')
    expect(describeResidual(null)).toBe('Not measured in this set')
  })

  it('names an emission line by its wavelength and what it reports', () => {
    expect(formatChannelName('Emission685')).toBe('Fluorine 685.6 nm')
    expect(formatChannelName('Emission516')).toBe('Carbon C2 516.5 nm')
    expect(formatChannelName('Gas5Flow')).toBe('Gas 5 flow')
    expect(formatChannelName('NotAChannel')).toBe('NotAChannel')
  })

  it('prints a count as a count', () => {
    expect(formatCount(2400)).toBe('2,400')
    expect(formatCount(412)).toBe('412')
  })

  it('calls a fault caught only when its own channel was named first, and not before it began', () => {
    const fault = { kind: 'GAS_FLOW_STUCK_LOW', channel: 'Gas5Flow', startS: 174.2, endS: 597.6, durationS: null, magnitude: 0.36 } as const
    const score = { limitFlags: 42, deviationFlags: 2, stuckFlags: 0, persistentZ: 4751.3, firstChannel: 'Gas5Flow', firstTimeS: 175.6 }

    expect(describeCatch(fault, score)).toBe('Yes. Gas 5 flow was named first, 1.4 s after the fault began.')
    // a slot or a repeated reading can put the alarm a sample ahead of the fault's recorded start
    expect(describeCatch(fault, { ...score, firstTimeS: 174.0 })).toBe('Yes. Gas 5 flow was named first, as the fault began.')
    // but an alarm long before it was set off by something else, whatever channel it was on
    expect(describeCatch(fault, { ...score, firstTimeS: 38.4 }))
      .toBe('The run was flagged before the fault began: Gas 5 flow departed at 38.4 s, and the fault started at 174.2 s.')
    expect(describeCatch(fault, { ...score, firstChannel: 'Heater3Temp', firstTimeS: 30.6 }))
      .toBe('The run was flagged before the fault began: Heater 3 temp departed at 30.6 s, and the fault started at 174.2 s.')
    expect(describeCatch(fault, { ...score, firstChannel: 'ForeLinePressure', firstTimeS: 174.4 }))
      .toBe('The run was flagged, but Foreline pressure was named first, not Gas 5 flow.')
    expect(describeCatch(fault, { ...score, firstTimeS: null })).toBe('Yes. Gas 5 flow was named first.')
    expect(describeCatch(fault, { ...score, firstChannel: null, firstTimeS: null })).toBe('No. The run was not flagged.')
    expect(describeCatch(fault, null)).toBe('Not scored under the current baseline.')
  })

  it('marks a missing value', () => {
    expect(formatValue(null)).toBe(MISSING)
    expect(formatScore(null)).toBe(MISSING)
    expect(formatSeconds(null)).toBe(MISSING)
  })
})
