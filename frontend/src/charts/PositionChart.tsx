import { type CSSProperties, type KeyboardEvent, type PointerEvent, useId, useState } from 'react'
import { MISSING } from '../format'
import { type LinearScale, linearScale, niceInterval, niceTicks, spreadLabels, tickFormat } from './scale'
import { useWidth } from './useWidth'

const PLOT_HEIGHT = 220
/** The top margin holds the baseline zone's label; the right one, when lines are labelled at their ends, the labels. */
const MARGIN = { top: 28, right: 16, bottom: 40, left: 56 } as const
const END_LABEL_ROOM = 72
const HEIGHT = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom
/** End labels sit at least this far apart: a value and a series name under it, or a value alone. */
const LABEL_GAP = { named: 34, bare: 18 } as const
/** Room the readout needs to the right of the crosshair before it moves to the left side. */
const READOUT_WIDTH = 240

export interface PositionPoint {
  readonly position: number
  readonly value: number
}

export interface PositionSeries {
  readonly id: string
  readonly name: string
  /** 1 is a heavy ink line with filled points; 2 a lighter dashed line with hollow points. Never a second hue. */
  readonly slot: 1 | 2
  readonly connect: boolean
  readonly points: readonly PositionPoint[]
}

export interface PositionBand {
  readonly low: number
  readonly high: number
  readonly mean: number
  readonly label: string
}

/** A straight line over wafer positions, solid across the wafers it was fitted on and dashed where it projects. */
export interface PositionFit {
  readonly intercept: number
  readonly slope: number
  readonly fittedTo: number
  readonly extendTo: number
  readonly label: string
}

interface Layout {
  readonly x: LinearScale
  readonly y: LinearScale
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/**
 * Values by wafer position in a lot, in ink: against an optional band and fitted line, with the baseline positions as
 * a paper zone, each line labelled at its end and the first line's peak annotated when asked. The pointer or the arrow
 * keys read one wafer at a time, every series at once.
 */
export function PositionChart({
  title, label, positions, series, band = null, fit = null, baseline = null, zoneLabel = 'BASELINE', labelEnds = false, peak = false,
  formatValue, details,
}: {
  title: string
  label: string
  positions: number
  series: readonly PositionSeries[]
  band?: PositionBand | null
  fit?: PositionFit | null
  /** The first N positions, shaded and labelled with `zoneLabel`. */
  baseline?: number | null
  /** What the shaded positions are: the baseline runs, or on a depth chart the reference wafers ("FIRST 3"). */
  zoneLabel?: string
  /** Print each connected line's last value at its end, with the series name under it when there are several. */
  labelEnds?: boolean
  /** Print the first line's highest value over its point, unless that point is the last and its end label says it. */
  peak?: boolean
  formatValue: (value: number) => string
  /** More rows for the readout at a position, each a name and a value, also read aloud. */
  details?: (position: number) => readonly ReadoutRow[]
}) {
  const [width, measure] = useWidth()
  const [active, setActive] = useState<number | null>(null)
  const clipId = `position-clip-${useId().replace(/[^\w-]/g, '')}`
  const layout = layoutPositions({ width, positions, series, band, fit, right: labelEnds ? END_LABEL_ROOM : MARGIN.right })
  const zone = baseline === null || layout === null ? null : Math.min(baseline, positions)
  const ends = layout === null || !labelEnds ? [] : endLabels(series, layout)
  const top = layout === null || !peak ? null : peakOf(series[0])
  const showKey = series.length > 1 || band !== null || fit !== null
  // ticks print by their step, not by the readings' precision, so 27.0 sits under 27.1 and 0 to 140 has no decimals
  const yTicks = layout === null ? [] : niceTicks(layout.y.domain, 5)
  const yTick = tickFormat(yTicks)

  function readAt(event: PointerEvent<SVGRectElement>) {
    const svg = event.currentTarget.ownerSVGElement
    if (layout === null || svg === null) {
      return
    }
    const bounds = svg.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * width
    setActive(Math.min(positions, Math.max(1, Math.round(layout.x.invert(x)))))
  }

  function step(event: KeyboardEvent<SVGSVGElement>) {
    const current = active ?? 1
    let next: number | null
    switch (event.key) {
      case 'ArrowRight':
        next = Math.min(positions, current + 1)
        break
      case 'ArrowLeft':
        next = Math.max(1, current - 1)
        break
      case 'Home':
        next = 1
        break
      case 'End':
        next = positions
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

  const everyOther = layout !== null && (layout.right - layout.left) / positions < 28
  return (
    <figure className="chart">
      <div className="chart-head">
        <p className="chart-title">{title}</p>
        {showKey && (
          <ul className="chart-key" aria-label="Key">
            {/* a series drawn as dots alone is keyed with a dot, so it never reads as a second line beside the fit */}
            {series.map((line) => <li key={line.id}><span className={`${line.connect ? 'key-line' : 'key-dot'} series-${line.slot}`} />{line.name}</li>)}
            {band !== null && <li><span className="key-swatch key-band" />{band.label}</li>}
            {fit !== null && <li><span className="key-fit" />{fit.label}</li>}
            {fit !== null && fit.extendTo > fit.fittedTo && <li><span className="key-fit key-projection" />Projected</li>}
          </ul>
        )}
      </div>
      <div className="chart-frame position-frame" ref={measure}>
        {layout !== null && (
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`}
            height={HEIGHT}
            role="img"
            aria-label={`${label}. Arrow keys read one wafer at a time.`}
            tabIndex={0}
            onKeyDown={step}
            onFocus={() => setActive((current) => current ?? 1)}
            onBlur={() => setActive(null)}
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={layout.left} y={layout.top} width={layout.right - layout.left} height={PLOT_HEIGHT} />
              </clipPath>
            </defs>
            {zone !== null && zone > 0 && (
              <g className="baseline-zone">
                <rect x={layout.x.map(0.5)} y={layout.top} width={layout.x.map(zone + 0.5) - layout.x.map(0.5)} height={PLOT_HEIGHT} />
                <text x={(layout.x.map(0.5) + layout.x.map(zone + 0.5)) / 2} y={layout.top - 9} textAnchor="middle">{zoneLabel}</text>
              </g>
            )}
            {yTicks.map((tick) => (
              <g key={tick}>
                <line className="gridline" x1={layout.left} x2={layout.right} y1={layout.y.map(tick)} y2={layout.y.map(tick)} />
                <text className="tick" x={layout.left - 8} y={layout.y.map(tick)} dy="0.32em" textAnchor="end">
                  {yTick(tick)}
                </text>
              </g>
            ))}
            <g clipPath={`url(#${clipId})`}>
              {band !== null && (
                <>
                  <rect
                    className="band-area"
                    x={layout.left}
                    y={layout.y.map(band.high)}
                    width={layout.right - layout.left}
                    height={Math.max(0, layout.y.map(band.low) - layout.y.map(band.high))}
                  />
                  <line className="band-mean" x1={layout.left} x2={layout.right} y1={layout.y.map(band.mean)} y2={layout.y.map(band.mean)} />
                </>
              )}
              {fit !== null && (
                <>
                  <line
                    className="fit-line"
                    x1={layout.x.map(1)}
                    y1={layout.y.map(fitAt(fit, 1))}
                    x2={layout.x.map(fit.fittedTo)}
                    y2={layout.y.map(fitAt(fit, fit.fittedTo))}
                  />
                  {fit.extendTo > fit.fittedTo && (
                    <line
                      className="fit-line fit-projection"
                      x1={layout.x.map(fit.fittedTo)}
                      y1={layout.y.map(fitAt(fit, fit.fittedTo))}
                      x2={layout.x.map(fit.extendTo)}
                      y2={layout.y.map(fitAt(fit, fit.extendTo))}
                    />
                  )}
                </>
              )}
            </g>
            <line className="axis-line" x1={layout.left} x2={layout.right} y1={layout.bottom} y2={layout.bottom} />
            {Array.from({ length: positions }, (_, index) => index + 1)
              .filter((position) => !everyOther || position % 2 === 1)
              .map((position) => (
                <text key={position} className="tick" x={layout.x.map(position)} y={layout.bottom + 18} textAnchor="middle">
                  {position}
                </text>
              ))}
            <text className="axis-title" x={layout.right} y={HEIGHT - 6} textAnchor="end">Wafer position in lot</text>
            {active !== null && (
              <line className="crosshair" x1={layout.x.map(active)} x2={layout.x.map(active)} y1={layout.top} y2={layout.bottom} />
            )}
            {series.map((line) => (
              <g key={line.id} className={`series-${line.slot}`}>
                {line.connect && line.points.length > 1 && <path className="series-line" d={linePath(line.points, layout)} />}
                {line.points.map((point) => (
                  <circle
                    key={point.position}
                    data-kind="dot"
                    className="dot"
                    cx={layout.x.map(point.position)}
                    cy={layout.y.map(point.value)}
                    r={(line.slot === 1 ? 4.5 : 4) + (point.position === active ? 1 : 0)}
                  />
                ))}
              </g>
            ))}
            {top !== null && top.position !== series[0]?.points.at(-1)?.position && (
              <text className="peak-label" x={layout.x.map(top.position)} y={layout.y.map(top.value) - 11} textAnchor="middle">
                {formatValue(top.value)}
              </text>
            )}
            {ends.map((end) => (
              <g key={end.id} className="end-label">
                <text className="end-value" x={end.x} y={end.y} dy="0.32em">{formatValue(end.value)}</text>
                {series.length > 1 && <text className="end-name" x={end.x} y={end.y + 15} dy="0.32em">{end.name}</text>}
              </g>
            ))}
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
        {active !== null && layout !== null && (
          <PositionReadout rows={readoutRows(active, series, formatValue, details)} position={active} x={layout.x.map(active)} width={width} />
        )}
        {/* mounted from the start, so a screen reader announces each wafer the arrow keys move to */}
        <p className="visually-hidden" role="status" aria-atomic="true">
          {active === null ? '' : readoutText(active, readoutRows(active, series, formatValue, details))}
        </p>
      </div>
    </figure>
  )
}

/** One line of the readout: a series or a detail, and its value at the position read. */
export type ReadoutRow = readonly [name: string, value: string]

function readoutRows(
  position: number,
  series: readonly PositionSeries[],
  formatValue: (value: number) => string,
  details: ((position: number) => readonly ReadoutRow[]) | undefined,
): ReadoutRow[] {
  const values = series.map((line): ReadoutRow => {
    const point = line.points.find((candidate) => candidate.position === position)
    return [line.name, point === undefined ? MISSING : formatValue(point.value)]
  })
  return [...values, ...(details?.(position) ?? [])]
}

/** "Wafer 2. Measured 44.08. Predicted 44.08." */
function readoutText(position: number, rows: readonly ReadoutRow[]): string {
  return [`Wafer ${position}.`, ...rows.map(([name, value]) => `${name} ${value}.`)].join(' ')
}

function PositionReadout({ rows, position, x, width }: { rows: readonly ReadoutRow[]; position: number; x: number; width: number }) {
  const style: CSSProperties = x + 12 + READOUT_WIDTH > width
    ? { right: width - x + 12, top: MARGIN.top }
    : { left: x + 12, top: MARGIN.top }
  return (
    <div className="readout" style={style}>
      <p className="readout-value">{`Wafer ${position}`}</p>
      <dl>
        {rows.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function layoutPositions({ width, positions, series, band, fit, right: margin }: {
  width: number
  positions: number
  series: readonly PositionSeries[]
  band: PositionBand | null
  fit: PositionFit | null
  right: number
}): Layout | null {
  const left = MARGIN.left
  const right = width - margin
  const values = series.flatMap((line) => line.points.map((point) => point.value))
  if (band !== null) {
    values.push(band.low, band.high)
  }
  if (fit !== null) {
    values.push(fitAt(fit, 1), fitAt(fit, fit.extendTo))
  }
  if (positions < 1 || values.length === 0 || right - left < 40) {
    return null
  }
  const top = MARGIN.top
  const bottom = MARGIN.top + PLOT_HEIGHT
  return {
    x: linearScale([0.5, positions + 0.5], [left, right]),
    y: linearScale(niceInterval([Math.min(...values), Math.max(...values)], 5), [bottom, top]),
    left,
    right,
    top,
    bottom,
  }
}

interface EndLabel {
  readonly id: string
  readonly name: string
  readonly value: number
  readonly x: number
  readonly y: number
}

/** Each connected line's last point, its label moved clear of the others' along the right edge. */
function endLabels(series: readonly PositionSeries[], layout: Layout): EndLabel[] {
  const lasts = series.flatMap((line) => {
    const last = line.points.at(-1)
    return !line.connect || last === undefined ? [] : [{ line, last }]
  })
  const gap = series.length > 1 ? LABEL_GAP.named : LABEL_GAP.bare
  const ys = spreadLabels(lasts.map(({ last }) => layout.y.map(last.value)), gap, layout.top, layout.bottom - gap / 2)
  return lasts.map(({ line, last }, index) => ({
    id: line.id,
    name: line.name,
    value: last.value,
    x: layout.x.map(last.position) + 10,
    y: ys[index] ?? layout.y.map(last.value),
  }))
}

/** A line's highest point, the first of equals. */
function peakOf(line: PositionSeries | undefined): PositionPoint | null {
  return (line?.points ?? []).reduce<PositionPoint | null>((best, point) => (best === null || point.value > best.value ? point : best), null)
}

function fitAt(fit: PositionFit, position: number): number {
  return fit.intercept + fit.slope * position
}

function linePath(points: readonly PositionPoint[], layout: Layout): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${layout.x.map(point.position).toFixed(1)},${layout.y.map(point.value).toFixed(1)}`)
    .join('')
}
