import type { ReactNode } from 'react'
import { type AlignmentStatus, type DriftState, isFlagged, type Score } from '../api/schema'
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

/** What the detectors made of a run, whether its alignment is less than clean, and whether it teaches the baseline. */
export function RunStatus({ alignment, score, good, stuck = false }: {
  alignment: AlignmentStatus
  score: Score | null
  good: boolean
  stuck?: boolean
}) {
  return (
    <span className="badges">
      <Verdict alignment={alignment} score={score} />
      {alignment === 'DEGRADED' && <Badge tone="warning">Degraded</Badge>}
      {stuck && <span className="tag tag-warn">Stuck sensor</span>}
      {good && <span className="tag">Baseline run</span>}
    </span>
  )
}

/** The lot drift detector's verdict on a channel. */
export function DriftBadge({ state }: { state: DriftState }) {
  return <Badge tone={DRIFT_TONES[state]}>{formatDriftState(state)}</Badge>
}

function Verdict({ alignment, score }: { alignment: AlignmentStatus; score: Score | null }) {
  if (alignment === 'FAILED') {
    return <Badge tone="serious">Not aligned</Badge>
  }
  if (score === null) {
    return <Badge tone="neutral">Not scored</Badge>
  }
  return isFlagged(score) ? <Badge tone="critical">Out of range</Badge> : <Badge tone="good">In range</Badge>
}
