import {
  type Channel, type ConditioningSurface, type DepthMethod, type DepthModel, type DriftState, type DriftVsDepth, type FaultKind,
  type InjectedFault, isFlagged, type Label, type MeasuredDepth, type Measurements, type MeasurementSet, type RunDepth, type Score,
  type Source,
} from './api/schema'
import { centerAndEdge } from './wafer'

const significant = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 })
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const twoDecimals = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/**
 * How far before a fault's recorded start an alarm on the fault's own channel still counts as catching it. An
 * alarm is timed from the 0.2 s slot it starts in, and a stuck sensor's hold from the first sample of the value it
 * goes on repeating, so either can sit a sample or two ahead of the moment the fault was put in.
 */
const CATCH_LEAD_S = 1.0
// Dates arrive as plain days, so they are formatted in UTC to keep the day from shifting with the reader's time zone.
const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

const LABEL_NAMES = { AUTO: 'Auto', GOOD: 'Good', BAD: 'Bad' } as const satisfies Record<Label, string>

const MEASUREMENT_SET_NAMES = {
  EIGHTY_NINE_POINT: '89-point',
  NINE_POINT: '9-point',
} as const satisfies Record<MeasurementSet, string>

const DRIFT_STATE_NAMES = {
  OUT_OF_BAND: 'Out of band',
  WILL_EXIT: 'Will leave the band',
  STAYS_IN: 'Stays in the band',
  NO_TREND: 'No trend',
  INSUFFICIENT_RUNS: 'Too few wafers',
} as const satisfies Record<DriftState, string>

const SOURCE_NAMES = { PUBLIC: 'Public', SYNTHETIC: 'Simulated', LIVE: 'Live' } as const satisfies Record<Source, string>

const DEPTH_METHOD_NAMES = {
  TELEMETRY: 'Telemetry model',
  POSITION: 'Position in the lot',
  FIRST_WAFERS: 'The lot\'s first wafers',
} as const satisfies Record<DepthMethod, string>

const FAULT_KIND_NAMES = {
  GAS_FLOW_STUCK_LOW: 'Gas flow stuck low',
  PRESSURE_SPIKE: 'Pressure spike',
  REFLECTED_POWER_RISE: 'Reflected power rise',
  SENSOR_DROPOUT: 'Sensor dropout',
  SENSOR_STUCK: 'Sensor stuck',
} as const satisfies Record<FaultKind, string>

const SURFACE_NAMES = {
  CHUCK: 'the bare chuck',
  SILICON: 'a silicon wafer',
  OXIDE: 'an oxide wafer',
} as const satisfies Record<ConditioningSurface, string>

const CHANNEL_NAMES: Record<string, string> = {
  Emission685: 'Fluorine 685.6 nm',
  Emission703: 'Fluorine 703.7 nm',
  Emission623: 'Fluorine 624.0 nm',
  Emission516: 'Carbon C2 516.5 nm',
  Emission563: 'Carbon C2 563.6 nm',
  PlatenRFLoadCapacitor: 'Platen RF load cap',
  PlatenRFTuningCapacitor: 'Platen RF tuning cap',
  PlatenDcBias: 'Platen DC bias',
  PlatenRFPeakToPeak: 'Platen RF peak-to-peak',
  PlatenRFLoadPower: 'Platen RF load power',
  PlatenRFReflectedPower: 'Platen RF reflected power',
  SourceRFReflectedPower: 'Source RF reflected power',
  SourceRFLoadPower: 'Source RF load power',
  SourceRFPeakToPeak: 'Source RF peak-to-peak',
  SourceRF2PeakToPeak: 'Source RF 2 peak-to-peak',
  SourceRFTuningCapacitor: 'Source RF tuning cap',
  SourceRF2TuningCapacitor: 'Source RF 2 tuning cap',
  SourceRFLoadCapacitor: 'Source RF load cap',
  SourceRF2LoadCapacitor: 'Source RF 2 load cap',
  SourceRF2LoadPower: 'Source RF 2 load power',
  SourceRF2ReflectedPower: 'Source RF 2 reflected power',
  Gas1Flow: 'Gas 1 flow',
  Gas2Flow: 'Gas 2 flow',
  Gas3Flow: 'Gas 3 flow',
  Gas4Flow: 'Gas 4 flow',
  Gas5Flow: 'Gas 5 flow',
  Gas6Flow: 'Gas 6 flow',
  Gas7Flow: 'Gas 7 flow',
  Gas8Flow: 'Gas 8 flow',
  ForeLinePressure: 'Foreline pressure',
  Pressure: 'Chamber pressure',
  HeliumBPPressure: 'Helium backside pressure',
  HeliumBPFlow: 'Helium backside flow',
  Heater1Temp: 'Heater 1 temp',
  Heater2Temp: 'Heater 2 temp',
  Heater3Temp: 'Heater 3 temp',
  Heater4Temp: 'Heater 4 temp',
  Heater5Temp: 'Heater 5 temp',
  Heater6Temp: 'Heater 6 temp',
  Heater7Temp: 'Heater 7 temp',
  Heater8Temp: 'Heater 8 temp',
  moriInnerCurrent: 'Inner coil current',
  moriOuterCurrent: 'Outer coil current',
  EpdIntensity: 'Endpoint intensity',
  attenuatorRatio: 'Attenuator ratio',
}

/** A z-score this large is a step change, not a useful number on a card. */
const UNUSUAL_CAP = 20

/** Shown where a value is missing. */
export const MISSING = '—'

export function formatLabel(label: Label): string {
  return LABEL_NAMES[label]
}

export function formatMeasurementSet(set: MeasurementSet): string {
  return MEASUREMENT_SET_NAMES[set]
}

export function formatDriftState(state: DriftState): string {
  return DRIFT_STATE_NAMES[state]
}

/** For example, "Conditioned 9 times on a silicon wafer". */
export function formatConditioning(count: number, surface: ConditioningSurface): string {
  return `Conditioned ${count === 1 ? 'once' : `${count} times`} on ${SURFACE_NAMES[surface]}`
}

/** A sensor name a person can say out loud. Unknown channels keep their recorded name. */
export function formatChannelName(channel: string): string {
  return CHANNEL_NAMES[channel] ?? channel
}

/** A reading or a band value: four significant digits, grouped. */
export function formatValue(value: number | null): string {
  return value === null ? MISSING : significant.format(value)
}

/** A count of things, grouped and without decimals: 2,400, not 2,400.0. */
export function formatCount(value: number): string {
  return whole.format(value)
}

/**
 * Whether the detectors caught the fault the simulator put in: the right channel named first, and when. An alarm
 * well before the fault began was set off by something else, and says so rather than counting as a catch.
 */
export function describeCatch(fault: InjectedFault, assessment: Score | null): string {
  if (assessment === null) {
    return 'Not scored under the current baseline.'
  }
  const first = assessment.firstChannel
  const at = assessment.firstTimeS
  if (first === null) {
    return 'No. The run was not flagged.'
  }
  if (at !== null && at < fault.startS - CATCH_LEAD_S) {
    return `The run was flagged before the fault began: ${formatChannelName(first)} departed at ${formatSeconds(at)}, `
      + `and the fault started at ${formatSeconds(fault.startS)}.`
  }
  if (first !== fault.channel) {
    return `The run was flagged, but ${formatChannelName(first)} was named first, not ${formatChannelName(fault.channel)}.`
  }
  if (at === null) {
    return `Yes. ${formatChannelName(fault.channel)} was named first.`
  }
  return at <= fault.startS
    ? `Yes. ${formatChannelName(fault.channel)} was named first, as the fault began.`
    : `Yes. ${formatChannelName(fault.channel)} was named first, ${formatSeconds(at - fault.startS)} after the fault began.`
}

/**
 * The answer a run's page opens with, before the numbers: which channel left its range first and when, how many others
 * were out of range with it, and how deep the wafer measured. In the Runs page's words: range, channel, out of range.
 */
export function describeRun({ assessment, channels, good, depth }: {
  assessment: Score
  channels: readonly Channel[]
  good: boolean
  depth: MeasuredDepth | undefined
}): string {
  const verdict = isFlagged(assessment) ? describeOut(assessment, channels) : describeIn(good)
  return depth === undefined ? verdict : `${verdict} ${describeMeasured(depth)}`
}

function describeIn(good: boolean): string {
  return good
    ? 'No channel left the good-run range. This run is one of the good runs that range was learned from.'
    : 'No channel left the good-run range.'
}

/**
 * The out-of-range sentence. The other channels are counted in two groups, because the run's timeline can only draw
 * the first: those with a moment on the etch (an excursion or a stuck value), and those caught on a phase mean or
 * spread alone. "First" is only said of a channel that left before another one did.
 */
function describeOut(assessment: Score, channels: readonly Channel[]): string {
  const first = assessment.firstChannel
  if (first === null) {
    return 'A detector flagged this run.'
  }
  const firstChannel = channels.find((channel) => channel.channel === first)
  const rest = channels.filter((channel) => channel.channel !== first)
  const departed = rest.filter(hasDeparted).length
  const deviating = rest.filter((channel) => !hasDeparted(channel) && channel.deviation).length
  // The detectors rank a channel that left its range above every channel that did not, so a first channel caught only
  // on a phase mean or spread has no moment to name, and it is first by size, not by time.
  if (firstChannel !== undefined && !hasDeparted(firstChannel) && firstChannel.deviation) {
    const others = departed + deviating
    const too = others === 0 ? '' : ` ${others === 1 ? 'One other channel was' : `${others} other channels were`} out of range too.`
    return `${formatChannelName(first)} was out of range on a phase mean or spread.${too}`
  }
  const when = assessment.firstTimeS === null ? '' : ` at ${formatSeconds(assessment.firstTimeS)}`
  const lead = `${formatChannelName(first)} ${describeDeparture(firstChannel)}${departed === 0 ? '' : ' first'}${when}.`
  const left = departed === 0
    ? ''
    : ` ${departed === 1 ? 'One other channel left its range' : `${departed} other channels left their range`} too.`
  const word = departed === 0 ? 'other' : 'more'
  const off = deviating === 0
    ? ''
    : ` ${deviating === 1 ? `One ${word} channel was` : `${deviating} ${word} channels were`} out of range on a phase mean or spread alone.`
  return `${lead}${left}${off}`
}

/** Whether a channel has a moment on the etch: an excursion past the limit, or a stuck value. */
function hasDeparted(channel: Channel): boolean {
  return channel.excursions.length > 0 || channel.holds.length > 0
}

/**
 * What the first channel did at the time the run names. The detectors time a channel's departure from whichever came
 * first, its first excursion or its first stuck value, and a tie goes to the excursion; a sensor that froze and only
 * later fell out of its range at a phase change got stuck first.
 */
function describeDeparture(channel: Channel | undefined): string {
  if (channel === undefined) {
    return 'left its range'
  }
  const firstSlot = (spans: readonly { startSlot: number }[]) => spans.reduce((min, span) => Math.min(min, span.startSlot), Infinity)
  return firstSlot(channel.holds) < firstSlot(channel.excursions) ? 'got stuck on one value' : 'left its range'
}

/** The lineup's answer: how many of the run's channels went past the limit, and which one went furthest. */
export function describeLineup(channels: readonly Channel[], k: number): string {
  const over = channels.filter((channel) => channel.persistentZ > k)
  const furthest = channels.reduce<Channel | null>((best, channel) => (best === null || channel.persistentZ > best.persistentZ ? channel : best), null)
  if (furthest === null) {
    return 'No channel was scored.'
  }
  if (over.length === 0) {
    return `No channel went past the limit of ${formatScore(k)}. The closest was ${formatChannelName(furthest.channel)}, at ${formatAgainstLimit(furthest.persistentZ, k)}.`
  }
  return `${over.length} of ${channels.length} channels went past the limit of ${formatScore(k)}. `
    + `${formatChannelName(furthest.channel)} went furthest, to ${formatAgainstLimit(furthest.persistentZ, k)}.`
}

/**
 * Every rule that caught the run, counted, in one line under its timeline: excursions and the channels they were on, a
 * phase mean or spread off the good runs, and stuck values. Null for a run no rule caught.
 */
export function describeEvidence(assessment: Score, channels: readonly Channel[]): string | null {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
  const excursionChannels = channels.filter((channel) => channel.excursions.length > 0).length
  const deviationChannels = channels.filter((channel) => channel.deviation).length
  const parts = [
    ...(assessment.limitFlags > 0 ? [`${plural(assessment.limitFlags, 'excursion')} on ${plural(excursionChannels, 'channel')}`] : []),
    ...(assessment.deviationFlags > 0 ? [`a phase mean or spread off the good runs on ${plural(deviationChannels, 'channel')}`] : []),
    ...(assessment.stuckFlags > 0 ? [plural(assessment.stuckFlags, 'stuck value')] : []),
  ]
  if (parts.length === 0) {
    return null
  }
  const joined = parts.length === 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.slice(-1).join('')}`
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`
}

/**
 * The depth sentence. The 89-point set is the default and goes unnamed; the 9-point set reads about 3 µm shallower on
 * the same wafer, so a wafer only measured there says so.
 */
function describeMeasured(depth: MeasuredDepth): string {
  const measured = depth.set === 'NINE_POINT' ? 'Measured afterwards on the 9-point set' : 'Measured afterwards'
  const etched = `${measured}, the wafer etched ${formatMicrons(depth.meanDepthUm)} deep`
  if (depth.lossUm === null) {
    return `${etched}.`
  }
  const direction = depth.lossUm >= 0 ? 'shallower' : 'deeper'
  return `${etched}, ${twoDecimals.format(Math.abs(depth.lossUm))} µm ${direction} than wafers 1 to ${depth.referenceWafers} of its lot.`
}

/**
 * The drift report's answer: how much shallower the last wafer position etched than its lot's first wafers, on the
 * 89-point set when it was measured there. Null when no position has a measured loss, as for simulated wafers.
 */
export function describeDepthTrend(report: DriftVsDepth): string | null {
  const losses = report.positions.flatMap((position) => {
    const depth = position.depth.find((entry) => entry.set === 'EIGHTY_NINE_POINT')
      ?? position.depth.find((entry) => entry.set === 'NINE_POINT')
    return depth === undefined || depth.meanDepthLossUm === null ? [] : [{ position: position.position, lossUm: depth.meanDepthLossUm }]
  })
  const last = losses.at(-1)
  if (last === undefined) {
    return null
  }
  const direction = last.lossUm >= 0 ? 'shallower' : 'deeper'
  return `By wafer ${last.position}, wafers etch ${twoDecimals.format(Math.abs(last.lossUm))} µm ${direction} than the first `
    + `${report.referenceWafers} of their lot, on average.`
}

/**
 * The depth model's answer: its typical miss on the wafers every guess can score, next to the two simpler guesses.
 * Null when the report lacks any of the three.
 */
export function describeDepthModel(model: DepthModel): string | null {
  const miss = (method: DepthMethod) => model.methods.find((entry) => entry.method === method)?.late.rmseUm
  const telemetry = miss('TELEMETRY')
  const position = miss('POSITION')
  const firstWafers = miss('FIRST_WAFERS')
  if (telemetry === undefined || position === undefined || firstWafers === undefined) {
    return null
  }
  return `After each lot's first wafers, the telemetry misses a wafer's depth by ${formatMicrons(telemetry)}, against `
    + `${formatMicrons(position)} for a guess from its place in the lot and ${formatMicrons(firstWafers)} from the lot's first wafers.`
}

/** A z-score or a t-statistic, to one decimal. */
export function formatScore(value: number | null): string {
  return value === null ? MISSING : oneDecimal.format(value)
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 2 })

/**
 * A score short enough to print inside a wafer's disc, four characters at most, and the same everywhere else the disc's
 * score is read: one decimal under 100, whole under 10,000, then compact, so a step change of 97,795 prints as 98K.
 */
export function formatShortScore(value: number): string {
  const size = Math.abs(value)
  if (size >= 10_000) {
    return compact.format(value)
  }
  return size >= 100 ? String(Math.round(value)) : oneDecimal.format(value)
}

/** A z-score for a card or meter: values past 20 print as a bound, not 97,812.4. */
export function formatUnusual(value: number | null): string {
  if (value === null) {
    return MISSING
  }
  if (value > UNUSUAL_CAP) {
    return `>${UNUSUAL_CAP}`
  }
  if (value < -UNUSUAL_CAP) {
    return `<-${UNUSUAL_CAP}`
  }
  return formatScore(value)
}

/**
 * A how-unusual value printed beside the limit k: one decimal, or two when one would print it as the limit itself. A
 * channel at 6.04 is past a limit of 6.0 and one at 5.96 is under it, and "6.0" would say neither.
 */
export function formatAgainstLimit(value: number, k: number): string {
  const text = formatUnusual(value)
  return value !== k && text === formatScore(k) ? twoDecimals.format(value) : text
}

/** A record time, in seconds to one decimal. */
export function formatSeconds(value: number | null): string {
  return value === null ? MISSING : `${oneDecimal.format(value)} s`
}

/** A depth or a thickness, in micrometres to two decimals. */
/** A wafer's depth against its lot's first wafers, for example "0.45 µm shallower than wafers 1 to 3 of its lot, 89-point set". */
export function describeDepthLoss(depth: MeasuredDepth): string {
  const set = `${MEASUREMENT_SET_NAMES[depth.set]} set`
  if (depth.lossUm === null) {
    return `${set}, none of its lot's first ${depth.referenceWafers} wafers was measured`
  }
  const direction = depth.lossUm >= 0 ? 'shallower' : 'deeper'
  return `${twoDecimals.format(Math.abs(depth.lossUm))} µm ${direction} than wafers 1 to ${depth.referenceWafers} of its lot, ${set}`
}

export function formatDepthMethod(method: DepthMethod): string {
  return DEPTH_METHOD_NAMES[method]
}

/** A depth feature, `ForeLinePressure/C4F8/spread`, as "Foreline pressure, C4F8 spread". */
export function formatDepthFeature(feature: string): string {
  const [channel = feature, phase, statistic] = feature.split('/')
  return phase === undefined || statistic === undefined ? feature : `${formatChannelName(channel)}, ${phase} ${statistic}`
}

/** How a prediction missed, for example "0.06 µm shallower than measured"; predicted minus measured is the residual. */
export function describeResidual(residualUm: number | null): string {
  if (residualUm === null) {
    return 'Not measured in this set'
  }
  return `Predicted ${twoDecimals.format(Math.abs(residualUm))} µm ${residualUm < 0 ? 'shallower' : 'deeper'} than measured`
}

/**
 * The depth map's answer: the wafer's mean depth over its sites, and how the sites nearest the edge compare with those
 * nearest the center, about a third of the sites each (see `centerAndEdge`). Null for a set with no measurement.
 */
export function describeWaferDepth(measurements: Measurements): string | null {
  if (measurements.meanDepthUm === null || measurements.points === 0) {
    return null
  }
  const mean = `${formatMicrons(measurements.meanDepthUm)} deep on average across ${measurements.points} ${measurements.points === 1 ? 'site' : 'sites'}.`
  const sides = centerAndEdge(measurements.values)
  if (sides === null) {
    return mean
  }
  const difference = sides.edgeUm - sides.centerUm
  return `${mean} Sites near the edge etched ${twoDecimals.format(Math.abs(difference))} µm ${difference >= 0 ? 'deeper' : 'shallower'} than sites near the center.`
}

/** The prediction's answer: what the telemetry predicted against what was measured, and the lot's typical miss. */
export function describePrediction(depth: RunDepth): string {
  const predicted = formatMicrons(depth.predictedUm)
  const first = depth.residualUm === null
    ? `The telemetry predicts ${predicted}; this wafer was not measured in this set.`
    : `The telemetry predicted ${predicted}, ${twoDecimals.format(Math.abs(depth.residualUm))} µm ${depth.residualUm < 0 ? 'shallower' : 'deeper'} than measured.`
  return depth.lotRmseUm === null
    ? first
    : `${first} Across lot ${depth.lotNo} it typically misses by ${formatMicrons(depth.lotRmseUm)}.`
}

export function formatMicrons(value: number | null): string {
  return value === null ? MISSING : `${twoDecimals.format(value)} µm`
}

/** A day as the API sends it, YYYY-MM-DD. */
export function formatDate(value: string): string {
  return day.format(new Date(`${value}T00:00:00Z`))
}

export function formatSource(source: Source): string {
  return SOURCE_NAMES[source]
}

export function formatFaultKind(kind: FaultKind): string {
  return FAULT_KIND_NAMES[kind]
}

/** What the simulator did, for example "Gas 5 flow delivers 36% of its flow from 187.9 s to the end of the etch, and ..." */
export function describeFault(fault: InjectedFault): string {
  const from = formatSeconds(fault.startS)
  const channel = formatChannelName(fault.channel)
  switch (fault.kind) {
    case 'GAS_FLOW_STUCK_LOW':
      return `${channel} delivers ${percent.format(fault.magnitude)} of its flow from ${from} to the end of the etch, and the foreline pressure falls with the missing flow.`
    case 'PRESSURE_SPIKE':
      return `${channel} rises ${percent.format(fault.magnitude)} for ${formatSeconds(fault.durationS)} from ${from}.`
    case 'REFLECTED_POWER_RISE':
      return `${channel} climbs ${significant.format(fault.magnitude)} W over ${formatSeconds(fault.durationS)} from ${from}, then holds.`
    case 'SENSOR_DROPOUT':
      return `${channel} reads 0 for ${formatSeconds(fault.durationS)} from ${from}.`
    case 'SENSOR_STUCK':
      return `${channel} repeats its last reading for ${formatSeconds(fault.durationS)} from ${from}.`
    default: {
      const exhaustive: never = fault.kind
      return exhaustive
    }
  }
}
