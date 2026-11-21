import { Link, useParams, useSearchParams } from 'react-router'
import {
  type DriftChannel, type DriftReference, type DriftRule, type DriftState, type LotDrift, lotDriftSchema, type Phase, type RunRow,
  runsPageSchema,
} from '../api/schema'
import { withSource } from '../api/source'
import { useResource } from '../api/useResource'
import { PositionChart, type PositionFit } from '../charts/PositionChart'
import { scoreLineEnd } from '../charts/scale'
import { Disc } from '../components/Disc'
import { Figure } from '../components/Figure'
import { LotStrip, LotStripPlaceholder } from '../components/LotStrip'
import { ScoreLine } from '../components/ScoreLine'
import { Segmented } from '../components/Segmented'
import { ErrorState } from '../components/States'
import {
  formatChannelName, formatConditioning, formatDate, formatDriftState, formatScore, formatSeconds, formatShortScore, formatValue, MISSING,
} from '../format'
import { describeLotScores, driftCounts, driftWarns, lotHeadline, lotLead } from '../lotSummary'
import { lotWafers } from '../run'
import { runState } from '../summary'
import { NotFound } from './NotFound'
import { Words } from './RunsAttention'

const PHASES = [['SF6', 'SF6'], ['C4F8', 'C4F8']] as const
const REFERENCES = [['GLOBAL', 'Good runs of every lot'], ['LOT', "This lot's first wafers"]] as const
const STATE_WORDS = { out: 'Out of range', in: 'In range', failed: 'Not aligned', unscored: 'Not scored' } as const

export function LotPage() {
  const { lotId } = useParams()
  if (lotId === undefined || !/^\d+$/.test(lotId)) {
    return <NotFound />
  }
  return <LotView key={lotId} lotId={Number(lotId)} />
}

function LotView({ lotId }: { lotId: number }) {
  const [params, setParams] = useSearchParams()
  const phase: Phase = params.get('phase') === 'C4F8' ? 'C4F8' : 'SF6'
  const reference: DriftReference = params.get('reference') === 'LOT' ? 'LOT' : 'GLOBAL'
  const query = new URLSearchParams({ phase })
  if (reference !== 'GLOBAL') {
    query.set('reference', reference)
  }
  const [drift, reload] = useResource(`/api/lots/${lotId}/drift?${query}`, lotDriftSchema)

  /** Sets one query parameter, dropping it at its default so the plain link stays the plain link. */
  function choose(name: string, value: string, fallback: string) {
    setParams((current) => {
      const search = new URLSearchParams(current)
      if (value === fallback) {
        search.delete(name)
      }
      else {
        search.set(name, value)
      }
      return search
    }, { replace: true, preventScrollReset: true })
  }

  switch (drift.kind) {
    case 'loading':
      return <LotSkeleton />
    case 'error':
      return (
        <div className="sheet">
          <title>Lot · ChamberWatch</title>
          <ErrorState title="This lot did not load" message={drift.error.message} onRetry={reload} />
        </div>
      )
    case 'ready':
      return (
        <div className={drift.refreshing ? 'sheet refreshing' : 'sheet'} aria-busy={drift.refreshing || undefined}>
          <LotDetails
            drift={drift.data}
            phase={phase}
            onPhase={(next) => choose('phase', next, 'SF6')}
            onReference={(next) => choose('reference', next, 'GLOBAL')}
          />
        </div>
      )
    default: {
      const exhaustive: never = drift
      return exhaustive
    }
  }
}

/** The page's shape while the lot loads: the breadcrumb, the strip, two lines of headline, the lead, a figure. */
function LotSkeleton() {
  return (
    <div className="sheet" role="status">
      <span className="visually-hidden">Loading…</span>
      <div className="page-head" aria-hidden="true">
        <span className="skel skel-crumb" />
        <LotStripPlaceholder />
        <span className="skel skel-title" />
        <span className="skel skel-title short" />
        <span className="skel skel-lead" />
      </div>
      <span className="skel skel-panel" aria-hidden="true" />
    </div>
  )
}

function LotDetails({ drift, phase, onPhase, onReference }: {
  drift: LotDrift
  phase: Phase
  onPhase: (phase: Phase) => void
  onReference: (reference: DriftReference) => void
}) {
  const [params] = useSearchParams()
  const { lot, rule, channels } = drift
  const selected = channels.find((channel) => channel.channel === params.get('channel')) ?? channels[0]
  const [runs, reloadRuns] = useResource(withSource(`/api/runs?lot=${lot.id}`, lot.source), runsPageSchema)
  const conditioning = lot.conditioningCount === null || lot.conditioningSurface === null
    ? null
    : formatConditioning(lot.conditioningCount, lot.conditioningSurface)
  return (
    <>
      <title>{`Lot ${lot.lotNo} · ChamberWatch`}</title>
      <header className="page-head">
        <p className="breadcrumb">
          <Link to={withSource('/lots', lot.source)}>Lots</Link>
          <span aria-hidden="true"> / </span>
          {`Lot ${lot.lotNo}`}
        </p>
        {runs.kind === 'loading' && <LotStripPlaceholder />}
        {runs.kind === 'ready' && runs.data.runs.length > 0 && <LotStrip strip={lotWafers(runs.data.runs, lot.id)} lotNo={lot.lotNo} />}
        {/* when the runs fail to load, Fig. 1 says why; a placeholder here would wait forever */}
        {runs.kind === 'ready'
          ? <h1>{lotHeadline(lot.lotNo, runs.data.runs)}</h1>
          : runs.kind === 'error'
            ? <h1>{`Lot ${lot.lotNo}`}</h1>
            : (
                <>
                  <h1 className="visually-hidden">{`Lot ${lot.lotNo}`}</h1>
                  <span className="skel skel-title" aria-hidden="true" />
                  <span className="skel skel-title short" aria-hidden="true" />
                </>
              )}
        {runs.kind !== 'error' && (
          <p className="answer-next">
            {runs.kind === 'ready'
              // the lead's phase is the one the counts were made for, not the one just clicked and still loading
              ? lotLead({ runs: runs.data.runs, channels, phase: drift.phase })
              : <span className="skel skel-text" aria-hidden="true" />}
          </p>
        )}
        <p className="page-meta">
          {lot.runDate !== null && <span>{formatDate(lot.runDate)}</span>}
          {conditioning !== null && <span>{conditioning}</span>}
          <span>{`${lot.runs} ${lot.runs === 1 ? 'wafer' : 'wafers'}`}</span>
          <Link to={withSource(`/?lot=${lot.id}`, lot.source)}>Show them in the runs table</Link>
        </p>
      </header>
      <Figure id="lot-wafers" title="How unusual each wafer was" answer={runs.kind === 'ready' && runs.data.baseline !== null ? scoresAnswer(runs.data.runs, runs.data.baseline.k) : undefined}>
        {runs.kind === 'loading' && <span className="skel skel-ledger" aria-hidden="true" />}
        {runs.kind === 'error' && <ErrorState title="Could not load the lot's runs" message={runs.error.message} onRetry={reloadRuns} />}
        {runs.kind === 'ready' && (runs.data.baseline === null
          ? <p className="state">No baseline scores these runs yet.</p>
          : <LotRunsTable lotNo={lot.lotNo} runs={runs.data.runs} k={runs.data.baseline.k} />)}
      </Figure>
      {/* the switches steer both figures under them, so they sit with those figures, not with one of them */}
      <div className="lot-drift">
        <div className="filters">
          <Segmented label="Phase" value={phase} options={PHASES} onChange={onPhase} />
          <Segmented label="Reference" value={drift.reference} options={REFERENCES} onChange={onReference} />
        </div>
        <div className="lot-cols">
          <Figure id="lot-verdicts" title={`${drift.phase} mean by the last wafer`} className="drift-channels">
            <DriftChannels channels={channels} selected={selected} />
          </Figure>
          {selected === undefined
            ? (
                <Figure id="drift" title="Drift">
                  <p className="state">No channel has a good-run band for this phase.</p>
                </Figure>
              )
            : <DriftFigure channel={selected} rule={rule} phase={drift.phase} reference={drift.reference} referenceWafers={drift.referenceWafers} />}
        </div>
      </div>
    </>
  )
}

function scoresAnswer(runs: readonly RunRow[], k: number): string | null {
  const { end, past } = scoreLineEnd(runs.flatMap((run) => (run.score === null ? [] : [run.score.persistentZ])), k)
  return describeLotScores(runs, k, end, past)
}

/** Every wafer of the lot in the runs table's ledger style: its state as a disc and words, its score on one shared line. */
function LotRunsTable({ lotNo, runs, k }: { lotNo: number; runs: readonly RunRow[]; k: number }) {
  const ordered = [...runs].sort((a, b) => a.positionInLot - b.positionInLot)
  const { end } = scoreLineEnd(ordered.flatMap((run) => (run.score === null ? [] : [run.score.persistentZ])), k)
  return (
    <div className="ledger-scroll">
      <table className="ledger runs-table lot-runs">
        <caption className="visually-hidden">{`The wafers of Lot ${lotNo}`}</caption>
        <thead>
          <tr>
            <th scope="col">Wafer</th>
            <th scope="col">State</th>
            <th scope="col">
              How unusual
              <span className="th-scale">{` 0 to ${end}, limit ${formatScore(k)}`}</span>
            </th>
            <th scope="col">First channel</th>
            <th scope="col" className="num">Left at</th>
            <th scope="col" className="num">Excursions</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((run) => {
            const state = runState(run)
            return (
              <tr key={run.id} data-kind="lot-run">
                <td className="c-wafer">
                  <Link to={`/runs/${run.id}`}>
                    <span className="visually-hidden">{`Lot ${lotNo}, `}</span>
                    {`Wafer ${run.positionInLot}`}
                  </Link>
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
                <td className="c-chan" data-label="First channel">
                  {run.score?.firstChannel === undefined || run.score.firstChannel === null ? MISSING : formatChannelName(run.score.firstChannel)}
                </td>
                <td className="num c-at" data-label="Left at">{formatSeconds(run.score?.firstTimeS ?? null)}</td>
                <td className="num c-out" data-label="Excursions">{run.score?.limitFlags ?? MISSING}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** A drift verdict as a word, in the warning color when the channel is past the band or heading out of it. */
function DriftWord({ state }: { state: DriftState }) {
  return <span className={driftWarns(state) ? 'word warn' : 'word'}>{formatDriftState(state)}</span>
}

/** How the lot's channels end, as a count per verdict, then every channel with its verdict and last z. */
function DriftChannels({ channels, selected }: { channels: readonly DriftChannel[]; selected: DriftChannel | undefined }) {
  const counts = driftCounts(channels)
  if (counts.length === 0) {
    return <p className="state">No channel has a good-run band for this phase.</p>
  }
  return (
    <>
      <ul className="drift-counts">
        {counts.map((entry) => (
          <li key={entry.state}>
            <span className="count-num">{entry.count}</span>
            <DriftWord state={entry.state} />
          </li>
        ))}
      </ul>
      <div className="table-wrap">
        <table className="drift-table">
          <caption className="visually-hidden">Each channel's verdict by the last wafer</caption>
          <thead>
            <tr>
              <th scope="col">Channel</th>
              <th scope="col">By the last wafer</th>
              <th scope="col" className="num">z</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr key={channel.channel} className={channel === selected ? 'selected' : undefined}>
                <td>
                  <Link
                    to={{ search: `?${channelSearch(channel.channel)}` }}
                    replace
                    preventScrollReset
                    aria-current={channel === selected ? 'true' : undefined}
                  >
                    {formatChannelName(channel.channel)}
                  </Link>
                </td>
                <td><DriftWord state={channel.state} /></td>
                <td className="num">{formatScore(channel.points.at(-1)?.z ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )

  function channelSearch(name: string): string {
    const search = new URLSearchParams(window.location.search)
    search.set('channel', name)
    return search.toString()
  }
}

function DriftFigure({ channel, rule, phase, reference, referenceWafers }: {
  channel: DriftChannel
  rule: DriftRule
  phase: Phase
  reference: DriftReference
  referenceWafers: number
}) {
  const last = channel.points.at(-1)
  const bandLabel = reference === 'LOT'
    ? `This lot's first ${referenceWafers} wafers ± ${formatScore(rule.k)} sd of the good runs`
    : `Good-run band, mean ± ${formatScore(rule.k)} sd`
  const positions = Math.max(rule.plannedLotSize, last?.position ?? 0)
  const projecting = last !== undefined && (last.state === 'WILL_EXIT' || last.state === 'STAYS_IN')
  const fit: PositionFit | null = last === undefined || last.fit === null
    ? null
    : {
      intercept: last.fit.intercept,
      slope: last.fit.slope,
      fittedTo: last.position,
      extendTo: projecting ? positions : last.position,
      label: `Fit through wafer ${last.position}`,
    }
  return (
    <Figure id="drift" title={formatChannelName(channel.channel)} control={<DriftWord state={channel.state} />} answer={explain(channel, rule, reference)}>
      <PositionChart
        title={`${phase} phase mean`}
        label={`${phase} phase mean of ${formatChannelName(channel.channel)} by wafer position`}
        positions={positions}
        series={[{
          id: 'mean',
          name: `${phase} mean`,
          slot: 1,
          connect: false,
          points: channel.points.map((point) => ({ position: point.position, value: point.value })),
        }]}
        band={{ low: channel.low, high: channel.high, mean: channel.bandMean, label: bandLabel }}
        fit={fit}
        baseline={reference === 'LOT' ? referenceWafers : null}
        formatValue={formatValue}
        details={(position) => {
          const point = channel.points.find((candidate) => candidate.position === position)
          return point === undefined
            ? null
            : (
              <>
                <div><dt>z</dt><dd>{formatScore(point.z)}</dd></div>
                <div><dt>Verdict then</dt><dd>{formatDriftState(point.state)}</dd></div>
              </>
            )
        }}
      />
      <div className="table-wrap figure-table">
        <table className="drift-points">
          <caption>Wafer by wafer</caption>
          <thead>
            <tr>
              <th scope="col">Wafer</th>
              <th scope="col" className="num">Mean</th>
              <th scope="col" className="num">z</th>
              <th scope="col" className="num c-slope">Slope so far</th>
              <th scope="col" className="num c-t">t</th>
              <th scope="col">Verdict then</th>
            </tr>
          </thead>
          <tbody>
            {channel.points.map((point) => (
              <tr key={point.runId}>
                <td><Link to={`/runs/${point.runId}`}>{`Wafer ${point.position}`}</Link></td>
                <td className="num">{formatValue(point.value)}</td>
                <td className="num">{formatScore(point.z)}</td>
                <td className="num c-slope">{formatValue(point.fit?.slope ?? null)}</td>
                <td className="num c-t">{formatScore(point.fit?.tStat ?? null)}</td>
                <td><DriftWord state={point.state} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Figure>
  )
}

function explain(channel: DriftChannel, rule: DriftRule, reference: DriftReference): string {
  const last = channel.points.at(-1)
  const band = reference === 'LOT' ? "the band around this lot's first wafers" : "the good runs' band"
  switch (channel.state) {
    case 'OUT_OF_BAND':
      return `By wafer ${last?.position ?? '?'} the fitted mean is outside ${band}.`
    case 'WILL_EXIT':
      return `The fitted line leaves ${band} at wafer ${last?.firstOutPosition ?? '?'}, inside a lot of ${rule.plannedLotSize}.`
    case 'STAYS_IN':
      return `The mean trends, but the fitted line stays inside ${band} through wafer ${rule.plannedLotSize}.`
    case 'NO_TREND':
      return `No trend: the slope's t-statistic stays under ${formatScore(rule.minAbsT)}.`
    case 'INSUFFICIENT_RUNS':
      return `Fewer than ${rule.minRuns} wafers, too few to judge a trend.`
    default: {
      const exhaustive: never = channel.state
      return exhaustive
    }
  }
}
