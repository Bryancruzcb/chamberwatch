import { formatAgainstLimit, formatScore } from '../format'

/** A persistent z against the limit k. The track runs to twice the limit, so the limit mark sits halfway. */
export function ZMeter({ z, k }: { z: number; k: number }) {
  const max = 2 * k
  const share = Math.min(Math.max(z, 0), max) / max
  // a value that would print as the limit itself gets a second decimal, so the text agrees with the fill's color
  const text = formatAgainstLimit(z, k)
  return (
    <span className="meter">
      <span
        className="meter-track"
        role="meter"
        aria-label={`How unusual against the limit of ${formatScore(k)}`}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(Math.max(z, 0), max)}
        aria-valuetext={text}
      >
        <span className={z > k ? 'meter-fill over' : 'meter-fill'} style={{ width: `${share * 100}%` }} />
        <span className="meter-limit" />
      </span>
      <span className="num meter-value">{text}</span>
    </span>
  )
}
