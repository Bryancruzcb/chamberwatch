import { Link } from 'react-router'
import type { Baseline } from '../api/schema'
import { Segmented } from '../components/Segmented'
import { RunStatus } from '../components/Status'
import { ZMeter } from '../components/ZMeter'
import { formatChannelName, formatDate, formatLabel, formatScore, formatSeconds, MISSING } from '../format'
import { type RunsSummary, runState, sortRuns, type TableOrder } from '../summary'

const ORDERS = [['out', 'Out of range first'], ['lot', 'Lot and wafer'], ['z', 'How unusual']] as const

/** The "All runs" and "In range" tabs: every run of the source, or the ones in range, in one table. */
export function RunsTablePanel({ summary, baseline, inRangeOnly, lotId, order, onLot, onOrder }: {
  summary: RunsSummary
  baseline: Baseline | null
  inRangeOnly: boolean
  lotId: number | null
  order: TableOrder
  onLot: (lotId: number | null) => void
  onOrder: (order: TableOrder) => void
}) {
  const shown = summary.runs
    .filter((run) => !inRangeOnly || runState(run) === 'in')
    .filter((run) => lotId === null || run.lotId === lotId)
  const runs = sortRuns(shown, order)
  return (
    <div className="panel-enter">
      <div className="table-tools">
        <label className="field">
          Lot
          <select value={lotId ?? ''} onChange={(event) => onLot(event.target.value === '' ? null : Number(event.target.value))}>
            <option value="">All lots</option>
            {summary.lots.map((group) => (
              <option key={group.lotId} value={group.lotId}>
                {`Lot ${group.lotNo}${group.lot?.runDate === undefined || group.lot.runDate === null ? '' : `, ${formatDate(group.lot.runDate)}`}, ${group.out.length} out of range`}
              </option>
            ))}
          </select>
        </label>
        <Segmented label="Order" value={order} options={ORDERS} onChange={onOrder} />
      </div>
      <div className="table-card">
        <table className="runs-table">
          <caption className="visually-hidden">{inRangeOnly ? 'Runs in range' : 'Runs'}</caption>
          <thead>
            <tr>
              <th scope="col">Wafer</th>
              <th scope="col">Status</th>
              <th scope="col">First channel to leave</th>
              <th scope="col" className="num">Left at</th>
              <th scope="col">
                How unusual
                {baseline !== null && <span aria-hidden="true">{` (limit ${formatScore(baseline.k)})`}</span>}
              </th>
              <th scope="col" className="num">Excursions</th>
              <th scope="col">Label</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className={runState(run) === 'out' ? 'out-row' : undefined}>
                <td className="c-wafer">
                  <Link to={`/runs/${run.id}`}>{`Lot ${run.lotNo} · Wafer ${run.positionInLot}`}</Link>
                  <span className="key">{run.key}</span>
                </td>
                <td className="c-status">
                  <RunStatus alignment={run.alignment} score={run.score} good={run.good} stuck={(run.score?.stuckFlags ?? 0) > 0} />
                </td>
                <td className="c-chan" data-label="First channel">
                  {run.score?.firstChannel === undefined || run.score.firstChannel === null ? MISSING : formatChannelName(run.score.firstChannel)}
                </td>
                <td className="num c-at" data-label="Left at">{formatSeconds(run.score?.firstTimeS ?? null)}</td>
                <td className="c-z">{run.score !== null && baseline !== null ? <ZMeter z={run.score.persistentZ} k={baseline.k} /> : MISSING}</td>
                <td className="num c-out" data-label="Excursions">{run.score?.limitFlags ?? MISSING}</td>
                <td className="c-label" data-label="Label">{formatLabel(run.label)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs.length === 0 && <p className="status-line">No runs match these filters.</p>}
      </div>
    </div>
  )
}
