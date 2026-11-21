import { Link } from 'react-router'
import type { Baseline, RunRow, Source } from '../api/schema'
import { withSource } from '../api/source'
import { scoreLineEnd, timeLineEnd } from '../charts/scale'
import { Disc } from '../components/Disc'
import { Figure } from '../components/Figure'
import { ScoreLine } from '../components/ScoreLine'
import { formatBigScore, formatChannelName, formatConditioning, formatDate, formatScore, formatSeconds, formatShortScore, MISSING } from '../format'
import {
  capitalize, type ChannelCount, clusterByLot, describeClean, describeDrift, describeFirstChannels, describeLots, type DriftSummary,
  type LotDriftAnswer, type LotRuns, type RunsSummary, summarizeDrift,
} from '../summary'

const seconds = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

/** The recorder's rate: five samples a second, one every 0.2 s. */
const SAMPLE_S = 0.2

/**
 * The "Needs a look" tab: which channel left its range first, the out-of-range runs lot by lot, the lot drift, the
 * lots with nothing out of range in one line, then the words the page uses, closed until asked for.
 */
export function AttentionPanel({ summary, baseline, drifts, source }: {
  summary: RunsSummary
  baseline: Baseline | null
  drifts: ReadonlyMap<number, LotDriftAnswer>
  source: Source
}) {
  const drift = summarizeDrift(summary.lots, drifts)
  const clean = describeClean(summary.clean)
  return (
    <div className="panel-enter attention">
      {summary.out.length > 0 && <FirstChannels counts={summary.firstChannels} outCount={summary.out.length} />}
      {summary.out.length > 0 && <OutLedger summary={summary} k={baseline?.k ?? null} />}
      <DriftFigure drift={drift} source={source} />
      {clean !== null && <p className="clean-line">{clean}</p>}
      {baseline !== null && <Definitions baseline={baseline} bandK={drift.k} />}
    </div>
  )
}

/** One column per channel: how many out-of-range runs it was first in, and those runs as discs clustered by lot. */
function FirstChannels({ counts, outCount }: { counts: readonly ChannelCount[]; outCount: number }) {
  return (
    <Figure id="first-channel" title="Which channel left its range first" answer={describeFirstChannels(counts, outCount)}>
      <p className="figure-note">Each disc is one out-of-range run; the number is its wafer.</p>
      <div className="first-channels">
        {counts.map((entry) => (
          <section key={entry.channel ?? 'none'} className="channel-group" aria-label={entry.channel === null ? 'No channel named' : formatChannelName(entry.channel)}>
            <h3>
              <span className="channel-name">{entry.channel === null ? 'No channel named' : formatChannelName(entry.channel)}</span>
              {' '}
              <span className="channel-count">
                <b>{entry.count}</b>
                {` of ${outCount}`}
              </span>
            </h3>
            <div className="clusters">
              {clusterByLot(entry.runs).map((cluster) => (
                <div key={cluster.lotId} className="cluster">
                  <div className="cluster-discs">
                    {cluster.runs.map((run) => (
                      <Disc
                        key={run.id}
                        state="out"
                        size="cluster"
                        text={String(run.positionInLot)}
                        to={`/runs/${run.id}`}
                        label={`Lot ${cluster.lotNo}, wafer ${run.positionInLot}: out of range${run.score === null ? '' : `, how unusual ${formatShortScore(run.score.persistentZ)}`}`}
                      />
                    ))}
                  </div>
                  <span className="cluster-lot">{`Lot ${cluster.lotNo}`}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Figure>
  )
}

/**
 * Every out-of-range run in one ledger, a lot row over its wafers. Scores share one line from 0 to the largest, and
 * the time each run left its range one line from 0 to the latest, so a lot whose wafers left earlier and earlier reads
 * as ticks stepping left.
 */
function OutLedger({ summary, k }: { summary: RunsSummary; k: number | null }) {
  const lots = summary.lots.filter((group) => group.out.length > 0)
  const scored = summary.out.flatMap((run) => (run.score === null ? [] : [{ run, z: run.score.persistentZ }]))
  const { end, past } = scoreLineEnd(scored.map((entry) => entry.z), k)
  const timeEnd = timeLineEnd(summary.out.flatMap((run) => (run.score?.firstTimeS === undefined || run.score.firstTimeS === null ? [] : [run.score.firstTimeS])))
  const top = scored.reduce<(typeof scored)[number] | null>((best, entry) => (best === null || entry.z > best.z ? entry : best), null)
  const answer = top === null
    ? null
    : `The highest score is ${formatBigScore(top.z)}, Lot ${top.run.lotNo} wafer ${top.run.positionInLot}. Each line runs from 0 to ${end}`
      + `${k === null ? '' : `; the tick is the limit, ${formatScore(k)}`}`
      + `${past === 0 ? '' : `, and ${past} ${past === 1 ? 'score runs' : 'scores run'} past its end`}.`
  return (
    <Figure id="out-runs" title="Out-of-range runs, by lot" answer={answer}>
      <div className="ledger-scroll">
        <table className="ledger out-ledger">
          <caption className="visually-hidden">The out-of-range runs of each lot</caption>
          <thead>
            <tr>
              <th scope="col">Wafer</th>
              <th scope="col">How unusual</th>
              <th scope="col">First channel</th>
              <th scope="col">
                Left at
                <span className="th-scale">{` 0 to ${timeEnd} s`}</span>
              </th>
              <th scope="col" className="num">Excursions</th>
            </tr>
          </thead>
          {lots.map((group) => (
            <tbody key={group.lotId}>
              <tr className="ledger-lot" id={`lot-${group.lotId}`}>
                <th scope="rowgroup" colSpan={5}>
                  <Link className="ledger-lot-name" to={`/lots/${group.lotId}`}>{`Lot ${group.lotNo}`}</Link>
                  <span className="ledger-lot-meta">{lotMeta(group)}</span>
                </th>
              </tr>
              {group.out.map((run) => <OutRow key={run.id} run={run} k={k} end={end} timeEnd={timeEnd} />)}
            </tbody>
          ))}
        </table>
      </div>
    </Figure>
  )
}

function lotMeta(group: LotRuns): string {
  const { lot } = group
  return [
    lot?.runDate === undefined || lot.runDate === null ? null : formatDate(lot.runDate),
    lot === null || lot.conditioningCount === null || lot.conditioningSurface === null ? null : formatConditioning(lot.conditioningCount, lot.conditioningSurface),
    `${group.out.length} of ${group.runs.length} out`,
  ].filter((part) => part !== null).join(' · ')
}

function OutRow({ run, k, end, timeEnd }: { run: RunRow; k: number | null; end: number; timeEnd: number }) {
  const score = run.score
  const at = score?.firstTimeS ?? null
  return (
    <tr className="ledger-run">
      <td className="c-wafer">
        <span className="wafer-cell">
          <Disc state="out" size="ledger" />
          <Link to={`/runs/${run.id}`}>
            <span className="visually-hidden">{`Lot ${run.lotNo}, `}</span>
            {`Wafer ${run.positionInLot}`}
          </Link>
        </span>
      </td>
      <td className="c-score">
        {score === null
          ? MISSING
          : (
              <span className="score-cell">
                <span className="score-num">{formatShortScore(score.persistentZ)}</span>
                <ScoreLine z={score.persistentZ} k={k} end={end} out />
              </span>
            )}
      </td>
      <td className="c-chan">
        {score?.firstChannel === undefined || score.firstChannel === null ? 'No channel named' : formatChannelName(score.firstChannel)}
        <Words run={run} />
      </td>
      <td className="c-at" data-label="Left at">
        {at === null
          ? MISSING
          : (
              <span className="time-cell">
                <span className="time-line" aria-hidden="true"><span className="time-tick" style={{ left: `${(100 * Math.min(at, timeEnd)) / timeEnd}%` }} /></span>
                <span className="time-value">{formatSeconds(at)}</span>
              </span>
            )}
      </td>
      <td className="c-exc num" data-label="Excursions">{score?.limitFlags ?? MISSING}</td>
    </tr>
  )
}

/** The warnings and roles a run carries, as words next to its channel. */
export function Words({ run }: { run: RunRow }) {
  return (
    <>
      {(run.score?.stuckFlags ?? 0) > 0 && <span className="word warn">Stuck sensor</span>}
      {run.alignment === 'DEGRADED' && <span className="word warn">Alignment degraded</span>}
      {run.good && <span className="word">Baseline run</span>}
    </>
  )
}

/** The drift card's content as plain ledger rows: each drifting channel with its lots, then every other lot once. */
function DriftFigure({ drift, source }: { drift: DriftSummary; source: Source }) {
  const answer = describeDrift(drift)
  return (
    <Figure
      id="drift"
      title="Drift along the lots"
      answer={answer ?? <span className="skel skel-text" aria-hidden="true" />}
      busy={drift.loading.length > 0}
    >
      <table className="ledger drift-ledger">
        <caption className="visually-hidden">Drift along the lots, by each lot's last wafer</caption>
        <thead>
          <tr>
            <th scope="col">Channel</th>
            <th scope="col">Lots</th>
          </tr>
        </thead>
        <tbody>
          {drift.lines.map((line) => (
            <tr key={line.channel}>
              <th scope="row">{formatChannelName(line.channel)}</th>
              <td>{line.text}</td>
            </tr>
          ))}
          {drift.groups.map((group) => (
            <tr key={group.label} className="drift-group">
              <th scope="row">{group.label}</th>
              <td>{capitalize(describeLots(group.lotNos))}</td>
            </tr>
          ))}
          {drift.loading.length > 0 && (
            <tr className="drift-loading">
              <td colSpan={2}>
                <span className="visually-hidden">{`Loading the drift of ${describeLots(drift.loading)}`}</span>
                <span className="skel skel-text" aria-hidden="true" />
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="figure-foot">
        <Link to={withSource('/lots', source)}>All lots</Link>
      </p>
    </Figure>
  )
}

function Definitions({ baseline, bandK }: { baseline: Baseline; bandK: number | null }) {
  const hold = `${baseline.n} samples (${seconds.format(baseline.n * SAMPLE_S)} s)`
  return (
    <details className="how words-how">
      <summary>The words this page uses</summary>
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
    </details>
  )
}
