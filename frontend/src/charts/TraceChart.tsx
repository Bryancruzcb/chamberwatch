import { type CSSProperties, type KeyboardEvent, type PointerEvent, useId, useMemo, useState } from 'react'
import type { Hold, Trace, TracePoint } from '../api/schema'
import { describeClip, formatScore, formatSeconds, formatValue, MISSING } from '../format'
import { type LinearScale, linearScale, niceInterval, niceTicks } from './scale'
import {
  bandAt,
  bandSegments,
  type BandVertex,
  bucketsIn,
  bucketTime,
  clips,
  envelopeOutlines,
  type ExcursionSpan,
  excursionSpans,
  fitTraceDomain,
  nearestIndex,
  traceExtent,
  type Vertex,
} from './trace'
import { useWidth } from './useWidth'

const PLOT_HEIGHT = 260
const MARGIN = { top: 44, right: 20, bottom: 34, left: 48 } as const
const HEIGHT = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom
/** Room the readout needs to the right of the crosshair before it moves to the left side. */
const READOUT_WIDTH = 240
/** Narrower than this, the first-excursion label moves to the top of the plot, clear of the band's label. */
const NARROW = 480
/** Where along the time axis the band's direct label points, as a share of the plot. */
const BAND_LABEL_AT = 0.22
/** The band must be at least this many pixels tall where its label points, or the label would point at the reading. */
const MIN_BAND_LABEL = 6
/** How far either side of the first excursion, in pixels, the reading is checked for room for its label. */
const FIRST_LABEL_REACH = 60
/** The narrowest an excursion's tick on the rail is drawn, so one sample still shows. */
const MIN_TICK = 2.5

interface Label {
  readonly x: number
  readonly y: number
  readonly anchor: 'start' | 'end'
  readonly leader: readonly [x1: number, y1: number, x2: number, y2: number]
}

interface Layout {
  readonly x: LinearScale
  readonly y: LinearScale
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
  readonly reading: readonly string[]
  readonly out: ReadonlyArray<{ readonly key: number; readonly paths: readonly string[] }>
  readonly band: readonly string[]
  readonly bandLabel: Label | null
  readonly first: { readonly label: Label; readonly s: number; readonly kind: 'excursion' | 'hold' } | null
  readonly note: { readonly text: string; readonly x: number; readonly y: number } | null
  readonly xTicks: readonly number[]
  readonly yTicks: readonly number[]
}

/**
 * A channel's reading against the good runs' band. The reading is an ink envelope of each bucket's lowest to highest
 * value, redrawn in red inside each excursion, with the excursions ticked on a red rail above the plot. The etch and
 * cycles views fit the y axis past the start-up ramp and say what they clip; the whole record shows everything. The
 * pointer or the arrow keys read off one bucket at a time, and the table view lists every bucket.
 */
export function TraceChart({ trace, holds = [] }: {
  trace: Trace
  /** The channel's stuck values, ticked on the rail beside the excursions; a trace does not carry them itself. */
  holds?: readonly Hold[]
}) {
  const [width, measure] = useWidth()
  const [active, setActive] = useState<number | null>(null)
  const [tableShown, setTableShown] = useState(false)
  const uid = useId().replace(/[^\w-]/g, '')
  const clipId = `trace-clip-${uid}`
  const hatchId = `trace-hatch-${uid}`
  const spans = useMemo(() => excursionSpans(trace.excursions), [trace])
  const stuck = useMemo(() => holds.flatMap((hold) => (hold.startTimeS === null || hold.endTimeS === null
    ? []
    : [{ start: hold.startTimeS, end: hold.endTimeS, key: hold.startSlot }])), [holds])
  const layout = useMemo(() => layoutTrace(trace, spans, stuck[0]?.start ?? null, width), [trace, spans, stuck, width])
  const railWords = [
    ...(spans.length > 0 ? [`${spans.length} ${spans.length === 1 ? 'excursion' : 'excursions'}`] : []),
    ...(stuck.length > 0 ? [`${stuck.length} stuck ${stuck.length === 1 ? 'value' : 'values'}`] : []),
  ].join(', ')

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
    <figure className="chart trace">
      <ul className="chart-key" aria-label="Key">
        <li><span className="key-swatch key-reading" />Reading, lowest to highest per bucket</li>
        {trace.k !== null && <li><span className="key-swatch key-band" />Good-run range</li>}
        {spans.length > 0 && <li><span className="key-swatch key-excursion" />Out of the range</li>}
        {stuck.length > 0 && <li><span className="key-swatch key-span hold" />Stuck value</li>}
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
              <pattern id={hatchId} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line className="hatch" x1={0} y1={0} x2={0} y2={4} />
              </pattern>
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
              {layout.band.map((d, index) => <path key={index} className="band-area" d={d} />)}
              {layout.reading.map((d, index) => <path key={index} className="reading" d={d} />)}
              {layout.out.map((span) => span.paths.map((d, index) => <path key={`${span.key}-${index}`} className="reading out" d={d} />))}
            </g>
            {layout.note !== null && <text className="chart-note" x={layout.note.x} y={layout.note.y}>{layout.note.text}</text>}
            {railWords !== '' && (
              <g className="rail">
                <text className="chart-note" x={layout.left} y={layout.top - 24}>{railWords}</text>
                <line className="rail-line" x1={layout.left} x2={layout.right} y1={layout.top - 10} y2={layout.top - 10} />
                {spans.map((span) => {
                  const x = layout.x.map(span.start)
                  return (
                    <rect
                      key={span.excursion.startSlot}
                      data-kind="excursion"
                      className="rail-tick"
                      x={x}
                      y={layout.top - 16}
                      width={Math.max(MIN_TICK, layout.x.map(span.end) - x)}
                      height={12}
                    />
                  )
                })}
                {stuck.map((hold) => {
                  const x = layout.x.map(hold.start)
                  return (
                    <rect
                      key={hold.key}
                      data-kind="hold"
                      className="rail-hold"
                      fill={`url(#${hatchId})`}
                      x={x}
                      y={layout.top - 16}
                      width={Math.max(MIN_TICK * 2, layout.x.map(hold.end) - x)}
                      height={12}
                    />
                  )
                })}
              </g>
            )}
            {layout.first !== null && (
              <Annotation label={layout.first.label} className="chart-ann" dashed>
                {`${layout.first.kind === 'hold' ? 'Stuck from' : 'First,'} ${formatSeconds(layout.first.s)}`}
              </Annotation>
            )}
            {layout.bandLabel !== null && trace.k !== null && (
              <Annotation label={layout.bandLabel} className="chart-note">{`Good-run range, mean ± ${formatScore(trace.k)} sd`}</Annotation>
            )}
            <line className="axis-line" x1={layout.left} x2={layout.right} y1={layout.bottom} y2={layout.bottom} />
            {layout.xTicks.map((tick) => (
              <g key={tick}>
                <line className="axis-mark" x1={layout.x.map(tick)} x2={layout.x.map(tick)} y1={layout.bottom} y2={layout.bottom + 5} />
                <text className="tick" x={layout.x.map(tick)} y={layout.bottom + 19} textAnchor="middle">{tick}</text>
              </g>
            ))}
            <text className="tick" x={layout.right + 4} y={layout.bottom + 19}>s</text>
            {point !== undefined && (
              <g aria-hidden="true">
                <line
                  className="crosshair"
                  x1={layout.x.map(bucketTime(point))}
                  x2={layout.x.map(bucketTime(point))}
                  y1={layout.top}
                  y2={layout.bottom}
                />
                <circle className="marker" cx={layout.x.map(bucketTime(point))} cy={clampY(layout, point.max)} r={4} />
                {point.min !== point.max && (
                  <circle className="marker" cx={layout.x.map(bucketTime(point))} cy={clampY(layout, point.min)} r={4} />
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

/** A direct label with its leader line. */
function Annotation({ label, className, dashed = false, children }: { label: Label; className: string; dashed?: boolean; children: string }) {
  const [x1, y1, x2, y2] = label.leader
  return (
    <g aria-hidden="true">
      <line className={dashed ? 'leader dashed' : 'leader'} x1={x1} y1={y1} x2={x2} y2={y2} />
      <text className={className} x={label.x} y={label.y} textAnchor={label.anchor}>{children}</text>
    </g>
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

function layoutTrace(trace: Trace, spans: readonly ExcursionSpan[], stuckFrom: number | null, width: number): Layout | null {
  const extent = traceExtent(trace.points)
  const left = MARGIN.left
  const right = width - MARGIN.right
  if (extent === null || right - left < 40) {
    return null
  }
  const top = MARGIN.top
  const bottom = MARGIN.top + PLOT_HEIGHT
  // the whole record shows everything; a span of cycles fits past the start-up ramp and notes what it clips
  const fitted = trace.fromCycle !== null
  const domain = fitted ? fitTraceDomain(trace.points, trace.k).domain : niceInterval(extent.value, 5)
  const x = linearScale(extent.time, [left, right])
  const y = linearScale(domain, [bottom, top])
  const outline = (vertices: readonly Vertex[]) => `${linePath(vertices, x, y)}Z`
  const segments = bandSegments(trace.points, trace.k)
  const cut = fitted ? clips(trace.points, y.domain) : []
  // a ramp clipped at the start gets its note just past the ramp, on the side it was cut
  const ramp = cut.find((clip) => clip.atStart)
  const below = cut.some((clip) => clip.side === 'below')
  return {
    x,
    y,
    left,
    right,
    top,
    bottom,
    reading: envelopeOutlines(trace.points).map(outline),
    out: spans.map((span) => ({ key: span.excursion.startSlot, paths: envelopeOutlines(bucketsIn(trace.points, span)).map(outline) })),
    band: segments.map((segment) => areaPath(segment, x, y)),
    bandLabel: bandLabel(segments, x, y, { left, right, top, bottom }),
    first: firstMoment(spans[0]?.start ?? null, stuckFrom, trace.points, x, y, { left, right, top, bottom }, width < NARROW),
    note: cut.length === 0
      ? null
      : {
          text: cut.map(describeClip).join('. '),
          x: Math.min(Math.max(left + 8, ramp === undefined ? 0 : x.map(ramp.untilS) + 6), right - 240),
          y: below ? bottom - 8 : top + 16,
        },
    xTicks: niceTicks(extent.time, Math.max(2, Math.floor((right - left) / 100))),
    yTicks: niceTicks(y.domain, 5),
  }
}

type Plot = { left: number; right: number; top: number; bottom: number }

/** The first moment the channel left its range, an excursion or a stuck value, whichever came first. */
function firstMoment(excursionS: number | null, stuckS: number | null, points: readonly TracePoint[], x: LinearScale, y: LinearScale, plot: Plot, narrow: boolean): Layout['first'] {
  const kind = excursionS === null || (stuckS !== null && stuckS < excursionS) ? 'hold' : 'excursion'
  const s = kind === 'hold' ? stuckS : excursionS
  if (s === null) {
    return null
  }
  return { label: firstLabel(s, points, x, y, plot, narrow), s, kind }
}

/**
 * The dashed leader at the first excursion, labelled in the clear space under the reading there, or over it when the
 * reading runs low, and at the top of a narrow chart, where the band's label needs the space below.
 */
function firstLabel(s: number, points: readonly TracePoint[], x: LinearScale, y: LinearScale, plot: Plot, narrow: boolean): Label {
  const at = x.map(s)
  const near = points.filter((point) => Math.abs(x.map(bucketTime(point)) - at) <= FIRST_LABEL_REACH)
  const lowest = Math.min(plot.bottom, Math.max(plot.top, ...near.map((point) => y.map(point.min))))
  const highest = Math.max(plot.top, Math.min(plot.bottom, ...near.map((point) => y.map(point.max))))
  const roomBelow = lowest + 18 <= plot.bottom - 24
  const labelY = !narrow && roomBelow ? lowest + 18 : Math.max(plot.top + 14, highest - 12)
  const flip = at > plot.right - 120
  return { x: flip ? at - 6 : at + 6, y: labelY + 4, anchor: flip ? 'end' : 'start', leader: [at, plot.top - 4, at, labelY] }
}

/**
 * Where the band's direct label goes: a fifth of the way along, under the band if there is room above the axis and
 * over it otherwise, with a leader into the band. None where no band reaches that point or there is no room.
 */
function bandLabel(segments: readonly (readonly BandVertex[])[], x: LinearScale, y: LinearScale, plot: Plot): Label | null {
  const target = x.invert(plot.left + (plot.right - plot.left) * BAND_LABEL_AT)
  const vertex = segments.flat().reduce<BandVertex | null>((best, candidate) => (
    best === null || Math.abs(candidate.time - target) < Math.abs(best.time - target) ? candidate : best
  ), null)
  if (vertex === null) {
    return null
  }
  const at = x.map(vertex.time)
  const low = Math.min(Math.max(y.map(vertex.low), plot.top), plot.bottom)
  const high = Math.min(Math.max(y.map(vertex.high), plot.top), plot.bottom)
  // a band too thin to see there gets no label pointing at it; the key still names it
  if (low - high < MIN_BAND_LABEL) {
    return null
  }
  if (low + 44 < plot.bottom - 24) {
    return { x: at + 14, y: low + 44, anchor: 'start', leader: [at + 12, low + 32, at, low - 4] }
  }
  if (high - 30 > plot.top + 14) {
    return { x: at + 14, y: high - 30, anchor: 'start', leader: [at + 12, high - 26, at, high + 4] }
  }
  return null
}

/** A marker on the chart's edge for a value the axis clips, so the readout still points at it. */
function clampY(layout: Layout, value: number): number {
  return Math.min(Math.max(layout.y.map(value), layout.top), layout.bottom)
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
