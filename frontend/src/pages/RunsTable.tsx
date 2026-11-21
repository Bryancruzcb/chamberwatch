import { Link } from 'react-router'
import type { Baseline } from '../api/schema'
import { scoreLineEnd } from '../charts/scale'
import { Disc } from '../components/Disc'
import { ScoreLine } from '../components/ScoreLine'
import { Segmented } from '../components/Segmented'
import { formatChannelName, formatDate, formatLabel, formatScore, formatSeconds, formatShortScore, MISSING } from '../format'
import { leftNoRange, type RunsSummary, runState, sortRuns, type TableOrder } from '../summary'
import { Words } from './RunsAttention'

const ORDERS = [['out', 'Out of range first'], ['lot', 'Lot and wafer'], ['z', 'How unusual']] as const

const STATE_WORDS = { out: 'Out of range', in: 'In range', failed: 'Not aligned', unscored: 'Not scored' } as const

/** The "All runs" and "In range" tabs: every run of the source, or the ones in range, in one ledger. */
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
  const k = baseline?.k ?? null
  // one scale for the whole source, so narrowing to a lot or to the runs in range does not stretch the lines
  const { end } = scoreLineEnd(summary.runs.flatMap((run) => (run.score === null ? [] : [run.score.persistentZ])), k)
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
      <div className="ledger-scroll">
        <table className="ledger runs-table">
          <caption className="visually-hidden">{inRangeOnly ? 'Runs in range' : 'Runs'}</caption>
          <thead>
            <tr>
              <th scope="col">Wafer</th>
              <th scope="col">State</th>
              <th scope="col">
                How unusual
                <span className="th-scale">{k === null ? ` 0 to ${end}` : ` 0 to ${end}, limit ${formatScore(k)}`}</span>
              </th>
              <th scope="col">First channel</th>
              <th scope="col" className="num">Left at</th>
              <th scope="col" className="num">Excursions</th>
              <th scope="col">Label</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const state = runState(run)
              const empty = leftNoRange(run)
              return (
                <tr key={run.id} className={state === 'out' ? 'out-row' : undefined}>
                  <td className="c-wafer">
                    <Link to={`/runs/${run.id}`}>{`Lot ${run.lotNo} · Wafer ${run.positionInLot}`}</Link>
                    <span className="key">{run.key}</span>
                  </td>
                  <td className="c-state">
                    <span className="state-cell">
                      <Disc state={state} size="ledger" />
                      <span>{STATE_WORDS[state]}</span>
                      <Words run={run} />
                    </span>
                  </td>
                  <td className="c-z">
                    {run.score === null
                      ? MISSING
                      : (
                          <span className="score-cell">
                            <span className="score-num">{formatShortScore(run.score.persistentZ)}</span>
                            <ScoreLine z={run.score.persistentZ} k={k} end={end} out={state === 'out'} />
                          </span>
                        )}
                  </td>
                  <td className="c-chan" data-label="First channel" data-empty={empty || undefined}>
                    {run.score?.firstChannel === undefined || run.score.firstChannel === null ? MISSING : formatChannelName(run.score.firstChannel)}
                  </td>
                  <td className="num c-at" data-label="Left at" data-empty={empty || undefined}>{formatSeconds(run.score?.firstTimeS ?? null)}</td>
                  <td className="num c-out" data-label="Excursions">{run.score?.limitFlags ?? MISSING}</td>
                  <td className="c-label" data-label="Label">{formatLabel(run.label)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {runs.length === 0 && <p className="status-line">No runs match these filters.</p>}
    </div>
  )
}
