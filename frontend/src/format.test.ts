import { describe, expect, it } from 'vitest'
import { type Channel, depthModelSchema, driftVsDepthSchema } from './api/schema'
import {
  describeCatch,
  describeChannelTrace,
  describeClip,
  describeDepthModel,
  describeDepthTrend,
  describeEvidence,
  describeEveryWafer,
  describeFault,
  describeLineup,
  describePrediction,
  describeRun,
  describeWaferDepth,
  formatAgainstLimit,
  formatBigScore,
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
  formatShortAgainstLimit,
  formatShortScore,
  formatValue,
  MISSING,
  waferHeadline,
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

  it('names the depth model\'s features and methods', () => {
    expect(formatDepthFeature('ForeLinePressure/C4F8/spread')).toBe('Foreline pressure, C4F8 spread')
    expect(formatDepthFeature('NotAFeature')).toBe('NotAFeature')
    expect(formatDepthMethod('FIRST_WAFERS')).toBe("The lot's first wafers")
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

  it('opens an out-of-range run with the channel that left first, the others, and the measured depth', () => {
    const score = { limitFlags: 25, deviationFlags: 0, stuckFlags: 0, persistentZ: 18.8, firstChannel: 'PlatenRFLoadCapacitor', firstTimeS: 407.2 }
    const channels = [channel('PlatenRFLoadCapacitor', { excursions: 21 }), channel('PlatenRFTuningCapacitor', { excursions: 4 }), channel('Gas1Flow')]
    const depth = { set: 'EIGHTY_NINE_POINT', points: 89, meanDepthUm: 43.69, lossUm: 0.31, referenceWafers: 3 } as const

    expect(describeRun({ assessment: score, channels, good: false, depth })).toBe(
      'Platen RF load cap left its range first at 407.2 s. One other channel left its range too. '
      + 'Measured afterwards, the wafer etched 43.69 µm deep, 0.31 µm shallower than wafers 1 to 3 of its lot.',
    )
    expect(describeRun({ assessment: score, channels: channels.slice(0, 1), good: false, depth: undefined }))
      .toBe('Platen RF load cap left its range at 407.2 s.')
    expect(describeRun({ assessment: score, channels, good: false, depth: { ...depth, lossUm: -0.12 } }))
      .toContain('0.12 µm deeper than wafers 1 to 3 of its lot.')
    expect(describeRun({ assessment: score, channels, good: false, depth: { ...depth, lossUm: null } }))
      .toContain('Measured afterwards, the wafer etched 43.69 µm deep.')
  })

  it('counts the channels with a moment on the etch apart from those caught on a phase mean or spread alone', () => {
    const score = { limitFlags: 25, deviationFlags: 3, stuckFlags: 0, persistentZ: 18.8, firstChannel: 'PlatenRFLoadCapacitor', firstTimeS: 407.2 }
    const load = channel('PlatenRFLoadCapacitor', { excursions: 21 })
    const tuning = channel('PlatenRFTuningCapacitor', { excursions: 4 })
    const off = ['ForeLinePressure', 'Pressure', 'Gas4Flow'].map((name) => channel(name, { deviation: true }))
    const say = (channels: Channel[]) => describeRun({ assessment: score, channels, good: false, depth: undefined })

    expect(say([load, tuning, ...off.slice(0, 1)]))
      .toBe('Platen RF load cap left its range first at 407.2 s. One other channel left its range too. One more channel was out of range on a phase mean or spread alone.')
    expect(say([load, tuning, channel('Gas5Flow', { holds: 1 }), ...off]))
      .toBe('Platen RF load cap left its range first at 407.2 s. 2 other channels left their range too. 3 more channels were out of range on a phase mean or spread alone.')
    // nothing else left its range, so nothing was "first"
    expect(say([load, ...off]))
      .toBe('Platen RF load cap left its range at 407.2 s. 3 other channels were out of range on a phase mean or spread alone.')
    expect(say([load, ...off.slice(0, 1)]))
      .toBe('Platen RF load cap left its range at 407.2 s. One other channel was out of range on a phase mean or spread alone.')
    // a channel with an excursion that also deviates is counted once, with the channels that left
    expect(say([load, { ...tuning, deviation: true }])).toBe('Platen RF load cap left its range first at 407.2 s. One other channel left its range too.')
  })

  it('says how the first channel gave a run away: an excursion, a stuck value, or a phase mean or spread', () => {
    const score = { limitFlags: 0, deviationFlags: 0, stuckFlags: 1, persistentZ: 3.6, firstChannel: 'HeliumBPPressure', firstTimeS: 498.8 }

    expect(describeRun({ assessment: score, channels: [channel('HeliumBPPressure', { holds: 1 })], good: false, depth: undefined }))
      .toBe('Helium backside pressure got stuck on one value at 498.8 s.')
    expect(describeRun({ assessment: { ...score, firstChannel: null, firstTimeS: null }, channels: [], good: false, depth: undefined }))
      .toBe('A detector flagged this run.')
  })

  it('says a sensor got stuck when its value froze before it fell out of range', () => {
    const score = { limitFlags: 1, deviationFlags: 0, stuckFlags: 1, persistentZ: 7.2, firstChannel: 'ForeLinePressure', firstTimeS: 498.8 }
    const both = channel('ForeLinePressure', { excursions: 1, holds: 1 })
    const at = (holdSlot: number, excursionSlot: number): Channel => ({
      ...both,
      holds: both.holds.map((hold) => ({ ...hold, startSlot: holdSlot })),
      excursions: both.excursions.map((excursion) => ({ ...excursion, startSlot: excursionSlot })),
    })
    const say = (subject: Channel) => describeRun({ assessment: score, channels: [subject], good: false, depth: undefined })

    // the value froze in one phase and only left the band at the next phase change
    expect(say(at(2880, 2900))).toBe('Foreline pressure got stuck on one value at 498.8 s.')
    expect(say(at(2900, 2880))).toBe('Foreline pressure left its range at 498.8 s.')
    // a tie goes to the excursion, as the detectors time it
    expect(say(at(2880, 2880))).toBe('Foreline pressure left its range at 498.8 s.')
  })

  it('names no moment and no "first" for a run caught only on a phase mean or spread', () => {
    const score = { limitFlags: 0, deviationFlags: 3, stuckFlags: 0, persistentZ: 3.1, firstChannel: 'Pressure', firstTimeS: null }
    const off = ['Pressure', 'Gas4Flow', 'PlatenRFLoadPower'].map((name) => channel(name, { deviation: true }))
    const say = (channels: Channel[]) => describeRun({ assessment: score, channels, good: false, depth: undefined })

    expect(say(off)).toBe('Chamber pressure was out of range on a phase mean or spread. 2 other channels were out of range too.')
    expect(say(off.slice(0, 2))).toBe('Chamber pressure was out of range on a phase mean or spread. One other channel was out of range too.')
    expect(say(off.slice(0, 1))).toBe('Chamber pressure was out of range on a phase mean or spread.')
  })

  it('names the 9-point set when a wafer was only measured there', () => {
    const score = { limitFlags: 4, deviationFlags: 0, stuckFlags: 0, persistentZ: 9.1, firstChannel: 'PlatenRFLoadCapacitor', firstTimeS: 195 }
    const depth = { set: 'NINE_POINT', points: 9, meanDepthUm: 40.5, lossUm: 0.29, referenceWafers: 3 } as const

    expect(describeRun({ assessment: score, channels: [channel('PlatenRFLoadCapacitor', { excursions: 4 })], good: false, depth }))
      .toBe('Platen RF load cap left its range at 195.0 s. Measured afterwards on the 9-point set, the wafer etched 40.50 µm deep, 0.29 µm shallower than wafers 1 to 3 of its lot.')
  })

  it('opens an in-range run plainly, and says when it taught the range', () => {
    const score = { limitFlags: 0, deviationFlags: 0, stuckFlags: 0, persistentZ: 5.5, firstChannel: null, firstTimeS: null }

    expect(describeRun({ assessment: score, channels: [channel('Gas1Flow')], good: false, depth: undefined })).toBe('No channel left the good-run range.')
    expect(describeRun({ assessment: score, channels: [], good: true, depth: undefined }))
      .toBe('No channel left the good-run range. This run is one of the good runs that range was learned from.')
  })

  it('answers the drift report with the last position\'s depth loss, and says nothing without a measurement', () => {
    const report = driftVsDepthSchema.parse(fixture('drift-vs-depth.json'))

    expect(describeDepthTrend(report)).toBe('By wafer 10, wafers etch 0.90 µm shallower than the first 3 of their lot, on average.')
    expect(describeDepthTrend(driftVsDepthSchema.parse(fixture('drift-vs-depth-synthetic.json')))).toBeNull()
    // the 9-point set stands in where the 89-point set has no measurement
    const nineOnly = { ...report, positions: report.positions.map((position) => ({ ...position, depth: position.depth.filter((depth) => depth.set === 'NINE_POINT') })) }
    expect(describeDepthTrend(nineOnly)).toBe('By wafer 10, wafers etch 0.84 µm shallower than the first 3 of their lot, on average.')
  })

  it('answers the depth model with its miss next to the two simpler guesses', () => {
    const model = depthModelSchema.parse(fixture('depth-model.json'))

    expect(describeDepthModel(model)).toBe(
      'After each lot\'s first wafers, the telemetry misses a wafer\'s depth by 0.16 µm, against 0.21 µm for a guess from its place '
      + 'in the lot and 0.71 µm from the lot\'s first wafers.',
    )
    expect(describeDepthModel({ ...model, methods: model.methods.filter((method) => method.method !== 'POSITION') })).toBeNull()
  })

  it('notes the misses over every measured wafer for the guesses that can score them all', () => {
    const model = depthModelSchema.parse(fixture('depth-model.json'))

    expect(describeEveryWafer(model)).toBe('Over every measured wafer: telemetry model 0.16 µm and position in the lot 0.22 µm.')
    expect(describeEveryWafer({ ...model, methods: model.methods.filter((method) => method.method === 'TELEMETRY') }))
      .toBe('Over every measured wafer: telemetry model 0.16 µm.')
    expect(describeEveryWafer({ ...model, methods: model.methods.filter((method) => method.method === 'FIRST_WAFERS') })).toBeNull()
  })

  it('counts every rule that caught a run in one line, and says nothing for a run none caught', () => {
    const score = { limitFlags: 25, deviationFlags: 0, stuckFlags: 0, persistentZ: 18.8, firstChannel: 'PlatenRFLoadCapacitor', firstTimeS: 407.2 }
    const two = [channel('PlatenRFLoadCapacitor', { excursions: 21 }), channel('PlatenRFTuningCapacitor', { excursions: 4 })]

    expect(describeEvidence(score, two)).toBe('25 excursions on 2 channels.')
    expect(describeEvidence({ ...score, limitFlags: 1 }, two.slice(0, 1))).toBe('1 excursion on 1 channel.')
    expect(describeEvidence({ ...score, deviationFlags: 2 }, [...two, channel('Pressure', { deviation: true }), channel('Gas4Flow', { deviation: true })]))
      .toBe('25 excursions on 2 channels and a phase mean or spread off the good runs on 2 channels.')
    expect(describeEvidence({ ...score, deviationFlags: 1, stuckFlags: 1 }, [...two, channel('Pressure', { deviation: true })]))
      .toBe('25 excursions on 2 channels, a phase mean or spread off the good runs on 1 channel and 1 stuck value.')
    expect(describeEvidence({ ...score, limitFlags: 0, stuckFlags: 1 }, [channel('HeliumBPPressure', { holds: 1 })])).toBe('1 stuck value.')
    expect(describeEvidence({ ...score, limitFlags: 0 }, [])).toBeNull()
  })

  it('answers the depth map with the mean and how the edge compares with the center', () => {
    const at = (xMm: number, depthUm: number) => ({
      pointNo: 1, locId: null, xUm: xMm * 1000, yUm: 0, preoxUm: 0, postoxUm: 0, postoxMeasured: true, stepheightUm: depthUm, depthUm,
    })
    const sites = [at(0, 44), at(20, 43), at(60, 42), at(90, 41.5)]
    const measurements = { set: 'NINE_POINT', points: 4, meanDepthUm: 42.63, sdDepthUm: 1.1, values: sites } as const

    expect(describeWaferDepth(measurements)).toBe('42.63 µm deep on average across 4 sites. Sites near the edge etched 2.50 µm shallower than sites near the center.')
    expect(describeWaferDepth({ ...measurements, points: 2, values: sites.slice(0, 2) })).toBe('42.63 µm deep on average across 2 sites.')
    expect(describeWaferDepth({ ...measurements, points: 0, meanDepthUm: null, values: [] })).toBeNull()
  })

  it('heads the depth page with the side of the wafer that etched deepest, in the run page\'s words', () => {
    const at = (xMm: number, depthUm: number) => ({
      pointNo: 1, locId: null, xUm: xMm * 1000, yUm: 0, preoxUm: 0, postoxUm: 0, postoxMeasured: true, stepheightUm: depthUm, depthUm,
    })
    const run = { positionInLot: 5, lotNo: 6 }
    const sites = [at(0, 44), at(20, 43), at(60, 42), at(90, 41.5)]
    const measurements = { set: 'NINE_POINT', points: 4, meanDepthUm: 42.63, sdDepthUm: 1.1, values: sites } as const

    expect(waferHeadline(run, measurements)).toBe('Wafer 5 of Lot\u00a06 etched deepest at its center.')
    expect(waferHeadline(run, { ...measurements, values: [at(0, 41), at(20, 42), at(60, 43), at(90, 44)] }))
      .toBe('Wafer 5 of Lot\u00a06 etched deepest at its edge.')
    // 0.001 µm apart prints as the same depth, so neither side is called deeper
    expect(waferHeadline(run, { ...measurements, values: [at(0, 42.001), at(20, 42.001), at(60, 42), at(90, 42)] }))
      .toBe('Wafer 5 of Lot\u00a06 etched evenly from center to edge.')
    expect(waferHeadline(run, { ...measurements, points: 2, values: sites.slice(0, 2) })).toBe('Wafer 5 of Lot\u00a06 etched 42.63 µm deep on average.')
    expect(waferHeadline(run, { ...measurements, points: 0, meanDepthUm: null, values: [] })).toBe('Wafer 5 of Lot\u00a06 has no 9-point measurements.')
  })

  it('answers the prediction with its miss on this wafer and the lot\'s typical miss', () => {
    const depth = { runId: 55, set: 'EIGHTY_NINE_POINT', lotNo: 6, predictedUm: 43.64, measuredUm: 43.69, residualUm: -0.05, lambda: 31.6, lotRmseUm: 0.148 } as const

    expect(describePrediction(depth)).toBe('The telemetry predicted 43.64 µm, 0.05 µm shallower than measured. Across lot 6 it typically misses by 0.15 µm.')
    expect(describePrediction({ ...depth, residualUm: 0.12, lotRmseUm: null })).toBe('The telemetry predicted 43.64 µm, 0.12 µm deeper than measured.')
    expect(describePrediction({ ...depth, measuredUm: null, residualUm: null, lotRmseUm: null }))
      .toBe('The telemetry predicts 43.64 µm; this wafer was not measured in this set.')
  })

  it('answers the lineup with how many channels passed the limit and which went furthest', () => {
    const scored = (name: string, persistentZ: number): Channel => ({ ...channel(name), persistentZ })
    const channels = [scored('PlatenRFLoadCapacitor', 18.8), scored('PlatenRFTuningCapacitor', 6.9), scored('Gas1Flow', 2.2)]

    expect(describeLineup(channels, 6)).toBe('2 of 3 channels went past the limit of 6.0. Platen RF load cap went furthest, to 18.8.')
    expect(describeLineup([scored('Gas5Flow', 97795.1), scored('Gas1Flow', 2.2)], 6))
      .toBe('1 of 2 channels went past the limit of 6.0. Gas 5 flow went furthest, to 97,795.')
    // exactly at the limit is not past it
    expect(describeLineup([scored('Gas7Flow', 3.56), scored('Gas1Flow', 6)], 6))
      .toBe('No channel went past the limit of 6.0. The closest was Gas 1 flow, at 6.0.')
    expect(describeLineup([], 6)).toBe('No channel was scored.')
  })

  it('prints two decimals where one would print a value as the limit itself', () => {
    const scored = (name: string, persistentZ: number): Channel => ({ ...channel(name), persistentZ })

    expect(describeLineup([scored('Gas1Flow', 6.04), scored('Gas7Flow', 2.2)], 6))
      .toBe('1 of 2 channels went past the limit of 6.0. Gas 1 flow went furthest, to 6.04.')
    expect(describeLineup([scored('Gas1Flow', 5.96)], 6)).toBe('No channel went past the limit of 6.0. The closest was Gas 1 flow, at 5.96.')
    expect(formatAgainstLimit(6.04, 6)).toBe('6.04')
    expect(formatAgainstLimit(5.96, 6)).toBe('5.96')
    // exactly at the limit, and anywhere the one-decimal text already differs from it, nothing changes
    expect(formatAgainstLimit(6, 6)).toBe('6.0')
    expect(formatAgainstLimit(6.06, 6)).toBe('6.1')
    expect(formatAgainstLimit(18.81, 6)).toBe('18.8')
    expect(formatAgainstLimit(97795.1, 6)).toBe('>20')
  })

  it('marks a missing value', () => {
    expect(formatValue(null)).toBe(MISSING)
    expect(formatScore(null)).toBe(MISSING)
    expect(formatSeconds(null)).toBe(MISSING)
  })
})

const fixtures = import.meta.glob('../e2e/fixtures/*.json', { eager: true, import: 'default' })

function fixture(name: string): unknown {
  const key = `../e2e/fixtures/${name}`
  if (!(key in fixtures)) {
    throw new Error(`no fixture ${name}`)
  }
  return fixtures[key]
}

/** A scored channel with as many excursions and holds as asked for, and nothing else of note. */
describe("the run page's numbers and notes", () => {
  it("prints the verdict's numeral in full, one decimal under 100", () => {
    expect(formatBigScore(18.81)).toBe('18.8')
    expect(formatBigScore(99.96)).toBe('100.0')
    expect(formatBigScore(100)).toBe('100')
    expect(formatBigScore(97795.12)).toBe('97,795')
  })

  it('prints a short score against the limit with a second decimal only where one would read as the limit', () => {
    expect(formatShortAgainstLimit(18.81, 6)).toBe('18.8')
    expect(formatShortAgainstLimit(6.04, 6)).toBe('6.04')
    expect(formatShortAgainstLimit(5.96, 6)).toBe('5.96')
    expect(formatShortAgainstLimit(6, 6)).toBe('6.0')
    expect(formatShortAgainstLimit(97795, 6)).toBe('98K')
    expect(formatShortAgainstLimit(6.04, null)).toBe('6.0')
  })

  it("says what a channel's reading did, for the trace's answer", () => {
    expect(describeChannelTrace(channel('Gas5Flow', { excursions: 3 }))).toBe('The reading left the good-run range 3 times, first at 1.0 s.')
    expect(describeChannelTrace(channel('Gas5Flow', { excursions: 1 }))).toBe('The reading left the good-run range once, first at 1.0 s.')
    expect(describeChannelTrace(channel('Pressure', { holds: 1 }))).toBe('The reading held one value longer than any good run once, first at 1.0 s.')
    expect(describeChannelTrace(channel('Pressure', { excursions: 2, holds: 2 })))
      .toBe('The reading left the good-run range 2 times, first at 1.0 s. It held one value longer than any good run 2 times, first at 1.0 s.')
    expect(describeChannelTrace(channel('Pressure', { deviation: true })))
      .toBe('The reading stayed in the good-run range, but a phase mean or spread moved off the good runs.')
    expect(describeChannelTrace(channel('Pressure'))).toBe('The reading stayed in the good-run range.')
  })

  it('notes what a fitted trace clips, a ramp at the start or stretches elsewhere', () => {
    expect(describeClip({ side: 'below', edge: 60, atStart: true, untilS: 39.8, value: 6.891, atS: 30.4, stretches: 1 }))
      .toBe('Below 60 until 39.8 s; starts at 6.9')
    expect(describeClip({ side: 'above', edge: 100, atStart: false, untilS: 500, value: 112.4, atS: 407.2, stretches: 3 }))
      .toBe('Above 100 in 3 stretches; highest 112 at 407.2 s')
    expect(describeClip({ side: 'below', edge: 0.5, atStart: false, untilS: 500, value: 0.12, atS: 9, stretches: 1 }))
      .toBe('Below 0.5 in 1 stretch; lowest 0.1 at 9.0 s')
  })
})

function channel(name: string, { excursions = 0, holds = 0, deviation = false } = {}): Channel {
  const span = { channel: name, startSlot: 0, confirmSlot: 4, endSlot: 9, cycle: 1, phase: 'SF6', offset: 0, startTimeS: 1, confirmTimeS: 1.8, endTimeS: 2.8 } as const
  return {
    channel: name,
    rank: 1,
    persistentZ: 0,
    deviation,
    maxAbsSummaryZ: 0,
    longestHold: 0,
    phases: [],
    excursions: Array.from({ length: excursions }, () => ({ ...span, outSamples: 10, peakZ: 7 })),
    holds: Array.from({ length: holds }, () => ({ ...span, samples: 10, value: 1 })),
  }
}

describe('formatShortScore', () => {
  it('prints at most four characters: one decimal under 100, whole under 10,000, then compact', () => {
    expect(formatShortScore(24.925)).toBe('24.9')
    expect(formatShortScore(9.6)).toBe('9.6')
    expect(formatShortScore(6)).toBe('6.0')
    expect(formatShortScore(99.94)).toBe('99.9')
    expect(formatShortScore(100)).toBe('100')
    expect(formatShortScore(9805.63)).toBe('9806')
    expect(formatShortScore(97795.1)).toBe('98K')
    expect(formatShortScore(123456)).toBe('120K')
    expect(formatShortScore(4_560_000)).toBe('4.6M')
  })
})
