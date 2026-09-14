import type { Label } from './api/schema'

const significant = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 })

const LABEL_NAMES = { AUTO: 'Auto', GOOD: 'Good', BAD: 'Bad' } as const satisfies Record<Label, string>

export function formatLabel(label: Label): string {
  return LABEL_NAMES[label]
}
const oneDecimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Shown where a value is missing. */
export const MISSING = '—'

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
