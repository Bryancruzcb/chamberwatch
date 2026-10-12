import type { RunRow } from '../api/schema'
import { formatScore, formatUnusual } from '../format'
import { runState } from '../summary'
import { useWidth } from './useWidth'

const HEIGHT = 116
const MARGIN = { top: 18, right: 52, bottom: 24, left: 8 } as const
/** The top of the axis. A step change runs to tens of thousands, which would flatten every other wafer. */
const Z_CAP = 25
/** Lots are planned at 10 wafers, so a shorter lot still shows where the missing wafers would sit. */
const MIN_POSITIONS = 10

/**
 * How unusual each scored wafer of a lot was, by its position, against the limit. Out-of-range wafers are filled red,
 * in-range ones gray, and the baseline runs hollow. The most unusual out-of-range wafer carries its value. Only the
 * first plot on the page carries the key, since every plot uses the same marks.
 */
export function LotDotPlot({ lotNo, runs, k, legend }: { lotNo: number; runs: readonly RunRow[]; k: number; legend: boolean }) {
  const [measured, measure] = useWidth()
  const width = measured > 0 ? measured : 320
  const scored = runs.flatMap((run) => (run.score === null ? [] : [{ run, z: run.score.persistentZ, out: runState(run) === 'out' }]))
  const last = Math.max(MIN_POSITIONS, ...runs.map((run) => run.positionInLot))
  const plotWidth = width - MARGIN.left - MARGIN.right
  const x = (position: number) => MARGIN.left + ((position - 1) / Math.max(1, last - 1)) * plotWidth
  const y = (z: number) => MARGIN.top + (1 - Math.min(Math.max(z, 0), Z_CAP) / Z_CAP) * (HEIGHT - MARGIN.top - MARGIN.bottom)
  const out = scored.filter((point) => point.out)
  const top = out.reduce<(typeof out)[number] | null>((best, point) => (best === null || point.z > best.z ? point : best), null)
  const label = `How unusual each wafer of Lot ${lotNo} was, by position. ${out.length} past the limit of ${formatScore(k)}`
    + `${top === null ? '' : `; the highest is ${formatUnusual(top.z)}, wafer ${top.run.positionInLot}`}.`
  return (
    <figure className="dot-plot">
      <div ref={measure}>
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} role="img" aria-label={label}>
          <line className="dot-zero" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(0)} y2={y(0)} />
          <line className="dot-limit" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(k)} y2={y(k)} />
          <text className="tick" x={width - MARGIN.right + 6} y={y(k) + 4}>{`limit ${formatScore(k)}`}</text>
          {scored.map(({ run, z, out: over }) => (
            <circle
              key={run.id}
              data-kind="dot"
              className={over ? 'lot-dot out' : run.good ? 'lot-dot baseline' : 'lot-dot'}
              cx={x(run.positionInLot)}
              cy={y(z)}
              r={4.5}
            />
          ))}
          {Array.from({ length: last }, (_, index) => index + 1).map((position) => (
            <text key={position} className="tick" x={x(position)} y={HEIGHT - 6} textAnchor="middle">{position}</text>
          ))}
          {top !== null && (
            <text className="dot-top" x={x(top.run.positionInLot)} y={y(top.z) - 9} textAnchor="middle">{formatUnusual(top.z)}</text>
          )}
        </svg>
      </div>
      {legend && (
        <figcaption className="plot-key">
          <span><i className="key-dot out" aria-hidden="true" />out of range</span>
          <span><i className="key-dot" aria-hidden="true" />in range</span>
          <span><i className="key-dot baseline" aria-hidden="true" />baseline run</span>
        </figcaption>
      )}
    </figure>
  )
}
