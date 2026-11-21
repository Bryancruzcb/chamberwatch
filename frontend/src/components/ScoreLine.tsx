import { formatScore } from '../format'

/** A limit closer to 0 than this share of the line has its label set from the tick rightward, and the 0 left off. */
const NEAR_START = 0.2

/**
 * A how-unusual score on a line from 0 to `end`: a 1px axis, a 2px ink tick at the limit `k`, then, out of range, a
 * red bar from the limit to the score and a red dot; in range, a hollow ring on a thin stem. A score past `end` stops
 * at the end with an arrow, and the end's tick reads "60+". Every line in one column takes the same `end` (see
 * `scoreLineEnd` in charts/scale.ts), so the lines compare.
 *
 * `out` is the run's state, not `z > k`: a stuck value or a phase mean can put a run out of range under the limit,
 * and then it gets the red dot without a bar. `size="verdict"` is the run page's large version; `ticks` prints 0, the
 * limit and the end under it. Without a `label` the line is decoration, for a row that prints the score beside it.
 */
export function ScoreLine({ z, k, end, out, size = 'row', ticks = false, label }: {
  z: number
  k: number | null
  end: number
  out: boolean
  size?: 'row' | 'verdict'
  ticks?: boolean
  label?: string
}) {
  const at = (value: number) => `${(100 * Math.min(Math.max(value, 0), end)) / end}%`
  const limitNearStart = k !== null && k / end < NEAR_START
  const classes = `score-line ${size} ${out ? 'out' : 'in'}${z > end ? ' past' : ''}`
  return (
    <span className={classes} role={label === undefined ? undefined : 'img'} aria-label={label} aria-hidden={label === undefined ? true : undefined}>
      <span className="sl-axis" />
      {!out && <span className="sl-stem" style={{ width: at(z) }} />}
      {k !== null && <span className="sl-limit" style={{ left: at(k) }} />}
      {out && k !== null && z > k && <span className="sl-bar" style={{ left: at(k), width: `calc(${at(z)} - ${at(k)})` }} />}
      <span className="sl-point" style={{ left: at(z) }} />
      {ticks && (
        <>
          {/* a limit near 0 takes the start's place, since its label would cover the 0 */}
          {!limitNearStart && <span className="sl-tick start">0</span>}
          {k !== null && (
            <span className={limitNearStart ? 'sl-tick limit near-start' : 'sl-tick limit'} style={{ left: at(k) }}>{`limit ${formatScore(k)}`}</span>
          )}
          <span className="sl-tick end">{`${end}${z > end ? '+' : ''}`}</span>
        </>
      )}
    </span>
  )
}
