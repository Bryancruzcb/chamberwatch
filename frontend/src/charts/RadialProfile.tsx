import type { MeasurementPoint } from '../api/schema'
import { formatMicrons } from '../format'
import { radialProfile } from '../wafer'
import { type Interval } from './scale'
import { binIndex } from './sequential'
import { useWidth } from './useWidth'

const HEIGHT = 168
const MARGIN = { top: 8, right: 8, bottom: 34, left: 68 } as const
/** Room above the deepest site and below the shallowest, so no dot sits on the axis line. */
const HEADROOM = 0.08
/** The public wafers are 200 mm across, so a site sits at most 100 mm from the center. */
const EDGE_MM = 100
const RADIUS_TICKS = [0, 25, 50, 75, 100] as const
/** The same six steps of the depth ramp as the wafer map, so a dot here has the color of its site there. */
const BINS = 6

/** Every site's depth against its distance from the wafer's center, on the map's color ramp. */
export function RadialProfile({ sites }: { sites: readonly MeasurementPoint[] }) {
  const [measured, measure] = useWidth()
  const width = measured > 0 ? measured : 320
  const profile = radialProfile(sites)
  const depths = profile.map((point) => point.depthUm)
  const range: Interval = [Math.min(...depths), Math.max(...depths)]
  const span = range[1] - range[0] || 1
  const plotWidth = width - MARGIN.left - MARGIN.right
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const x = (mm: number) => MARGIN.left + (Math.min(mm, EDGE_MM) / EDGE_MM) * plotWidth
  const y = (um: number) => MARGIN.top + (1 - HEADROOM - ((um - range[0]) / span) * (1 - 2 * HEADROOM)) * plotHeight
  return (
    <figure className="profile-plot">
      <figcaption className="profile-title">Depth from center to edge</figcaption>
      <div ref={measure}>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Depth of ${profile.length} sites by distance from the wafer's center, from ${formatMicrons(range[0])} to ${formatMicrons(range[1])}.`}
        >
          <line className="profile-axis" x1={MARGIN.left} x2={width - MARGIN.right} y1={HEIGHT - MARGIN.bottom} y2={HEIGHT - MARGIN.bottom} />
          {[range[0], range[1]].map((um) => (
            <text key={um} className="tick" x={MARGIN.left - 8} y={y(um) + 4} textAnchor="end">{`${um.toFixed(1)} µm`}</text>
          ))}
          {profile.map((point, index) => (
            <circle
              key={index}
              data-kind="profile-site"
              className={`profile-dot seq-${binIndex(point.depthUm, range, BINS) + 1}`}
              cx={x(point.radiusMm)}
              cy={y(point.depthUm)}
              r={profile.length > 20 ? 3.5 : 5}
            />
          ))}
          {RADIUS_TICKS.map((mm) => (
            <text key={mm} className="tick" x={x(mm)} y={HEIGHT - MARGIN.bottom + 16} textAnchor="middle">{mm}</text>
          ))}
          <text className="tick" x={width - MARGIN.right} y={HEIGHT - 2} textAnchor="end">mm from the center</text>
        </svg>
      </div>
    </figure>
  )
}
