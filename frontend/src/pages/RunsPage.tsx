import { Link, useSearchParams } from 'react-router'
import { type Baseline, isFlagged, lotsSchema, type RunRow, runsPageSchema } from '../api/schema'
import { useResource } from '../api/useResource'
import { Loaded } from '../components/Loaded'
import { Segmented } from '../components/Segmented'
import { Stat } from '../components/Stat'
import { RunStatus } from '../components/Status'
import { ZMeter } from '../components/ZMeter'
import { formatLabel, formatScore, formatSeconds, MISSING } from '../format'

type FlagFilter = 'all' | 'flagged' | 'clean'
type Order = 'lot' | 'z'

const FLAG_FILTERS = [['all', 'All runs'], ['flagged', 'Flagged'], ['clean', 'Not flagged']] as const
const ORDERS = [['lot', 'Lot and wafer'], ['z', 'Highest persistent z']] as const

export function RunsPage() {
  const [params, setParams] = useSearchParams()
  const { lotId, flags, order } = readFilters(params)
  const [lots] = useResource('/api/lots', lotsSchema)
  const [page] = useResource(runsPath(lotId, flags), runsPageSchema)
  const publicLots = lots.kind === 'ready' ? lots.data.filter((lot) => lot.source === 'PUBLIC') : []

  function update(changes: Record<string, string | null>) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) {
          next.delete(key)
        }
        else {
          next.set(key, value)
        }
      }
      return next
    }, { replace: true })
  }

  return (
    <>
      <title>Runs · ChamberWatch</title>
      <header className="page-head">
        <h1>Runs</h1>
        <p className="subtitle">Every wafer of the public data, scored against the baseline learned from the good runs.</p>
      </header>
      <div className="filters">
        <label className="field">
          Lot
          <select value={lotId ?? ''} onChange={(event) => update({ lot: event.target.value === '' ? null : event.target.value })}>
            <option value="">All lots</option>
            {publicLots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {`Lot ${lot.lotNo}${lot.runDate === null ? '' : `, ${lot.runDate}`}, ${lot.flaggedRuns} flagged`}
              </option>
            ))}
          </select>
        </label>
        <Segmented
          label="Show"
          value={flags}
          options={FLAG_FILTERS}
          onChange={(next) => update({ flagged: next === 'all' ? null : String(next === 'flagged') })}
        />
        <Segmented label="Order" value={order} options={ORDERS} onChange={(next) => update({ order: next === 'lot' ? null : next })} />
      </div>
      <Loaded resource={page}>
        {(data) => <RunsTable runs={sortRuns(data.runs, order)} baseline={data.baseline} />}
      </Loaded>
    </>
  )
}

function RunsTable({ runs, baseline }: { runs: readonly RunRow[]; baseline: Baseline | null }) {
  const flagged = runs.filter((run) => isFlagged(run.score)).length
  return (
    <>
      <dl className="stats">
        <Stat label="Runs" value={runs.length} />
        <Stat label="Flagged" value={flagged} detail={runs.length === 0 ? undefined : `${Math.round((100 * flagged) / runs.length)}% of these runs`} />
        {baseline !== null && (
          <Stat
            label="Baseline"
            value={`#${baseline.id}`}
            detail={`${baseline.goodRuns} good runs, limit z ${formatScore(baseline.k)} held for ${baseline.n} samples`}
          />
        )}
      </dl>
      <div className="panel table-wrap">
        <table>
          <caption className="visually-hidden">Runs</caption>
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col" className="num">Lot</th>
              <th scope="col" className="num">Wafer</th>
              <th scope="col">Status</th>
              <th scope="col">Label</th>
              <th scope="col" className="num">Limit flags</th>
              <th scope="col" className="num">Deviations</th>
              <th scope="col">Persistent z</th>
              <th scope="col">First channel</th>
              <th scope="col" className="num">First excursion</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td><Link className="key" to={`/runs/${run.id}`}>{run.key}</Link></td>
                <td className="num">{run.lotNo}</td>
                <td className="num">{run.positionInLot}</td>
                <td><RunStatus alignment={run.alignment} score={run.score} good={run.good} /></td>
                <td>{formatLabel(run.label)}</td>
                <td className="num">{run.score?.limitFlags ?? MISSING}</td>
                <td className="num">{run.score?.deviationFlags ?? MISSING}</td>
                <td>{run.score !== null && baseline !== null ? <ZMeter z={run.score.persistentZ} k={baseline.k} /> : MISSING}</td>
                <td>{run.score?.firstChannel ?? MISSING}</td>
                <td className="num">{formatSeconds(run.score?.firstTimeS ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs.length === 0 && <p className="status-line">No runs match these filters.</p>}
      </div>
    </>
  )
}

function readFilters(params: URLSearchParams): { lotId: number | null; flags: FlagFilter; order: Order } {
  const lot = params.get('lot')
  const flagged = params.get('flagged')
  return {
    lotId: lot !== null && /^\d+$/.test(lot) ? Number(lot) : null,
    flags: flagged === 'true' ? 'flagged' : flagged === 'false' ? 'clean' : 'all',
    order: params.get('order') === 'z' ? 'z' : 'lot',
  }
}

function runsPath(lotId: number | null, flags: FlagFilter): string {
  const query = new URLSearchParams()
  if (lotId !== null) {
    query.set('lot', String(lotId))
  }
  if (flags !== 'all') {
    query.set('flagged', String(flags === 'flagged'))
  }
  const search = query.toString()
  return search === '' ? '/api/runs' : `/api/runs?${search}`
}

function sortRuns(runs: readonly RunRow[], order: Order): RunRow[] {
  const sorted = [...runs]
  if (order === 'z') {
    sorted.sort((a, b) => (b.score?.persistentZ ?? -1) - (a.score?.persistentZ ?? -1))
  }
  return sorted
}
