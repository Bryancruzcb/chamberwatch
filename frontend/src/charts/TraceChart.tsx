import { type CSSProperties, type KeyboardEvent, type PointerEvent, useId, useMemo, useState } from 'react'
import type { Trace, TracePoint } from '../api/schema'
import { formatScore, formatSeconds, formatValue, MISSING } from '../format'
import { type LinearScale, linearScale, niceInterval, niceTicks } from './scale'
import {
  bandAt,
  bandSegments,
  type BandVertex,
  bucketTime,
  envelopeSegments,
  type ExcursionSpan,
  excursionSpans,
  nearestIndex,
  traceExtent,
  type Vertex,
} from './trace'
import { useWidth } from './useWidth'

const PLOT_HEIGHT = 280
const MARGIN = { top: 12, right: 16, bottom: 44, left: 64 } as const
const HEIGHT = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom
/** Room the readout needs to the right of the crosshair before it moves to the left side. */
const READOUT_WIDTH = 240

interface Layout {
  readonly x: LinearScale
  readonly y: LinearScale
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
  readonly reading: readonly string[]
  readonly band: ReadonlyArray<{ readonly area: string; readonly mean: string }>
  readonly xTicks: readonly number[]
  readonly yTicks: readonly number[]
}

/**
 * A channel's reading against the good runs' band, with its excursions shaded. The pointer or the arrow keys read off
 * one bucket at a time, and the table view lists every bucket.
 */
export function TraceChart({ trace }: { trace: Trace }) {
  const [width, measure] = useWidth()
  const [active, setActive] = useState<number | null>(null)
  const [tableShown, setTableShown] = useState(false)
  const clipId = `trace-clip-${useId().replace(/[^\w-]/g, '')}`
  const layout = useMemo(() => layoutTrace(trace, width), [trace, width])
  const spans = useMemo(() => excursionSpans(trace.excursions), [trace])

  if (trace.points.length === 0) {
    return <p className="status-line">No samples in this range.</p>
  }

  function readAt(event: PointerEvent<SVGRectElement>) {
    const svg = event.currentTarget.ownerSVGElement
    if (layout === null || svg === null) {
      return
    }
    const bounds = svg.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * width
    setActive(nearestIndex(trace.points, layout.x.invert(x)))
  }

  function step(event: KeyboardEvent<SVGSVGElement>) {
    const last = trace.points.length - 1
    const current = active ?? 0
    const stride = event.shiftKey ? 10 : 1
    let next: number | null
    switch (event.key) {
      case 'ArrowRight':
        next = Math.min(last, current + stride)
        break
      case 'ArrowLeft':
        next = Math.max(0, current - stride)
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

  const point = active === null ? undefined : trace.points[active]
  const range = trace.fromCycle === null || trace.toCycle === null
    ? 'the whole record'
    : `cycles ${trace.fromCycle} to ${trace.toCycle}`

  return (
    <figure className="chart">
      <ul className="chart-key" aria-label="Key">
        <li><span className="key-line" />Reading, lowest and highest per bucket</li>
        {trace.k !== null && <li><span className="key-swatch key-band" />{`Good-run band, mean ± ${formatScore(trace.k)} sd`}</li>}
        {spans.length > 0 && <li><span className="key-swatch key-excursion" />{`Excursions (${spans.length})`}</li>}
      </ul>
      <div className="chart-frame" ref={measure}>
        {layout !== null && (
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`}
            height={HEIGHT}
            role="img"
            aria-label={`${trace.channel} across ${range}. Arrow keys read one bucket at a time.`}
            tabIndex={0}
            onKeyDown={step}
            onFocus={() => setActive((current) => current ?? startIndex(trace.points, spans))}
            onBlur={() => setActive(null)}
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={layout.left} y={layout.top} width={layout.right - layout.left} height={PLOT_HEIGHT} />
              </clipPath>
            </defs>
            {layout.yTicks.map((tick) => (
              <g key={tick}>
                <line className="gridline" x1={layout.left} x2={layout.right} y1={layout.y.map(tick)} y2={layout.y.map(tick)} />
                <text className="tick" x={layout.left - 8} y={layout.y.map(tick)} dy="0.32em" textAnchor="end">
                  {formatValue(tick)}
                </text>
              </g>
            ))}
            <g clipPath={`url(#${clipId})`}>
              {spans.map((span) => {
                const x = layout.x.map(span.start)
                const spanWidth = Math.max(2, layout.x.map(span.end) - x)
                return (
                  <g key={span.excursion.startSlot} data-kind="excursion">
                    <rect className="excursion-span" x={x} y={layout.top} width={spanWidth} height={PLOT_HEIGHT} />
                    <rect className="excursion-cap" x={x} y={layout.top} width={spanWidth} height={3} />
                  </g>
                )
              })}
              {layout.band.map((band, index) => (
                <g key={index}>
                  <path className="band-area" d={band.area} />
                  <path className="band-mean" d={band.mean} />
                </g>
              ))}
              {layout.reading.map((d, index) => <path key={index} className="reading" d={d} />)}
            </g>
            <line className="axis-line" x1={layout.left} x2={layout.right} y1={layout.bottom} y2={layout.bottom} />
            {layout.xTicks.map((tick) => (
              <text key={tick} className="tick" x={layout.x.map(tick)} y={layout.bottom + 18} textAnchor="middle">
                {tick}
              </text>
            ))}
            <text className="axis-title" x={layout.right} y={HEIGHT - 6} textAnchor="end">Record time, seconds</text>
            {point !== undefined && (
              <g aria-hidden="true">
                <line
                  className="crosshair"
                  x1={layout.x.map(bucketTime(point))}
                  x2={layout.x.map(bucketTime(point))}
                  y1={layout.top}
                  y2={layout.bottom}
                />
                <circle className="marker" cx={layout.x.map(bucketTime(point))} cy={layout.y.map(point.max)} r={4} />
                {point.min !== point.max && (
                  <circle className="marker" cx={layout.x.map(bucketTime(point))} cy={layout.y.map(point.min)} r={4} />
                )}
              </g>
            )}
            <rect
              className="hit"
              x={layout.left}
              y={layout.top}
              width={layout.right - layout.left}
              height={PLOT_HEIGHT}
              onPointerMove={readAt}
              onPointerLeave={() => setActive(null)}
            />
          </svg>
        )}
        {point !== undefined && layout !== null && (
          <Readout point={point} k={trace.k} spans={spans} x={layout.x.map(bucketTime(point))} width={width} />
        )}
      </div>
      <button type="button" className="link-button" aria-expanded={tableShown} onClick={() => setTableShown(!tableShown)}>
        {tableShown ? 'Hide the table' : 'Show as a table'}
      </button>
      {tableShown && <TraceTable trace={trace} />}
    </figure>
  )
}

function Readout({ point, k, spans, x, width }: {
  point: TracePoint
  k: number | null
  spans: readonly ExcursionSpan[]
  x: number
  width: number
}) {
  const time = bucketTime(point)
  const band = bandAt(point, k)
  const span = spans.find((candidate) => time >= candidate.start && time <= candidate.end)
  const style: CSSProperties = x + 12 + READOUT_WIDTH > width
    ? { right: width - x + 12, top: MARGIN.top }
    : { left: x + 12, top: MARGIN.top }
  return (
    <div className="readout" style={style}>
      <p className="readout-value">
        {point.min === point.max ? formatValue(point.min) : `${formatValue(point.min)} to ${formatValue(point.max)}`}
      </p>
      <dl>
        <div><dt>Time</dt><dd>{formatSeconds(time)}</dd></div>
        <div>
          <dt>Recipe</dt>
          <dd>
            {point.position === null
              ? 'Outside the etch'
              : `Cycle ${point.position.cycle}, ${point.position.phase} slot ${point.position.offset}`}
          </dd>
        </div>
        <div><dt>Good runs</dt><dd>{band === null ? MISSING : `${formatValue(band.low)} to ${formatValue(band.high)}`}</dd></div>
        {span !== undefined && (
          <div className="readout-alert"><dt>Excursion</dt><dd>{`Peak z ${formatScore(span.excursion.peakZ)}`}</dd></div>
        )}
      </dl>
    </div>
  )
}

function TraceTable({ trace }: { trace: Trace }) {
  return (
    <div className="table-wrap table-scroll">
      <table>
        <caption className="visually-hidden">{`${trace.channel}, one row per bucket`}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">Time</th>
            <th scope="col" className="num">Cycle</th>
            <th scope="col">Phase</th>
            <th scope="col" className="num">Slot</th>
            <th scope="col" className="num">Lowest</th>
            <th scope="col" className="num">Highest</th>
            <th scope="col" className="num">Band low</th>
            <th scope="col" className="num">Band high</th>
          </tr>
        </thead>
        <tbody>
          {trace.points.map((point) => {
            const band = bandAt(point, trace.k)
            return (
              <tr key={point.startS}>
                <td className="num">{formatSeconds(bucketTime(point))}</td>
                <td className="num">{point.position?.cycle ?? MISSING}</td>
                <td>{point.position?.phase ?? MISSING}</td>
                <td className="num">{point.position?.offset ?? MISSING}</td>
                <td className="num">{formatValue(point.min)}</td>
                <td className="num">{formatValue(point.max)}</td>
                <td className="num">{formatValue(band?.low ?? null)}</td>
                <td className="num">{formatValue(band?.high ?? null)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function layoutTrace(trace: Trace, width: number): Layout | null {
  const extent = traceExtent(trace.points)
  const left = MARGIN.left
  const right = width - MARGIN.right
  if (extent === null || right - left < 40) {
    return null
  }
  const top = MARGIN.top
  const bottom = MARGIN.top + PLOT_HEIGHT
  const x = linearScale(extent.time, [left, right])
  const y = linearScale(niceInterval(extent.value, 5), [bottom, top])
  return {
    x,
    y,
    left,
    right,
    top,
    bottom,
    reading: envelopeSegments(trace.points).map((segment) => linePath(segment, x, y)),
    band: bandSegments(trace.points, trace.k).map((segment) => ({
      area: areaPath(segment, x, y),
      mean: linePath(segment.map((vertex): Vertex => [vertex.time, vertex.mean]), x, y),
    })),
    xTicks: niceTicks(extent.time, Math.max(2, Math.floor((right - left) / 100))),
    yTicks: niceTicks(y.domain, 5),
  }
}

/** Where keyboard reading starts: the first excursion when there is one, the first bucket otherwise. */
function startIndex(points: readonly TracePoint[], spans: readonly ExcursionSpan[]): number {
  const first = spans[0]
  return first === undefined ? 0 : (nearestIndex(points, first.start) ?? 0)
}

function linePath(vertices: readonly Vertex[], x: LinearScale, y: LinearScale): string {
  return vertices
    .map(([time, value], index) => `${index === 0 ? 'M' : 'L'}${x.map(time).toFixed(1)},${y.map(value).toFixed(1)}`)
    .join('')
}

function areaPath(segment: readonly BandVertex[], x: LinearScale, y: LinearScale): string {
  const upper = segment.map((vertex): Vertex => [vertex.time, vertex.high])
  const lower = segment.map((vertex): Vertex => [vertex.time, vertex.low]).reverse()
  return `${linePath([...upper, ...lower], x, y)}Z`
}
