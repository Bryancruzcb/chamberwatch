import { formatUnusual } from '../format'

/** A persistent z against the limit k. The track runs to twice the limit, so the limit mark sits halfway. */
export function ZMeter({ z, k }: { z: number; k: number }) {
  const max = 2 * k
  const share = Math.min(z, max) / max
  return (
    <span className="meter">
      <span
        className="meter-track"
        role="meter"
        aria-label="How unusual against the limit"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={z}
      >
        <span className={z > k ? 'meter-fill over' : 'meter-fill'} style={{ width: `${share * 100}%` }} />
        <span className="meter-limit" />
      </span>
      <span className="num">{formatUnusual(z)}</span>
    </span>
  )
}
