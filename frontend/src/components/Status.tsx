import type { ReactNode } from 'react'
import type { DriftState } from '../api/schema'
import { formatDriftState } from '../format'
import { Icon, type IconName } from './Icon'

type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral'

// Each state has its own shape as well as its color, so it never rests on color alone.
const ICONS = {
  good: 'check',
  warning: 'circle-alert',
  serious: 'diamond',
  critical: 'alert',
  neutral: 'circle',
} as const satisfies Record<Tone, IconName>

const DRIFT_TONES = {
  OUT_OF_BAND: 'critical',
  WILL_EXIT: 'warning',
  STAYS_IN: 'neutral',
  NO_TREND: 'good',
  INSUFFICIENT_RUNS: 'neutral',
} as const satisfies Record<DriftState, Tone>

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      <Icon name={ICONS[tone]} size={14} />
      {children}
    </span>
  )
}

/** The lot drift detector's verdict on a channel. */
export function DriftBadge({ state }: { state: DriftState }) {
  return <Badge tone={DRIFT_TONES[state]}>{formatDriftState(state)}</Badge>
}
