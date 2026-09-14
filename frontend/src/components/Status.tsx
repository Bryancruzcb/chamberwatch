import type { ReactNode } from 'react'
import { type AlignmentStatus, isFlagged, type Score } from '../api/schema'

type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral'

// Each state has its own shape as well as its color, so it never rests on color alone.
const ICONS: Record<Tone, ReactNode> = {
  good: <path d="M2.5 6.5 5 9l4.5-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  warning: <path d="M6 1.5 11 10.5H1Z" fill="currentColor" />,
  serious: <path d="M6 1 11 6 6 11 1 6Z" fill="currentColor" />,
  critical: <circle cx="6" cy="6" r="5" fill="currentColor" />,
  neutral: <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />,
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      <svg viewBox="0 0 12 12" aria-hidden="true">{ICONS[tone]}</svg>
      {children}
    </span>
  )
}

/** What the detectors made of a run, whether its alignment is less than clean, and whether it teaches the baseline. */
export function RunStatus({ alignment, score, good }: { alignment: AlignmentStatus; score: Score | null; good: boolean }) {
  return (
    <span className="badges">
      <Verdict alignment={alignment} score={score} />
      {alignment === 'DEGRADED' && <Badge tone="warning">Degraded</Badge>}
      {good && <span className="tag">Baseline run</span>}
    </span>
  )
}

function Verdict({ alignment, score }: { alignment: AlignmentStatus; score: Score | null }) {
  if (alignment === 'FAILED') {
    return <Badge tone="serious">Not aligned</Badge>
  }
  if (score === null) {
    return <Badge tone="neutral">Not scored</Badge>
  }
  return isFlagged(score) ? <Badge tone="critical">Flagged</Badge> : <Badge tone="good">Clean</Badge>
}
