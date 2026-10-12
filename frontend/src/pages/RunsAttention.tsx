import { Link } from 'react-router'
import type { Baseline, RunRow, Source } from '../api/schema'
import { withSource } from '../api/source'
import { LotDotPlot } from '../charts/LotDotPlot'
import { Icon } from '../components/Icon'
import { ZMeter } from '../components/ZMeter'
import { formatChannelName, formatConditioning, formatDate, formatScore, formatSeconds } from '../format'
import {
  type ChannelCount, describeLots, type DriftSummary, type LotDriftAnswer, type LotRuns, type RunsSummary, summarizeDrift,
} from '../summary'

const seconds = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

/** The recorder's rate: five samples a second, one every 0.2 s. */
const SAMPLE_S = 0.2

/**
 * The "Needs a look" tab: which channel left its range first, one card per lot with out-of-range runs, the lot drift,
 * and the lots with nothing out of range, then the words the page uses, defined once.
 */
export function AttentionPanel({ summary, baseline, drifts, source }: {
  summary: RunsSummary
  baseline: Baseline | null
  drifts: ReadonlyMap<number, LotDriftAnswer>
  source: Source
}) {
  const drift = summarizeDrift(summary.lots, drifts)
  return (
    <div className="panel-enter">
      <div className="grid">
        {summary.out.length > 0 && <ChannelCard counts={summary.firstChannels} outCount={summary.out.length} />}
        {baseline !== null && summary.attention.map((group, index) => <LotCard key={group.lotId} group={group} k={baseline.k} legend={index === 0} />)}
        <DriftCard drift={drift} source={source} />
        <CleanCard clean={summary.clean} />
      </div>
      {baseline !== null && <Definitions baseline={baseline} bandK={drift.k} />}
    </div>
  )
}

function ChannelCard({ counts, outCount }: { counts: readonly ChannelCount[]; outCount: number }) {
  return (
    <article className="card" aria-labelledby="first-channel-title">
      <span className="chip chan"><Icon name="crosshair" size={18} /></span>
      <h2 id="first-channel-title">Which channel left its range first</h2>
      <ul className="bars">
        {counts.map((entry) => (
          <li key={entry.channel ?? 'none'}>
            <div className="bar-row">
              <span>{entry.channel === null ? 'No channel named' : formatChannelName(entry.channel)}</span>
              <span className="bar-count">{`first in ${entry.count} of ${outCount}`}</span>
            </div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${(100 * entry.count) / outCount}%` }} /></div>
          </li>
        ))}
      </ul>
    </article>
  )
}

function LotCard({ group, k, legend }: { group: LotRuns; k: number; legend: boolean }) {
  const { lot } = group
  const when = lot === null
    ? []
    : [
        lot.runDate === null ? null : formatDate(lot.runDate),
        lot.conditioningCount === null || lot.conditioningSurface === null ? null : formatConditioning(lot.conditioningCount, lot.conditioningSurface),
      ].filter((part) => part !== null)
  return (
    <article className="card" id={`lot-${group.lotId}`} aria-labelledby={`lot-${group.lotId}-title`}>
      <span className="chip out"><Icon name="alert" size={18} /></span>
      <h2 id={`lot-${group.lotId}-title`}>
        {`Lot ${group.lotNo} `}
        <span className="rest">{`${group.out.length} of ${group.runs.length} ${group.runs.length === 1 ? 'wafer' : 'wafers'} out of range`}</span>
      </h2>
      {when.length > 0 && <p className="card-meta">{when.join(' · ')}</p>}
      <LotDotPlot lotNo={group.lotNo} runs={group.runs} k={k} legend={legend} />
      <ul className="wafers" aria-label={`Out-of-range wafers in Lot ${group.lotNo}`}>
        {group.out.map((run) => <WaferRow key={run.id} run={run} k={k} />)}
      </ul>
    </article>
  )
}

function WaferRow({ run, k }: { run: RunRow; k: number }) {
  const score = run.score
  const excursions = score?.limitFlags ?? 0
  return (
    <li>
      <Link to={`/runs/${run.id}`}>{`Wafer ${run.positionInLot}`}</Link>
      {score !== null && <ZMeter z={score.persistentZ} k={k} />}
      <span className="what">
        {score?.firstChannel === undefined || score.firstChannel === null ? 'No channel named' : formatChannelName(score.firstChannel)}
        <span>{` · left at ${formatSeconds(score?.firstTimeS ?? null)} · ${excursions} ${excursions === 1 ? 'excursion' : 'excursions'}`}</span>
        {(score?.stuckFlags ?? 0) > 0 && <span className="tag tag-warn">Stuck sensor</span>}
        {run.alignment === 'DEGRADED' && <span className="tag tag-warn">Alignment degraded</span>}
        {run.good && <span className="tag">Baseline run</span>}
      </span>
    </li>
  )
}

function DriftCard({ drift, source }: { drift: DriftSummary; source: Source }) {
  return (
    <article className="card" aria-labelledby="drift-title" aria-busy={drift.loading.length > 0}>
      <span className="chip drift"><Icon name="trend" size={18} /></span>
      <h2 id="drift-title">
        {'Drift along the lots '}
        <span className="rest">by each lot's last wafer</span>
      </h2>
      <ul className="drift-list">
        {drift.lines.map((line) => (
          <li key={line.channel}>
            {formatChannelName(line.channel)}
            <span>{line.text}</span>
          </li>
        ))}
        {drift.groups.map((group) => (
          <li key={group.label}>
            {group.label}
            <span>{capitalize(describeLots(group.lotNos))}</span>
          </li>
        ))}
        {drift.loading.length > 0 && (
          <li className="drift-loading">
            <span className="visually-hidden">{`Loading the drift of ${describeLots(drift.loading)}`}</span>
            <span className="skel skel-text" aria-hidden="true" />
            <span className="skel skel-text short" aria-hidden="true" />
          </li>
        )}
      </ul>
      <p className="card-foot">
        <Link to={withSource('/lots', source)}>All lots</Link>
      </p>
    </article>
  )
}

function CleanCard({ clean }: { clean: readonly LotRuns[] }) {
  if (clean.length === 0) {
    return null
  }
  const wafers = clean.reduce((total, group) => total + group.runs.length, 0)
  return (
    <article className="card wide" aria-labelledby="clean-title">
      <span className="chip ok"><Icon name="check" size={18} /></span>
      <h2 id="clean-title">
        {`${capitalize(describeLots(clean.map((group) => group.lotNo)))} `}
        <span className="rest">{`${wafers} ${wafers === 1 ? 'wafer' : 'wafers'}, none out of range`}</span>
      </h2>
      <ul className="lot-pills">
        {clean.map((group) => (
          <li key={group.lotId}>
            <b>{`Lot ${group.lotNo}`}</b>
            {group.lot?.runDate === undefined || group.lot.runDate === null
              ? `${group.runs.length} ${group.runs.length === 1 ? 'wafer' : 'wafers'}`
              : formatDate(group.lot.runDate)}
          </li>
        ))}
      </ul>
    </article>
  )
}

function Definitions({ baseline, bandK }: { baseline: Baseline; bandK: number | null }) {
  const hold = `${baseline.n} samples (${seconds.format(baseline.n * SAMPLE_S)} s)`
  return (
    <dl className="words">
      <div>
        <dt>How unusual</dt>
        <dd>{`How many standard deviations a channel stayed away from the good runs, held for ${hold} in a row. Each run shows its largest.`}</dd>
      </div>
      <div>
        <dt>Out of range</dt>
        <dd>
          {`A detector flagged the run: a channel stayed past the limit of ${formatScore(baseline.k)}, a phase mean or spread sat more than ${formatScore(baseline.runZ)} from the good runs, or a sensor held one value longer than any good run did. A flag says the tool behaved differently; it does not say the wafer etched worse.`}
        </dd>
      </div>
      <div>
        <dt>First channel</dt>
        <dd>The channel that left the good-run range earliest in the run's record.</dd>
      </div>
      <div>
        <dt>Excursion</dt>
        <dd>{`One stretch where a channel stayed past the limit for ${baseline.n} samples or more.`}</dd>
      </div>
      <div>
        <dt>{`Baseline #${baseline.id}`}</dt>
        <dd>{`What good looks like, learned from ${baseline.goodRuns} good runs, marked Baseline run.`}</dd>
      </div>
      {bandK !== null && (
        <div>
          <dt>Band</dt>
          <dd>{`For drift: the good runs' SF6-phase average, ± ${formatScore(bandK)} standard deviations.`}</dd>
        </div>
      )}
    </dl>
  )
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

