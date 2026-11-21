import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { getJson, putJson } from '../api/client'
import {
  type Alignment,
  type Channel,
  type Excursion,
  type Hold,
  type InjectedFault,
  type Label,
  type PhaseEvidence,
  refreshSchema,
  type RelabelResult,
  runDetailSchema,
  type RunDetail,
  runsPageSchema,
  type Score,
  settingsSchema,
  traceSchema,
} from '../api/schema'
import { withSource } from '../api/source'
import { useResource } from '../api/useResource'
import { ChannelLineup } from '../charts/ChannelLineup'
import { EtchTimeline } from '../charts/EtchTimeline'
import { verdictEnd } from '../charts/scale'
import { TraceChart } from '../charts/TraceChart'
import { Disc } from '../components/Disc'
import { Figure } from '../components/Figure'
import { Icon } from '../components/Icon'
import { Loaded } from '../components/Loaded'
import { ScoreLine } from '../components/ScoreLine'
import {
  describeCatch, describeChannelTrace, describeFault, describeRun, formatBigScore, formatChannelName, formatDate, formatFaultKind,
  formatLabel, formatScore, formatSeconds, formatShortAgainstLimit, formatValue,
} from '../format'
import {
  describeUnscored, describeVerdict, lotStrip, runDetailState, runHeadline, runTitle, type StripSlot,
} from '../run'
import { NotFound } from './NotFound'

/** Etch cycles on the recipe grid. */
const CYCLES = 100

/** Buckets a trace asks for, about one per horizontal pixel of a wide chart. */
const MAX_POINTS = 1200

const LABEL_ORDER: readonly Label[] = ['AUTO', 'GOOD', 'BAD']

const LABEL_MEANINGS = {
  AUTO: 'counts as a good run when it is one of the first wafers of its lot and aligned cleanly.',
  GOOD: 'always counts as a good run.',
  BAD: 'never counts as a good run.',
} as const satisfies Record<Label, string>

type Cycles = { kind: 'cycles'; from: number; to: number }

/** What the chart shows: a span of etch cycles, or the whole record with the time before and after the etch. */
type View = Cycles | { kind: 'record' }

/** The default view, since the detectors only score the etch. */
const ETCH: Cycles = { kind: 'cycles', from: 1, to: CYCLES }

/** How often the page asks whether a refit is done, and how many times it asks before it stops: ten minutes. */
const POLL_MS = 500
const MAX_POLLS = 1200

type Relabel =
  | { kind: 'idle' }
  | { kind: 'saving'; label: Label }
  | { kind: 'done'; result: RelabelResult }
  | { kind: 'failed'; message: string }

export function RunPage() {
  const { runId } = useParams()
  if (runId === undefined || !/^\d+$/.test(runId)) {
    return <NotFound />
  }
  return <RunView key={runId} runId={Number(runId)} />
}

function RunView({ runId }: { runId: number }) {
  const [run, reload] = useResource(`/api/runs/${runId}`, runDetailSchema)
  switch (run.kind) {
    case 'loading':
      return <RunSkeleton />
    case 'error':
      return (
        <div className="state run-state">
          <p className="state-title">This run did not load</p>
          <p role="alert">{run.error.message}</p>
          <button type="button" className="button" onClick={reload}>
            <Icon name="refresh" />
            Try again
          </button>
        </div>
      )
    case 'ready':
      return (
        <div className={run.refreshing ? 'run-page refreshing' : 'run-page'} aria-busy={run.refreshing || undefined}>
          <RunDetails run={run.data} onRelabeled={reload} />
        </div>
      )
    default: {
      const exhaustive: never = run
      return exhaustive
    }
  }
}

/** The page's shape while the run loads: the breadcrumb, the lot strip, two lines of headline, the lead, a figure. */
function RunSkeleton() {
  return (
    <div className="run-page" role="status">
      <span className="visually-hidden">Loading…</span>
      <div className="run-head" aria-hidden="true">
        <span className="skel skel-crumb" />
        <div className="lot-strip placeholder"><span className="skel skel-strip" /></div>
        <span className="skel skel-title" />
        <span className="skel skel-title short" />
        <span className="skel skel-lead" />
      </div>
      <span className="skel skel-panel" aria-hidden="true" />
    </div>
  )
}

function RunDetails({ run, onRelabeled }: { run: RunDetail; onRelabeled: () => void }) {
  const [params] = useSearchParams()
  const selected = run.channels.find((channel) => channel.channel === params.get('channel')) ?? run.channels[0]
  const { assessment, baseline } = run
  const [settings] = useResource('/api/settings', settingsSchema)
  // until the settings arrive the buttons wait; if they never do, the server still refuses a read-only relabel
  const readOnly = settings.kind === 'ready' ? settings.data.readOnly : settings.kind === 'loading'
  return (
    <>
      <title>{runTitle(run)}</title>
      <RunHead run={run} />
      {assessment !== null && run.alignment.kind === 'aligned' && (
        <EtchTimeline
          assessment={assessment}
          channels={run.channels}
          k={baseline?.k ?? null}
          etch={{ fromS: run.alignment.etchStartS, toS: run.alignment.etchEndS }}
          fault={run.injectedFault}
        />
      )}
      {run.injectedFault !== null && (
        <InjectedFaultFigure fault={run.injectedFault} assessment={assessment} scoredChannels={run.channels} />
      )}
      <div className="run-cols">
        {/* a run with no scored channel shows neither: the trace's figure already says so */}
        {run.channels.length > 0 && (baseline !== null
          ? <ChannelLineup channels={run.channels} selected={selected} k={baseline.k} n={baseline.n} />
          : (
            // with no baseline there is no limit to line the channels up against, so the plain ranked list stands in
            <Figure id="channels" title="Channels by rank" answer="There is no baseline, so there is no limit to line them up against." className="channels">
              <ChannelsTable channels={run.channels} selected={selected} />
            </Figure>
          ))}
        {selected === undefined
          ? (
            <Figure id="trace" title="Trace">
              <p className="state">No channel of this run was scored.</p>
            </Figure>
          )
          // a relabel's refit moves the band, so a new baseline mounts the chart afresh and fetches its trace again
          : <ChannelFigure key={run.baseline?.id ?? 0} runId={run.id} channel={selected} />}
      </div>
      <div className="run-panels">
        <RelabelPanel runId={run.id} label={run.label} readOnly={readOnly} onRelabeled={onRelabeled} />
        <Figure id="alignment" title="Alignment" numbered={false} className="panel-small">
          <AlignmentFacts alignment={run.alignment} />
        </Figure>
      </div>
    </>
  )
}

/** The head: the lot strip, the sentence that says how the run did, its lead and meta line, and the verdict beside them. */
function RunHead({ run }: { run: RunDetail }) {
  const { assessment, baseline } = run
  // the 89-point set comes first when the wafer is in both
  const measured = run.measuredDepth[0]
  return (
    <header className="run-head">
      <p className="breadcrumb">
        <Link to={withSource('/', run.source)}>Runs</Link>
        <span aria-hidden="true"> / </span>
        <Link to={withSource(`/?lot=${run.lotId}`, run.source)}>Lot {run.lotNo}</Link>
        <span aria-hidden="true"> / </span>
        Wafer {run.positionInLot}
      </p>
      <div className="run-head-grid">
        <div className="run-head-main">
          <LotStripView run={run} />
          {/* "Lot 6" and "Wafer 5" never break across lines */}
          <h1>{runHeadline(run).replace(/(Wafer|Lot) (\d+)/g, '$1\u00a0$2')}</h1>
          <p className="run-lead">
            {assessment === null
              ? describeUnscored(run)
              : <Lead text={describeRun({ assessment, channels: run.channels, good: run.good, depth: measured })} first={assessment.firstChannel} />}
          </p>
          <p className="run-meta">
            {run.runDate !== null && <span>{formatDate(run.runDate)}</span>}
            <span className="run-key">{run.key}</span>
            {run.good && <span className="word">Baseline run</span>}
            {run.alignment.kind === 'aligned' && run.alignment.status === 'DEGRADED' && <span className="word warn">Alignment degraded</span>}
            {(assessment?.stuckFlags ?? 0) > 0 && <span className="word warn">Stuck sensor</span>}
            {run.source === 'PUBLIC' && <Link to={`/runs/${run.id}/wafer`}>Measured depth</Link>}
            <Link to={`/lots/${run.lotId}`}>{`Lot ${run.lotNo} drift`}</Link>
          </p>
        </div>
        {assessment !== null && baseline !== null && <Verdict run={run} score={assessment} k={baseline.k} />}
      </div>
    </header>
  )
}

/** The lead, with the channel it opens on set in bold when it opens on one. */
function Lead({ text, first }: { text: string; first: string | null }) {
  const name = first === null ? null : formatChannelName(first)
  if (name === null || !text.startsWith(name)) {
    return text
  }
  return (
    <>
      <strong>{name}</strong>
      {text.slice(name.length)}
    </>
  )
}

/** How unusual the run was: its score as a big numeral beside its disc, one sentence, and the score on its line. */
function Verdict({ run, score, k }: { run: RunDetail; score: Score; k: number }) {
  const state = runDetailState(run)
  const end = verdictEnd(score.persistentZ, k)
  const z = formatBigScore(score.persistentZ)
  return (
    <section className="run-verdict" aria-labelledby="verdict-title">
      <h2 id="verdict-title" className="verdict-label">How unusual</h2>
      <p className="verdict-big">
        <Disc state={state} size="ledger" />
        <span className="verdict-num">{z}</span>
      </p>
      <p className="verdict-state">{describeVerdict(score, k)}</p>
      <ScoreLine
        z={score.persistentZ}
        k={k}
        end={end}
        out={state === 'out'}
        size="verdict"
        ticks
        label={`${z} on a scale from 0 to ${end}, with the limit at ${formatScore(k)}${score.persistentZ > end ? '; the score runs past the end' : ''}`}
      />
    </section>
  )
}

/**
 * The run's lot as a row of discs above the `h1`, each a link to its run, this one larger with its score inside. The
 * lot's wafers come from the runs list, since the run's own answer does not carry them; the strip holds its height while
 * that loads and is left out if it fails.
 */
function LotStripView({ run }: { run: RunDetail }) {
  const [runs] = useResource(withSource(`/api/runs?lot=${run.lotId}`, run.source), runsPageSchema)
  if (runs.kind === 'error') {
    return null
  }
  if (runs.kind === 'loading') {
    return <div className="lot-strip placeholder" aria-hidden="true"><span className="skel skel-strip" /></div>
  }
  const strip = lotStrip(runs.data.runs, run)
  const n = strip.baseline
  const baseline = n === null ? [] : strip.slots.filter((slot) => slot.position <= n)
  const rest = n === null ? strip.slots : strip.slots.filter((slot) => slot.position > n)
  // the "this wafer" label goes under its disc when the baseline bracket already holds the space above it
  const hereInBaseline = baseline.some((slot) => slot.current)
  return (
    <div className={hereInBaseline ? 'lot-strip label-below' : 'lot-strip'} role="group" aria-label={`Lot ${run.lotNo}, wafer by wafer`}>
      {baseline.length > 0 && (
        <span className="strip-baseline">
          <span className="strip-bracket" aria-hidden="true">Baseline</span>
          {baseline.map((slot) => <StripDisc key={slot.id} slot={slot} marked={false} />)}
        </span>
      )}
      {rest.map((slot) => <StripDisc key={slot.id} slot={slot} marked={n === null && slot.good} />)}
    </div>
  )
}

function StripDisc({ slot, marked }: { slot: StripSlot; marked: boolean }) {
  const disc = (
    <Disc
      state={slot.state}
      size={slot.current ? 'here' : 'strip'}
      text={slot.text}
      to={`/runs/${slot.id}`}
      label={slot.label}
      current={slot.current}
      baseline={marked}
    />
  )
  if (!slot.current) {
    return disc
  }
  return (
    <span className="strip-here">
      <span className="strip-here-label" aria-hidden="true">This wafer</span>
      {disc}
    </span>
  )
}

function ChannelsTable({ channels, selected }: { channels: readonly Channel[]; selected: Channel | undefined }) {
  return (
    <div className="table-wrap">
      <table className="compact">
        <thead>
          <tr>
            <th scope="col" className="num">Rank</th>
            <th scope="col">Channel</th>
            <th scope="col" className="num">How unusual</th>
            <th scope="col" className="num">Excursions</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((channel) => (
            <tr key={channel.channel} className={channel === selected ? 'selected' : undefined}>
              <td className="num">{channel.rank}</td>
              <td>
                <Link
                  to={{ search: `?channel=${encodeURIComponent(channel.channel)}` }}
                  replace
                  preventScrollReset
                  aria-current={channel === selected ? 'true' : undefined}
                >
                  {formatChannelName(channel.channel)}
                </Link>
                {channel.deviation && <span className="word">Deviates</span>}
                {channel.holds.length > 0 && <span className="word warn">Stuck</span>}
              </td>
              <td className="num">{formatScore(channel.persistentZ)}</td>
              <td className="num">{channel.excursions.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The picked channel's trace, with its phase statistics, holds and excursions under it. */
function ChannelFigure({ runId, channel }: { runId: number; channel: Channel }) {
  const [params, setParams] = useSearchParams()
  const view = readView(params)
  const first = channel.excursions[0]
  const zoom: Cycles | null = first === undefined
    ? null
    : { kind: 'cycles', from: Math.max(1, first.cycle - 1), to: Math.min(CYCLES, first.cycle + 1) }
  const query = new URLSearchParams({ maxPoints: String(MAX_POINTS) })
  if (view.kind === 'cycles') {
    query.set('fromCycle', String(view.from))
    query.set('toCycle', String(view.to))
  }
  const [trace] = useResource(`/api/runs/${runId}/channels/${encodeURIComponent(channel.channel)}/trace?${query}`, traceSchema)

  function show(next: View) {
    const search = new URLSearchParams({ channel: channel.channel })
    if (next.kind === 'record') {
      search.set('view', 'record')
    }
    else if (!sameView(next, ETCH)) {
      search.set('from', String(next.from))
      search.set('to', String(next.to))
    }
    setParams(search, { replace: true, preventScrollReset: true })
  }

  const views: ReadonlyArray<readonly [View, string]> = [
    [ETCH, 'Etch'],
    ...(zoom === null ? [] : [[zoom, `Cycles ${zoom.from} to ${zoom.to}`] as const]),
    [{ kind: 'record' }, 'Whole record'],
  ]
  return (
    <Figure
      id="trace"
      title={formatChannelName(channel.channel)}
      className="trace-figure"
      answer={describeChannelTrace(channel)}
      control={(
        <div className="segmented" role="group" aria-label="Part of the record shown">
          {views.map(([option, text]) => (
            <button key={text} type="button" aria-pressed={sameView(view, option)} onClick={() => show(option)}>{text}</button>
          ))}
        </div>
      )}
    >
      <Loaded resource={trace}>{(data) => <TraceChart trace={data} holds={channel.holds} />}</Loaded>
      <EvidenceTable phases={channel.phases} />
      {channel.holds.length > 0 && <HoldsTable holds={channel.holds} longestHold={channel.longestHold} />}
      {channel.excursions.length > 0 && <ExcursionsTable excursions={channel.excursions} />}
    </Figure>
  )
}

function HoldsTable({ holds, longestHold }: { holds: readonly Hold[]; longestHold: number }) {
  return (
    <div className="table-wrap figure-table">
      <table>
        <caption>{`Holds: one value reported longer than any good run held one on this channel (longest ${longestHold} samples)`}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">Cycle</th>
            <th scope="col">Phase</th>
            <th scope="col" className="num">Starts</th>
            <th scope="col" className="num">Confirmed</th>
            <th scope="col" className="num">Ends</th>
            <th scope="col" className="num">Samples</th>
            <th scope="col" className="num">Value held</th>
          </tr>
        </thead>
        <tbody>
          {holds.map((hold) => (
            <tr key={hold.startSlot}>
              <td className="num">{hold.cycle}</td>
              <td>{hold.phase}</td>
              <td className="num">{formatSeconds(hold.startTimeS)}</td>
              <td className="num">{formatSeconds(hold.confirmTimeS)}</td>
              <td className="num">{formatSeconds(hold.endTimeS)}</td>
              <td className="num">{hold.samples}</td>
              <td className="num">{formatValue(hold.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Each phase's mean and spread against the good runs', with the z of each; a z past the limit is set in red. */
function EvidenceTable({ phases }: { phases: readonly PhaseEvidence[] }) {
  return (
    <div className="table-wrap figure-table">
      <table>
        <caption>Phase statistics against the good runs</caption>
        <thead>
          <tr>
            <th scope="col">Phase</th>
            <th scope="col" className="num">Mean</th>
            <th scope="col" className="num">Good-run mean</th>
            <th scope="col" className="num">z</th>
            <th scope="col" className="num">Spread</th>
            <th scope="col" className="num">Good-run spread</th>
            <th scope="col" className="num">z</th>
          </tr>
        </thead>
        <tbody>
          {phases.map((phase) => (
            <tr key={phase.phase}>
              <th scope="row">{phase.phase}</th>
              <td className="num">{formatValue(phase.mean)}</td>
              <td className="num">{formatValue(phase.goodMean)}</td>
              <td className="num strong">{formatScore(phase.meanZ)}</td>
              <td className="num">{formatValue(phase.sd)}</td>
              <td className="num">{formatValue(phase.goodSd)}</td>
              <td className="num strong">{formatScore(phase.sdZ)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Every excursion, closed until asked for: a step change can have nearly a hundred. */
function ExcursionsTable({ excursions }: { excursions: readonly Excursion[] }) {
  return (
    <details className="how figure-table">
      <summary>{`Every excursion (${excursions.length})`}</summary>
      <div className="table-wrap table-scroll">
        <table>
          <caption className="visually-hidden">Excursions</caption>
          <thead>
            <tr>
              <th scope="col" className="num">Cycle</th>
              <th scope="col">Phase</th>
              <th scope="col" className="num">Starts</th>
              <th scope="col" className="num">Confirmed</th>
              <th scope="col" className="num">Ends</th>
              <th scope="col" className="num">Samples out</th>
              <th scope="col" className="num">Peak z</th>
            </tr>
          </thead>
          <tbody>
            {excursions.map((excursion) => (
              <tr key={excursion.startSlot}>
                <td className="num">{excursion.cycle}</td>
                <td>{excursion.phase}</td>
                <td className="num">{formatSeconds(excursion.startTimeS)}</td>
                <td className="num">{formatSeconds(excursion.confirmTimeS)}</td>
                <td className="num">{formatSeconds(excursion.endTimeS)}</td>
                <td className="num">{excursion.outSamples}</td>
                <td className="num">{formatScore(excursion.peakZ)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function RelabelPanel({ runId, label, readOnly, onRelabeled }: {
  runId: number
  label: Label
  readOnly: boolean
  onRelabeled: () => void
}) {
  const [state, setState] = useState<Relabel>({ kind: 'idle' })
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // The API saves the label and answers at once; the refit runs on the server, and the page asks until it is done.
  // Once the label is saved the run is reloaded however the refit ends, so the page shows the label that was saved.
  async function relabel(next: Label) {
    setState({ kind: 'saving', label: next })
    let saved = false
    try {
      let refresh = await putJson(`/api/runs/${runId}/label`, { label: next }, refreshSchema)
      saved = true
      for (let polls = 0; refresh.kind === 'running'; polls++) {
        if (polls === MAX_POLLS) {
          throw new Error('it was still running after ten minutes')
        }
        await delay(POLL_MS)
        if (!mounted.current) {
          return
        }
        refresh = await getJson(`/api/refreshes/${refresh.id}`, refreshSchema)
      }
      if (!mounted.current) {
        return
      }
      setState(refresh.kind === 'failed'
        ? { kind: 'failed', message: `The label is saved, but the refit failed: ${refresh.message}. The next relabel refits again.` }
        : { kind: 'done', result: refresh.result })
    }
    catch (error) {
      if (mounted.current) {
        const reason = error instanceof Error ? error.message : String(error)
        setState({
          kind: 'failed',
          message: saved ? `The label is saved, but the page lost track of the refit: ${reason}. Reload later to see the baseline follow it.` : reason,
        })
      }
    }
    finally {
      if (saved && mounted.current) {
        onRelabeled()
      }
    }
  }

  return (
    <Figure id="label" title="Label" numbered={false} className="panel-small">
      <p className="note">
        Good runs teach the baseline. This run is labeled {formatLabel(label)}, so it {LABEL_MEANINGS[label]}
      </p>
      {readOnly
        ? <p className="note">Labels cannot be changed on this ChamberWatch, a read-only demo.</p>
        : (
          <div className="segmented label-switch" role="group" aria-label="Label">
            {LABEL_ORDER.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === label}
                disabled={state.kind === 'saving'}
                onClick={() => void relabel(option)}
              >
                {formatLabel(option)}
              </button>
            ))}
          </div>
        )}
      <RelabelStatus state={state} />
    </Figure>
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function RelabelStatus({ state }: { state: Relabel }) {
  switch (state.kind) {
    case 'idle':
      return null
    case 'saving':
      return (
        <p className="note" role="status">
          Labeling the run {formatLabel(state.label)}, then refitting the baseline and scoring every run again. On the
          public data that takes about 12 seconds.
        </p>
      )
    case 'done':
      return <p className="note" role="status">{describeRefit(state.result)}</p>
    case 'failed':
      return <p className="note" role="alert">{state.message}</p>
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

function describeRefit(result: RelabelResult): string {
  if (result.baselineId === null) {
    return 'No good runs are left, so there is no baseline to score against.'
  }
  const summary = `Baseline #${result.baselineId} ${result.fitted ? 'fitted' : 'reused'} from ${result.goodRuns ?? 0} good runs. `
    + `${result.scored} runs scored, ${result.flagged} out of range.`
  return result.current ? summary : `${summary} A relabel that read newer labels finished first, and its baseline is the current one.`
}

/**
 * What the simulator put into a synthetic run, next to what the detectors made of it. The detectors never see this.
 * The answer line is whether they caught it; the rows say what was put in.
 */
function InjectedFaultFigure({ fault, assessment, scoredChannels }: {
  fault: InjectedFault
  assessment: Score | null
  scoredChannels: readonly Channel[]
}) {
  const channel = scoredChannels.find((candidate) => candidate.channel === fault.channel)
  return (
    <Figure id="fault" title="Injected fault" answer={describeCatch(fault, assessment)} className="fault">
      <p className="figure-note">
        This is a simulated run. The simulator put one fault into it, and the detectors scored the run without knowing.
      </p>
      <Facts
        rows={[
          ['Kind', formatFaultKind(fault.kind)],
          ['Channel', channel === undefined
            ? formatChannelName(fault.channel)
            : (
                <>
                  <Link to={{ search: `?channel=${encodeURIComponent(fault.channel)}` }} replace preventScrollReset>
                    {formatChannelName(fault.channel)}
                  </Link>
                  <span className="facts-aside">{`how unusual ${formatShortAgainstLimit(channel.persistentZ, null)}`}</span>
                </>
              )],
          ['What it did', describeFault(fault)],
        ]}
      />
    </Figure>
  )
}

/** A ruled list of facts: a mono label over each value on a phone, beside it on a wider page. */
function Facts({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="facts">
      {rows.map(([term, value]) => (
        <Fragment key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

function AlignmentFacts({ alignment }: { alignment: Alignment }) {
  if (alignment.kind === 'failed') {
    return <p className="note">The aligner could not place this run on the recipe grid: {alignment.note ?? 'no reason was recorded'}.</p>
  }
  const { gap } = alignment
  return (
    <Facts
      rows={[
        ['Status', alignment.status === 'ALIGNED'
          ? 'Aligned cleanly'
          : <><span className="word warn">Degraded</span>{alignment.note === null ? '' : ` ${alignment.note}`}</>],
        ['Etch', `${formatSeconds(alignment.etchStartS)} to ${formatSeconds(alignment.etchEndS)}`],
        ['Cycles', `${alignment.c4f8Phases} C4F8 phases, last cycle ${alignment.lastCycle}`],
        ['Cycle 1', alignment.cycle1Sf6 ? 'Starts with SF6' : 'Starts with C4F8'],
        ['Phase onsets', `${alignment.onsetsDetected} found, ${alignment.onsetsPredicted} predicted`],
        ['Largest gap', gap === null
          ? 'None'
          : `${formatSeconds(gap.lengthS)} at ${formatSeconds(gap.startS)}, ${gap.insideEtch ? 'inside' : 'outside'} the etch`],
        ...(alignment.irregularCycles.length > 0 ? [['Irregular cycles', alignment.irregularCycles.join(', ')] as const] : []),
      ]}
    />
  )
}

function readView(params: URLSearchParams): View {
  if (params.get('view') === 'record') {
    return { kind: 'record' }
  }
  const from = params.get('from')
  const to = params.get('to')
  if (from === null || to === null || !/^\d+$/.test(from) || !/^\d+$/.test(to)) {
    return ETCH
  }
  const cycles: Cycles = { kind: 'cycles', from: Number(from), to: Number(to) }
  return cycles.from >= 1 && cycles.to <= CYCLES && cycles.from <= cycles.to ? cycles : ETCH
}

function sameView(a: View, b: View): boolean {
  if (a.kind === 'record' || b.kind === 'record') {
    return a.kind === b.kind
  }
  return a.from === b.from && a.to === b.to
}
