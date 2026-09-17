import { Link, useParams, useSearchParams } from 'react-router'
import { type DriftChannel, type DriftReference, type DriftRule, type LotDrift, lotDriftSchema, type Phase } from '../api/schema'
import { withSource } from '../api/source'
import { useResource } from '../api/useResource'
import { PositionChart, type PositionFit } from '../charts/PositionChart'
import { Loaded } from '../components/Loaded'
import { Segmented } from '../components/Segmented'
import { Stat } from '../components/Stat'
import { DriftBadge } from '../components/Status'
import { formatConditioning, formatDate, formatDriftState, formatScore, formatValue } from '../format'
import { NotFound } from './NotFound'

const PHASES = [['SF6', 'SF6'], ['C4F8', 'C4F8']] as const
const REFERENCES = [['GLOBAL', 'Good runs of every lot'], ['LOT', "This lot's first wafers"]] as const

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
  const [drift] = useResource(`/api/lots/${lotId}/drift?${query}`, lotDriftSchema)

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

  return (
    <Loaded resource={drift}>
      {(data) => (
        <LotDetails
          drift={data}
          phase={phase}
          onPhase={(next) => choose('phase', next, 'SF6')}
          onReference={(next) => choose('reference', next, 'GLOBAL')}
        />
      )}
    </Loaded>
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
  const outOfBand = channels.filter((channel) => channel.state === 'OUT_OF_BAND').length
  const leaving = channels.filter((channel) => channel.state === 'WILL_EXIT').length
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
        <h1>{`Lot ${lot.lotNo}`}</h1>
        <p className="subtitle">
          {[lot.runDate === null ? null : `Run on ${formatDate(lot.runDate)}`, conditioning].filter((part) => part !== null).join('. ')}
        </p>
      </header>
      <dl className="stats">
        <Stat label="Runs" value={lot.runs} detail={<Link to={withSource(`/?lot=${lot.id}`, lot.source)}>Show them in the runs table</Link>} />
        <Stat label="Flagged runs" value={lot.flaggedRuns} />
        <Stat label="Out of the band" value={outOfBand} detail={`Channels whose ${phase} mean left the good runs' band`} />
        <Stat label="Projected to leave" value={leaving} detail={`Within ${rule.plannedLotSize} wafers`} />
      </dl>
      <div className="filters">
        <Segmented label="Phase" value={phase} options={PHASES} onChange={onPhase} />
        <Segmented label="Reference" value={drift.reference} options={REFERENCES} onChange={onReference} />
      </div>
      <div className="run-layout">
        <section className="panel" aria-labelledby="drift-channels-title">
          <h2 id="drift-channels-title">Channels</h2>
          <DriftChannelsTable channels={channels} selected={selected} />
        </section>
        {selected === undefined
          ? <section className="panel"><p className="status-line">No channel has a good-run band for this phase.</p></section>
          : <DriftPanel channel={selected} rule={rule} phase={phase} reference={drift.reference} referenceWafers={drift.referenceWafers} />}
      </div>
    </>
  )
}

function DriftChannelsTable({ channels, selected }: { channels: readonly DriftChannel[]; selected: DriftChannel | undefined }) {
  return (
    <div className="table-wrap">
      <table className="compact">
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
                  {channel.channel}
                </Link>
              </td>
              <td><DriftBadge state={channel.state} /></td>
              <td className="num">{formatScore(channel.points.at(-1)?.z ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  function channelSearch(name: string): string {
    const search = new URLSearchParams(window.location.search)
    search.set('channel', name)
    return search.toString()
  }
}

function DriftPanel({ channel, rule, phase, reference, referenceWafers }: {
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
    <section className="panel" aria-labelledby="drift-title">
      <header className="panel-head">
        <h2 id="drift-title">{channel.channel}</h2>
        <DriftBadge state={channel.state} />
      </header>
      <p className="note">{explain(channel, rule, reference)}</p>
      <PositionChart
        title={`${phase} phase mean`}
        label={`${phase} phase mean of ${channel.channel} by wafer position`}
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
      <div className="table-wrap">
        <table>
          <caption>Wafer by wafer</caption>
          <thead>
            <tr>
              <th scope="col" className="num">Wafer</th>
              <th scope="col">Run</th>
              <th scope="col" className="num">Mean</th>
              <th scope="col" className="num">z</th>
              <th scope="col" className="num">Slope so far</th>
              <th scope="col" className="num">t</th>
              <th scope="col">Verdict then</th>
            </tr>
          </thead>
          <tbody>
            {channel.points.map((point) => (
              <tr key={point.runId}>
                <td className="num">{point.position}</td>
                <td><Link className="key" to={`/runs/${point.runId}`}>{point.key}</Link></td>
                <td className="num">{formatValue(point.value)}</td>
                <td className="num">{formatScore(point.z)}</td>
                <td className="num">{formatValue(point.fit?.slope ?? null)}</td>
                <td className="num">{formatScore(point.fit?.tStat ?? null)}</td>
                <td><DriftBadge state={point.state} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
