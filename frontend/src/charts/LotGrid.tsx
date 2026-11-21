import { type CSSProperties, type FocusEvent, Fragment, type KeyboardEvent, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { Lot, RunRow, Source } from '../api/schema'
import { Disc } from '../components/Disc'
import { formatDate, formatScore, formatShortScore } from '../format'
import { describeNotRun, type GridCell, gridKinds, type GridStop, hasStop, lotGrid, nextStop, rowSegments } from '../grid'
import { SOURCE_LINES } from '../sources'
import { describeWafers } from '../summary'

const STATE_WORDS = { out: 'out of range', in: 'in range', failed: 'not aligned', unscored: 'not scored' } as const

/** Where the keyboard enters the map: the first lot's link. */
const FIRST: GridStop = { row: 0, col: 0 }

/** The key's rows on a page where the map is still loading: as many as the public wafers need, so nothing moves. */
const KEY_ROWS = 4

type MapStyle = CSSProperties & Record<'--positions' | '--base' | '--gaps', number>

/**
 * Every wafer of a source at once, like wafers in a cassette: lots as rows, wafer positions as slots on a rail. A
 * hollow ring is in range; a solid red disc is out of range and prints its score; a dashed ring was not scored or not
 * aligned; a dashed rail marks slots a lot never ran. When every lot keeps its baseline runs in its first positions,
 * one bracket names them over the columns; otherwise each baseline disc carries a centre dot.
 *
 * It is one tab stop, like the app's other charts: the arrow keys, Home and End move between its links. It renders
 * the figure's body; the page puts it in a `Figure` with the Source switch, so the switch stays put while it loads.
 */
export function LotGrid({ runs, lots, k, source }: { runs: readonly RunRow[]; lots: readonly Lot[]; k: number | null; source: Source }) {
  const grid = lotGrid(runs, lots)
  const kinds = gridKinds(grid)
  const bracket = grid.baseline
  const dots = bracket === null && kinds.baseline
  const [stop, setStop] = useState<GridStop>(FIRST)
  // the stop remembered may be gone after the runs change; the first lot's link always exists
  const current = hasStop(grid, stop) ? stop : FIRST
  const table = useRef<HTMLTableElement>(null)
  const tabIndexAt = (row: number, col: number) => (row === current.row && col === current.col ? 0 : -1)
  // the stylesheet sizes the table from these, so a lot longer than ten wafers scrolls rather than shrinks its discs
  const style: MapStyle = {
    '--positions': grid.positions,
    '--base': bracket ?? 0,
    '--gaps': bracket !== null && bracket < grid.positions ? 1 : 0,
  }
  const columns = Array.from({ length: grid.positions }, (_, index) => index + 1)
  const sample = grid.rows.flatMap((row) => row.cells).find((cell) => cell?.state === 'out')?.run.score?.persistentZ ?? null
  const goodRuns = grid.rows.flatMap((row) => row.cells).filter((cell) => cell?.run.good === true).length
  const notRun = describeNotRun(grid)

  function move(event: KeyboardEvent<HTMLTableElement>) {
    const from = stopOf(event.target)
    const next = from === null ? null : nextStop(grid, from, event.key, event.ctrlKey || event.metaKey)
    if (next === null) {
      return
    }
    event.preventDefault()
    setStop(next)
    table.current?.querySelector<HTMLElement>(`[data-row="${next.row}"][data-col="${next.col}"]`)?.focus()
  }

  function remember(event: FocusEvent<HTMLTableElement>) {
    const at = stopOf(event.target)
    if (at !== null) {
      setStop(at)
    }
  }

  return (
    <div className="lot-map-body">
      <div className="map-scroll">
        <table className="lot-map" style={style} ref={table} onKeyDown={move} onFocus={remember}>
          <caption className="visually-hidden">
            Every wafer by lot and position. A solid disc is out of range and carries its score. Arrow keys move between wafers.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="map-lot-head">Lot</th>
              {columns.map((position) => (
                <Fragment key={position}>
                  <th scope="col" className="map-col">
                    {position === 1 && bracket !== null && <span className="bracket" aria-hidden="true"><span>Baseline</span></span>}
                    {position}
                  </th>
                  {position === bracket && position < grid.positions && <td className="map-gap" aria-hidden="true" />}
                </Fragment>
              ))}
              <th scope="col" className="map-out-head">Out</th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, rowIndex) => {
              const segments = rowSegments(row, bracket)
              return (
                <tr key={row.lotId}>
                  <th scope="row" className="map-lot">
                    <Link to={`/lots/${row.lotId}`} tabIndex={tabIndexAt(rowIndex, 0)} data-row={rowIndex} data-col={0}>
                      {`Lot ${row.lotNo}`}
                    </Link>
                    {row.lot?.runDate !== null && row.lot?.runDate !== undefined && (
                      <span className="map-date">{formatDate(row.lot.runDate)}</span>
                    )}
                  </th>
                  {segments.map((segment, index) => {
                    const edge = `${index === 0 ? ' first' : ''}${index === segments.length - 1 ? ' last' : ''}`
                    if (segment.kind === 'gap') {
                      return <td key="gap" className={`map-gap${edge}`} aria-hidden="true" />
                    }
                    if (segment.kind === 'not-run') {
                      const span = segment.to - segment.from + 1
                      return (
                        <td key={segment.from} className={`map-none${edge}`} colSpan={span} data-kind="not-run">
                          <span className={span > 1 ? 'map-none-label' : 'visually-hidden'}>not run</span>
                        </td>
                      )
                    }
                    return (
                      <td key={segment.position} className={`map-slot${edge}`}>
                        <Wafer cell={segment.cell} lotNo={row.lotNo} dot={dots} row={rowIndex} col={segment.position} tabIndex={tabIndexAt(rowIndex, segment.position)} />
                      </td>
                    )
                  })}
                  <td className={row.out > 0 ? 'map-out' : 'map-out zero'}>{row.out}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="lot-map-side">
        {/* every disc says the same in its own label, so the key is for the eye only; it names what the map holds */}
        <ul className="map-key" aria-hidden="true">
          {kinds.inRange && (
            <li><Disc state="in" size="key" /><span><b>In range</b></span></li>
          )}
          {kinds.outOfRange && (
            <li>
              <Disc state="out" size="key" text={sample === null ? undefined : formatShortScore(sample)} />
              <span><b>Out of range</b>{`, with its how-unusual score.${k === null ? '' : ` The limit is ${formatScore(k)}.`}`}</span>
            </li>
          )}
          {kinds.unmeasured && (
            <li><Disc state="unscored" size="key" /><span><b>Not scored</b> or <b>not aligned</b></span></li>
          )}
          {bracket !== null && kinds.baseline && (
            <li>
              <span className="key-bracket" />
              <span><b>Baseline</b>{`: ${describeWafers(Array.from({ length: bracket }, (_, index) => index + 1))}, the ${goodRuns} good runs behind every score.`}</span>
            </li>
          )}
          {dots && (
            <li><Disc state="in" size="key" baseline /><span><b>Baseline run</b>{`: one of the ${goodRuns} good runs behind every score.`}</span></li>
          )}
          {notRun !== null && (
            <li><span className="key-none" /><span><b>Not run</b>{`: ${notRun}`}</span></li>
          )}
        </ul>
        <p className="figure-source">{SOURCE_LINES[source]}</p>
      </div>
    </div>
  )
}

/**
 * The map's place while the runs load or the source changes: the same frame, ten lots tall, with the key's rows held
 * open, so nothing under it moves. It carries the new source's own line, never the last source's wafers.
 */
export function LotGridSkeleton({ source }: { source: Source }) {
  return (
    <div className="lot-map-body">
      <div className="map-scroll">
        <span className="skel skel-map" aria-hidden="true" />
      </div>
      <div className="lot-map-side">
        <ul className="map-key" aria-hidden="true">
          {Array.from({ length: KEY_ROWS }, (_, index) => (
            <li key={index}><span className="skel skel-mark" /><span className="skel skel-text" /></li>
          ))}
        </ul>
        <p className="figure-source">{SOURCE_LINES[source]}</p>
      </div>
    </div>
  )
}

function Wafer({ cell, lotNo, dot, row, col, tabIndex }: { cell: GridCell; lotNo: number; dot: boolean; row: number; col: number; tabIndex: number }) {
  const { run, state } = cell
  const z = run.score?.persistentZ ?? null
  const label = `Lot ${lotNo}, wafer ${run.positionInLot}: ${STATE_WORDS[state]}`
    + `${z === null ? '' : `, how unusual ${formatShortScore(z)}`}${run.good ? ', baseline run' : ''}`
  return (
    <Disc
      state={state}
      size="map"
      text={state === 'out' && z !== null ? formatShortScore(z) : undefined}
      baseline={dot && run.good}
      to={`/runs/${run.id}`}
      label={label}
      tabIndex={tabIndex}
      data={{ kind: 'grid-cell', state, row, col }}
    />
  )
}

/** The grid position of the link an event came from, read off the link itself. */
function stopOf(target: EventTarget): GridStop | null {
  if (!(target instanceof HTMLElement) || target.dataset.row === undefined || target.dataset.col === undefined) {
    return null
  }
  return { row: Number(target.dataset.row), col: Number(target.dataset.col) }
}
