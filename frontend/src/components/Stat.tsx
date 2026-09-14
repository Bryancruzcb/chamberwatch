import type { ReactNode } from 'react'

/** One figure in a row of stats. `compact` sets a value that is a name rather than a number at body size. */
export function Stat({ label, value, detail, compact = false }: {
  label: string
  value: ReactNode
  detail?: ReactNode
  compact?: boolean
}) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd className={compact ? 'stat-value compact' : 'stat-value'}>{value}</dd>
      {detail !== undefined && <dd className="stat-detail">{detail}</dd>}
    </div>
  )
}
