import { type CSSProperties, type FocusEvent, type KeyboardEvent, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { Lot, RunRow, Source } from '../api/schema'
import { formatDate, formatScore, formatUnusual } from '../format'
import { type GridCell, gridKinds, type GridStop, hasStop, lotGrid, nextStop } from '../grid'

const SOURCES = {
  PUBLIC: 'Source: Zenodo record 17122442, "A Multi-Model Dataset for BOSCH Plasma-Etching", TU Chemnitz and Fraunhofer ENAS, CC BY 4.0.',
  SYNTHETIC: 'Source: ChamberWatch\'s seeded simulator. The faults are planted, and the detectors score the wafers without knowing.',
  LIVE: 'Source: wafers the C chamber simulator streamed to this app on the Live page.',
} as const satisfies Record<Source, string>

const STATE_WORDS = { out: 'out of range', in: 'in range', failed: 'not aligned', unscored: 'not scored' } as const

/** Where the keyboard enters the grid: the first lot's link. */
const FIRST: GridStop = { row: 0, col: 0 }

/**
 * Every wafer of a source at once: lots as rows, wafer positions as columns. A cell is shaded by how unusual its wafer
 * was against the limit, gray in range and red with a corner flag out of it, and opens the wafer. Baseline runs carry a
 * ring. The grid is one tab stop, like the app's other charts: the arrow keys, Home and End move between its links.
 */
export function LotGrid({ runs, lots, k, source }: { runs: readonly RunRow[]; lots: readonly Lot[]; k: number | null; source: Source }) {
  const grid = lotGrid(runs, lots, k)
  const kinds = gridKinds(grid)
  const columns = Array.from({ length: grid.positions }, (_, index) => index + 1)
  const [stop, setStop] = useState<GridStop>(FIRST)
  // the stop remembered may be gone after the runs change; the first lot's link always exists
  const current = hasStop(grid, stop) ? stop : FIRST
  const table = useRef<HTMLTableElement>(null)
  const tabIndexAt = (row: number, col: number) => (row === current.row && col === current.col ? 0 : -1)
  // the stylesheet keeps a cell at 24px or wider by this count, so a longer lot scrolls rather than shrinks
  const style: CSSProperties & Record<'--positions', number> = { '--positions': grid.positions }

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
    <section className="lot-grid" aria-labelledby="lot-grid-title">
      <h2 id="lot-grid-title">Every wafer, lot by lot</h2>
      <div className="lot-grid-body">
        <div className="table-wrap">
          <table className="grid-table" style={style} ref={table} onKeyDown={move} onFocus={remember}>
            <caption className="visually-hidden">
              Every wafer by lot and position, shaded by how unusual it was. Arrow keys move between wafers.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="grid-corner">Lot</th>
                {columns.map((position) => <th key={position} scope="col" className="grid-col">{position}</th>)}
                <th scope="col" className="grid-count">Out</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row, rowIndex) => (
                <tr key={row.lotId}>
                  <th scope="row" className="grid-lot">
                    <span className="grid-lot-in">
                      <Link to={`/lots/${row.lotId}`} tabIndex={tabIndexAt(rowIndex, 0)} data-row={rowIndex} data-col={0}>
                        {`Lot ${row.lotNo}`}
                      </Link>
                      {row.lot?.runDate !== null && row.lot?.runDate !== undefined && (
                        <span className="grid-date">{formatDate(row.lot.runDate)}</span>
                      )}
                    </span>
                  </th>
                  {row.cells.map((cell, index) => (
                    <td key={index} className="grid-cell">
                      {cell === null
                        ? <span className="cell-empty" aria-hidden="true" />
                        : <Cell cell={cell} lotNo={row.lotNo} row={rowIndex} col={index + 1} tabIndex={tabIndexAt(rowIndex, index + 1)} />}
                    </td>
                  ))}
                  <td className={row.out > 0 ? 'grid-count out' : 'grid-count'}>{row.out}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="lot-grid-side">
          {/* every cell says the same in its own label, so the key is for the eye only; it names what the grid holds */}
          <p className="grid-key" aria-hidden="true">
            {kinds.inRange && (
              <span className="key-run">
                <i className="swatch in-1" />
                {k !== null && <><i className="swatch in-2" /><i className="swatch in-3" /></>}
                {k === null ? 'in range' : `in range, stronger closer to the limit of ${formatScore(k)}`}
              </span>
            )}
            {kinds.outOfRange && (
              <span className="key-run">
                <i className="swatch out-1" />
                {k !== null && <><i className="swatch out-2" /><i className="swatch out-3" /></>}
                {k === null ? 'out of range' : 'out of range, stronger further past it'}
              </span>
            )}
            {kinds.unmeasured && <span className="key-run"><i className="swatch none" />not scored or not aligned</span>}
            {kinds.missing && <span className="key-run"><i className="swatch empty" />no wafer</span>}
            {kinds.baseline && <span className="key-run"><i className="swatch in-1 ring" />baseline run</span>}
          </p>
          <p className="figure-source">{SOURCES[source]}</p>
        </div>
      </div>
    </section>
  )
}

/**
 * The grid's place while the runs load or the source changes: the same frame, ten lots tall, so nothing under it moves.
 * It carries the new source's own line, never the last source's wafers.
 */
export function LotGridSkeleton({ source }: { source: Source }) {
  return (
    <section className="lot-grid" aria-hidden="true">
      <h2>Every wafer, lot by lot</h2>
      <div className="lot-grid-body">
        <span className="skel skel-grid" />
        <div className="lot-grid-side">
          <span className="skel skel-key" />
          <p className="figure-source">{SOURCES[source]}</p>
        </div>
      </div>
    </section>
  )
}

function Cell({ cell, lotNo, row, col, tabIndex }: { cell: GridCell; lotNo: number; row: number; col: number; tabIndex: number }) {
  const { run, state, shade } = cell
  const z = run.score?.persistentZ ?? null
  const label = `Lot ${lotNo}, wafer ${run.positionInLot}: ${STATE_WORDS[state]}`
    + `${z === null ? '' : `, how unusual ${formatUnusual(z)}`}${run.good ? ', baseline run' : ''}`
  const tone = state === 'out' ? `out-${shade}` : state === 'in' ? `in-${shade}` : 'none'
  return (
    <Link
      to={`/runs/${run.id}`}
      className={`cell ${tone}${run.good ? ' ring' : ''}`}
      data-kind="grid-cell"
      data-state={state}
      data-row={row}
      data-col={col}
      tabIndex={tabIndex}
      aria-label={label}
      title={label}
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
