import type { ConditioningSurface, DriftState, Label, MeasurementSet } from './api/schema'

const significant = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 })
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

const SURFACE_NAMES = {
  CHUCK: 'the bare chuck',
  SILICON: 'a silicon wafer',
  OXIDE: 'an oxide wafer',
} as const satisfies Record<ConditioningSurface, string>

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

/** A reading or a band value: four significant digits, grouped. */
export function formatValue(value: number | null): string {
  return value === null ? MISSING : significant.format(value)
}

/** A z-score or a t-statistic, to one decimal. */
export function formatScore(value: number | null): string {
  return value === null ? MISSING : oneDecimal.format(value)
}

/** A record time, in seconds to one decimal. */
export function formatSeconds(value: number | null): string {
  return value === null ? MISSING : `${oneDecimal.format(value)} s`
}

/** A depth or a thickness, in micrometres to two decimals. */
export function formatMicrons(value: number | null): string {
  return value === null ? MISSING : `${twoDecimals.format(value)} µm`
}

/** A day as the API sends it, YYYY-MM-DD. */
export function formatDate(value: string): string {
  return day.format(new Date(`${value}T00:00:00Z`))
}
