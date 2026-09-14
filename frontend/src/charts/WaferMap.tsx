import { type CSSProperties, type KeyboardEvent, useState } from 'react'
import type { MeasurementPoint, Measurements } from '../api/schema'
import { formatMeasurementSet, formatMicrons, MISSING } from '../format'
import { type Interval, linearScale } from './scale'
import { binIndex } from './sequential'
import { useWidth } from './useWidth'

const SIZE = 440
const PAD = 12
/** The public wafers are 200 mm across. */
const WAFER_RADIUS_UM = 100_000
/** Steps of the depth ramp, each one hue step darker, or lighter in dark mode. */
const BINS = 6
const READOUT_WIDTH = 240

/**
 * Etch depth at each measured site, placed where it sits on the wafer and shaded by depth on one blue ramp. The
 * pointer or the arrow keys read one site at a time, and the table view lists every site.
 */
export function WaferMap({ measurements }: { measurements: Measurements }) {
  const [width, measure] = useWidth()
  const [active, setActive] = useState<number | null>(null)
  const [tableShown, setTableShown] = useState(false)
  const { values } = measurements

  if (values.length === 0) {
    return <p className="status-line">{`This wafer has no ${formatMeasurementSet(measurements.set)} measurements.`}</p>
  }

  const depths = values.map((site) => site.depthUm)
  const range: Interval = [Math.min(...depths), Math.max(...depths)]
  const x = linearScale([-WAFER_RADIUS_UM, WAFER_RADIUS_UM], [PAD, SIZE - PAD])
  const y = linearScale([-WAFER_RADIUS_UM, WAFER_RADIUS_UM], [SIZE - PAD, PAD])
  const radius = values.length > 20 ? 8 : 12
  const site = active === null ? undefined : values[active]
  const zoom = width > 0 ? width / SIZE : 1

  function step(event: KeyboardEvent<SVGSVGElement>) {
    const last = values.length - 1
    const current = active ?? 0
    let next: number | null
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = Math.min(last, current + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = Math.max(0, current - 1)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      case 'Escape':
        next = null
        break
      default:
        return
    }
    event.preventDefault()
    setActive(next)
  }

  return (
    <figure className="chart wafer-chart">
      <div className="wafer-frame" ref={measure}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Etch depth at ${values.length} sites, from ${formatMicrons(range[0])} to ${formatMicrons(range[1])}. Arrow keys read one site at a time.`}
          tabIndex={0}
          onKeyDown={step}
          onFocus={() => setActive((current) => current ?? 0)}
          onBlur={() => setActive(null)}
        >
          <circle className="wafer" cx={SIZE / 2} cy={SIZE / 2} r={x.map(WAFER_RADIUS_UM) - x.map(0)} />
          {values.map((point, index) => (
            <g key={point.pointNo}>
              <circle
                data-kind="site"
                className={`site seq-${binIndex(point.depthUm, range, BINS) + 1}${index === active ? ' active' : ''}`}
                cx={x.map(point.xUm)}
                cy={y.map(point.yUm)}
                r={radius}
              />
              <circle
                className="site-hit"
                cx={x.map(point.xUm)}
                cy={y.map(point.yUm)}
                r={Math.max(radius + 4, 12)}
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive(null)}
              />
            </g>
          ))}
        </svg>
        {site !== undefined && (
          <SiteReadout site={site} left={x.map(site.xUm) * zoom} top={y.map(site.yUm) * zoom} width={width} />
        )}
      </div>
      <div className="wafer-side">
        <div className="scale-legend" aria-hidden="true">
          <div className="scale-swatches">
            {Array.from({ length: BINS }, (_, index) => <span key={index} className={`seq-${index + 1}`} />)}
          </div>
          <div className="scale-labels">
            <span>{`Shallowest ${formatMicrons(range[0])}`}</span>
            <span>{`Deepest ${formatMicrons(range[1])}`}</span>
          </div>
        </div>
        <button type="button" className="link-button" aria-expanded={tableShown} onClick={() => setTableShown(!tableShown)}>
          {tableShown ? 'Hide the table' : 'Show as a table'}
        </button>
      </div>
      {tableShown && <SiteTable values={values} />}
    </figure>
  )
}

function SiteReadout({ site, left, top, width }: { site: MeasurementPoint; left: number; top: number; width: number }) {
  const style: CSSProperties = left + 16 + READOUT_WIDTH > width
    ? { right: width - left + 16, top: Math.max(0, top - 16) }
    : { left: left + 16, top: Math.max(0, top - 16) }
  return (
    <div className="readout" style={style}>
      <p className="readout-value">{formatMicrons(site.depthUm)}</p>
      <dl>
        <div><dt>Site</dt><dd>{site.locId ?? `Point ${site.pointNo}`}</dd></div>
        <div><dt>Position</dt><dd>{`x ${millimetres(site.xUm)}, y ${millimetres(site.yUm)}`}</dd></div>
        <div>
          <dt>Remaining oxide</dt>
          <dd>{`${formatMicrons(site.postoxUm)}${site.postoxMeasured ? '' : ', interpolated'}`}</dd>
        </div>
      </dl>
    </div>
  )
}

function SiteTable({ values }: { values: readonly MeasurementPoint[] }) {
  return (
    <div className="table-wrap table-scroll">
      <table>
        <caption className="visually-hidden">Measured sites</caption>
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col" className="num">x</th>
            <th scope="col" className="num">y</th>
            <th scope="col" className="num">Depth</th>
            <th scope="col" className="num">Step height</th>
            <th scope="col" className="num">Remaining oxide</th>
          </tr>
        </thead>
        <tbody>
          {values.map((site) => (
            <tr key={site.pointNo}>
              <td>{site.locId ?? `Point ${site.pointNo}`}</td>
              <td className="num">{millimetres(site.xUm)}</td>
              <td className="num">{millimetres(site.yUm)}</td>
              <td className="num">{formatMicrons(site.depthUm)}</td>
              <td className="num">{formatMicrons(site.stepheightUm)}</td>
              <td className="num">{site.postoxMeasured ? formatMicrons(site.postoxUm) : `${formatMicrons(site.postoxUm)}, interpolated`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {values.length === 0 && <p className="status-line">{MISSING}</p>}
    </div>
  )
}

function millimetres(micrometres: number): string {
  return `${Math.round(micrometres / 1000)} mm`
}
