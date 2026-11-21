import { Link } from 'react-router'
import type { Lot, RunRow, Source } from '../api/schema'
import { formatDate, formatScore, formatUnusual } from '../format'
import { type GridCell, lotGrid } from '../grid'

const SOURCES = {
  PUBLIC: 'Source: Zenodo record 17122442, "A Multi-Model Dataset for BOSCH Plasma-Etching", TU Chemnitz and Fraunhofer ENAS, CC BY 4.0.',
  SYNTHETIC: 'Source: ChamberWatch\'s seeded simulator. The faults are planted, and the detectors score the wafers without knowing.',
  LIVE: 'Source: wafers the C chamber simulator streamed to this app on the Live page.',
} as const satisfies Record<Source, string>

const STATE_WORDS = { out: 'out of range', in: 'in range', failed: 'not aligned', unscored: 'not scored' } as const

/**
 * Every wafer of a source at once: lots as rows, wafer positions as columns. A cell is shaded by how unusual its wafer
 * was against the limit, gray in range and red out of it, and opens the wafer. Baseline runs carry a ring.
 */
export function LotGrid({ runs, lots, k, source }: { runs: readonly RunRow[]; lots: readonly Lot[]; k: number | null; source: Source }) {
  const grid = lotGrid(runs, lots, k)
  const columns = Array.from({ length: grid.positions }, (_, index) => index + 1)
  return (
    <section className="lot-grid" aria-labelledby="lot-grid-title">
      <h2 id="lot-grid-title">Every wafer, lot by lot</h2>
      <div className="lot-grid-body">
        <div className="table-wrap">
          <table className="grid-table">
            <caption className="visually-hidden">Every wafer by lot and position, shaded by how unusual it was</caption>
            <thead>
              <tr>
                <th scope="col" className="grid-corner">Lot</th>
                {columns.map((position) => <th key={position} scope="col" className="grid-col">{position}</th>)}
                <th scope="col" className="grid-count">Out</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.lotId}>
                  <th scope="row" className="grid-lot">
                    <span className="grid-lot-in">
                      <Link to={`/lots/${row.lotId}`}>{`Lot ${row.lotNo}`}</Link>
                      {row.lot?.runDate !== null && row.lot?.runDate !== undefined && (
                        <span className="grid-date">{formatDate(row.lot.runDate)}</span>
                      )}
                    </span>
                  </th>
                  {row.cells.map((cell, index) => (
                    <td key={index} className="grid-cell">
                      {cell === null ? <span className="cell-empty" aria-hidden="true" /> : <Cell cell={cell} lotNo={row.lotNo} />}
                    </td>
                  ))}
                  <td className={row.out > 0 ? 'grid-count out' : 'grid-count'}>{row.out}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="lot-grid-side">
          {/* every cell says the same in its own label, so the key is for the eye only */}
          <p className="grid-key" aria-hidden="true">
            <span className="key-run">
              <i className="swatch in-1" /><i className="swatch in-2" /><i className="swatch in-3" />
              {k === null ? 'in range' : `in range, stronger closer to the limit of ${formatScore(k)}`}
            </span>
            <span className="key-run">
              <i className="swatch out-1" /><i className="swatch out-2" /><i className="swatch out-3" />
              out of range, stronger further past it
            </span>
            <span className="key-run"><i className="swatch in-1 ring" />baseline run</span>
          </p>
          <p className="figure-source">{SOURCES[source]}</p>
        </div>
      </div>
    </section>
  )
}

function Cell({ cell, lotNo }: { cell: GridCell; lotNo: number }) {
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
      aria-label={label}
      title={label}
    />
  )
}
