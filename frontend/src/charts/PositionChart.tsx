import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useId, useState } from 'react'
import { MISSING } from '../format'
import { type LinearScale, linearScale, niceInterval, niceTicks } from './scale'
import { useWidth } from './useWidth'

const PLOT_HEIGHT = 220
const MARGIN = { top: 12, right: 16, bottom: 40, left: 64 } as const
const HEIGHT = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom
/** Room the readout needs to the right of the crosshair before it moves to the left side. */
const READOUT_WIDTH = 240

export interface PositionPoint {
  readonly position: number
  readonly value: number
}

export interface PositionSeries {
  readonly id: string
  readonly name: string
  /** The categorical color slot, taken in the palette's fixed order. */
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
 * Values by wafer position in a lot, against an optional band and fitted line. The pointer or the arrow keys read one
 * wafer at a time, every series at once.
 */
export function PositionChart({ title, label, positions, series, band = null, fit = null, formatValue, details }: {
  title: string
  label: string
  positions: number
  series: readonly PositionSeries[]
  band?: PositionBand | null
  fit?: PositionFit | null
  formatValue: (value: number) => string
  details?: (position: number) => ReactNode
}) {
  const [width, measure] = useWidth()
  const [active, setActive] = useState<number | null>(null)
  const clipId = `position-clip-${useId().replace(/[^\w-]/g, '')}`
  const layout = layoutPositions({ width, positions, series, band, fit })
  const showKey = series.length > 1 || band !== null || fit !== null

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
            {series.map((line) => <li key={line.id}><span className={`key-line series-${line.slot}`} />{line.name}</li>)}
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
            {niceTicks(layout.y.domain, 5).map((tick) => (
              <g key={tick}>
                <line className="gridline" x1={layout.left} x2={layout.right} y1={layout.y.map(tick)} y2={layout.y.map(tick)} />
                <text className="tick" x={layout.left - 8} y={layout.y.map(tick)} dy="0.32em" textAnchor="end">
                  {formatValue(tick)}
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
                    r={point.position === active ? 5 : 4}
                  />
                ))}
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
          <PositionReadout
            position={active}
            series={series}
            formatValue={formatValue}
            details={details}
            x={layout.x.map(active)}
            width={width}
          />
        )}
      </div>
    </figure>
  )
}

function PositionReadout({ position, series, formatValue, details, x, width }: {
  position: number
  series: readonly PositionSeries[]
  formatValue: (value: number) => string
  details: ((position: number) => ReactNode) | undefined
  x: number
  width: number
}) {
  const style: CSSProperties = x + 12 + READOUT_WIDTH > width
    ? { right: width - x + 12, top: MARGIN.top }
    : { left: x + 12, top: MARGIN.top }
  return (
    <div className="readout" style={style}>
      <p className="readout-value">{`Wafer ${position}`}</p>
      <dl>
        {series.map((line) => {
          const point = line.points.find((candidate) => candidate.position === position)
          return (
            <div key={line.id}>
              <dt>{line.name}</dt>
              <dd>{point === undefined ? MISSING : formatValue(point.value)}</dd>
            </div>
          )
        })}
        {details?.(position)}
      </dl>
    </div>
  )
}

function layoutPositions({ width, positions, series, band, fit }: {
  width: number
  positions: number
  series: readonly PositionSeries[]
  band: PositionBand | null
  fit: PositionFit | null
}): Layout | null {
  const left = MARGIN.left
  const right = width - MARGIN.right
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

function fitAt(fit: PositionFit, position: number): number {
  return fit.intercept + fit.slope * position
}

function linePath(points: readonly PositionPoint[], layout: Layout): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${layout.x.map(point.position).toFixed(1)},${layout.y.map(point.value).toFixed(1)}`)
    .join('')
}
