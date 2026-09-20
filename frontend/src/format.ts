import type {
  ConditioningSurface, DepthMethod, DriftState, FaultKind, InjectedFault, Label, MeasuredDepth, MeasurementSet, Source,
} from './api/schema'

const significant = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 })
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const twoDecimals = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

const SOURCE_NAMES = { PUBLIC: 'Public', SYNTHETIC: 'Simulated' } as const satisfies Record<Source, string>

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

/** A z-score or a t-statistic, to one decimal. */
export function formatScore(value: number | null): string {
  return value === null ? MISSING : oneDecimal.format(value)
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
