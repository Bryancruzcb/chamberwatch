import { useState } from 'react'
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
  columnFormat, formatChannelName, formatConditioning, formatDate, formatDriftState, formatScore, formatSeconds, formatShortScore, formatValue, formatZ,
  MISSING, tieUnits,
} from '../format'
import {
  describeHiddenDriftChannels, describeLotScores, driftCounts, driftWarns, fittedZ, lotHeadline, lotLead, splitDriftChannels,
} from '../lotSummary'
import { lotWafers } from '../run'
import { leftNoRange, runState } from '../summary'
import { NotFound, PageFailure } from './NotFound'
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
        <PageFailure
          error={drift.error}
          onRetry={reload}
          missing={`There is no lot ${lotId}.`}
          back={{ to: '/lots', label: 'Back to the lots' }}
          // the address holds the lot's id, which is not always its number, so the page names no number until it loads
          name="Lot"
          failed="This lot did not load"
          title="Lot · ChamberWatch"
        />
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
              ? tieUnits(lotLead({ runs: runs.data.runs, channels, phase: drift.phase }))
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
            <DriftChannels channels={channels} selected={selected} rule={rule} phase={drift.phase} />
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
            const empty = leftNoRange(run)
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
                <td className="c-chan" data-label="First channel" data-empty={empty || undefined}>
                  {run.score?.firstChannel === undefined || run.score.firstChannel === null ? MISSING : formatChannelName(run.score.firstChannel)}
                </td>
                <td className="num c-at" data-label="Left at" data-empty={empty || undefined}>{formatSeconds(run.score?.firstTimeS ?? null)}</td>
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

/**
 * How the lot's channels end, as a count per verdict, then each channel with a trend verdict, its verdict and its fitted
 * line's z. The channels with no trend or too few wafers fold behind a button, which opens when the picked channel is
 * one of them.
 */
function DriftChannels({ channels, selected, rule, phase }: {
  channels: readonly DriftChannel[]
  selected: DriftChannel | undefined
  rule: DriftRule
  phase: Phase
}) {
  const counts = driftCounts(channels)
  const { shown, hidden } = splitDriftChannels(channels, selected)
  // Only the reader's last click is state, with the channel picked when they made it. A folded channel picked since
  // opens the list so its row shows; otherwise the click stands.
  const [click, setClick] = useState<{ readonly open: boolean; readonly under: string | undefined } | null>(null)
  const pickedFolded = selected !== undefined && !splitDriftChannels(channels, undefined).shown.includes(selected)
  const open = pickedFolded && click?.under !== selected.channel ? true : (click?.open ?? false)
  // open, every channel shows in rank order; folded, the picked one keeps its place among the shown
  const rows = open ? channels : shown
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
              <th scope="col" className="num">Fitted z</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((channel) => (
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
                <td className="num">{formatZ(fittedZ(channel))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden.length > 0 && (
        <button type="button" className="link-button lineup-more" aria-expanded={open} onClick={() => setClick({ open: !open, under: selected?.channel })}>
          {describeHiddenDriftChannels(hidden, open)}
        </button>
      )}
      <DriftWords rule={rule} phase={phase} />
    </>
  )

  function channelSearch(name: string): string {
    const search = new URLSearchParams(window.location.search)
    search.set('channel', name)
    return search.toString()
  }
}

/** The words the lot page's drift figures use, closed until asked for, with the numbers of the lot's drift rule. */
function DriftWords({ rule, phase }: { rule: DriftRule; phase: Phase }) {
  const t = formatScore(rule.minAbsT)
  return (
    <details className="how words-how">
      <summary>The words this page uses</summary>
      <dl className="words">
        <div>
          <dt>SF6 and C4F8</dt>
          <dd>The two steps of every etch cycle: SF6 etches the silicon, and C4F8 coats the walls to protect them. A wafer's phase mean is a channel's average reading over one of those steps, across its run.</dd>
        </div>
        <div>
          <dt>Fitted z</dt>
          <dd>{`Where the fitted line sits at the last wafer: how many of the good runs' standard deviations it is from the band's centre. The band reaches ${formatScore(rule.k)} of them either side. This is the number the verdict judges.`}</dd>
        </div>
        <div>
          <dt>z</dt>
          <dd>{`The same measure for one wafer's own ${phase} mean, in the wafer-by-wafer table. One unusual wafer can sit far out while the fitted line stays in, or the reverse.`}</dd>
        </div>
        <div>
          <dt>Fitted line, slope and t</dt>
          <dd>{`A straight line through the lot's wafers so far, fitted again at each wafer. The slope is its change per wafer; t says how clearly it trends, and under ${t} counts as no trend.`}</dd>
        </div>
        <div>
          <dt>Verdicts</dt>
          <dd>
            {`${formatDriftState('OUT_OF_BAND')}: the fitted line is outside the band at the last wafer. ${formatDriftState('WILL_EXIT')}: it crosses the band's edge inside a lot of ${rule.plannedLotSize}. ${formatDriftState('STAYS_IN')}: it trends, but stays inside through wafer ${rule.plannedLotSize}. ${formatDriftState('NO_TREND')}: t is under ${t}. ${formatDriftState('INSUFFICIENT_RUNS')}: fewer than ${rule.minRuns} wafers, too few to fit a line worth judging.`}
          </dd>
        </div>
      </dl>
    </details>
  )
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
  // one count of decimals down the whole mean column, so the decimal points line up
  const formatMean = columnFormat(channel.points.map((point) => point.value))
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
          return point === undefined ? [] : [['z', formatZ(point.z)], ['Verdict then', formatDriftState(point.state)]]
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
                <td className="num">{formatMean(point.value)}</td>
                <td className="num">{formatZ(point.z)}</td>
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
