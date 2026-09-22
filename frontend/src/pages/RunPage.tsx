import { useEffect, useRef, useState } from 'react'
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
  settingsSchema,
  type RelabelResult,
  runDetailSchema,
  type RunDetail,
  type Score,
  traceSchema,
} from '../api/schema'
import { withSource } from '../api/source'
import { useResource } from '../api/useResource'
import { TraceChart } from '../charts/TraceChart'
import { Loaded } from '../components/Loaded'
import { Stat } from '../components/Stat'
import { RunStatus } from '../components/Status'
import { ZMeter } from '../components/ZMeter'
import {
  describeCatch, describeDepthLoss, describeFault, formatChannelName, formatFaultKind, formatLabel, formatMicrons, formatScore,
  formatSeconds, formatValue,
} from '../format'
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
  return <Loaded resource={run}>{(detail) => <RunDetails run={detail} onRelabeled={reload} />}</Loaded>
}

function RunDetails({ run, onRelabeled }: { run: RunDetail; onRelabeled: () => void }) {
  const [params] = useSearchParams()
  const selected = run.channels.find((channel) => channel.channel === params.get('channel')) ?? run.channels[0]
  const { assessment, baseline } = run
  const [settings] = useResource('/api/settings', settingsSchema)
  // until the settings arrive the buttons wait; if they never do, the server still refuses a read-only relabel
  const readOnly = settings.kind === 'ready' ? settings.data.readOnly : settings.kind === 'loading'
  // the 89-point set comes first when the wafer is in both
  const measured = run.measuredDepth[0]
  return (
    <>
      <title>{`${run.key} · ChamberWatch`}</title>
      <header className="page-head">
        <p className="breadcrumb">
          <Link to={withSource('/', run.source)}>Runs</Link>
          <span aria-hidden="true"> / </span>
          <Link to={withSource(`/?lot=${run.lotId}`, run.source)}>Lot {run.lotNo}</Link>
          <span aria-hidden="true"> / </span>
          Wafer {run.positionInLot}
        </p>
        <h1 className="key">{run.key}</h1>
        <RunStatus alignment={run.alignment.kind === 'failed' ? 'FAILED' : run.alignment.status} score={assessment} good={run.good} />
        <p className="head-links">
          {run.source === 'PUBLIC' && <Link to={`/runs/${run.id}/wafer`}>Measured depth</Link>}
          <Link to={`/lots/${run.lotId}`}>{`Lot ${run.lotNo} drift`}</Link>
        </p>
      </header>
      {assessment === null
        ? <p className="status-line">This run has no score under the current baseline.</p>
        : (
          <dl className="stats wide">
            <Stat label="Limit flags" value={assessment.limitFlags} detail="Excursions held past the limit" />
            <Stat
              label="Run-level deviations"
              value={assessment.deviationFlags}
              detail={baseline === null ? undefined : `Phase statistics past z ${formatScore(baseline.runZ)}`}
            />
            <Stat label="Stuck holds" value={assessment.stuckFlags} detail="One value held longer than any good run held it" />
            <Stat
              label="Persistent z"
              value={formatScore(assessment.persistentZ)}
              detail={baseline === null ? undefined : `Limit ${formatScore(baseline.k)} held for ${baseline.n} samples`}
            />
            <Stat
              label="First channel"
              value={assessment.firstChannel === null ? 'None' : formatChannelName(assessment.firstChannel)}
              compact
              detail={assessment.firstTimeS === null ? undefined : `First departure at ${formatSeconds(assessment.firstTimeS)}`}
            />
            {measured !== undefined && (
              <Stat label="Measured depth" value={formatMicrons(measured.meanDepthUm)} detail={describeDepthLoss(measured)} />
            )}
          </dl>
        )}
      <div className="run-layout">
        <div className="stack">
          {run.injectedFault !== null && (
            <InjectedFaultPanel fault={run.injectedFault} assessment={assessment} scoredChannels={run.channels} />
          )}
          <section className="panel" aria-labelledby="channels-title">
            <h2 id="channels-title">Channels by rank</h2>
            <ChannelsTable channels={run.channels} selected={selected} k={baseline?.k ?? null} />
          </section>
          <RelabelPanel runId={run.id} label={run.label} readOnly={readOnly} onRelabeled={onRelabeled} />
          <section className="panel" aria-labelledby="alignment-title">
            <h2 id="alignment-title">Alignment</h2>
            <AlignmentFacts alignment={run.alignment} />
          </section>
        </div>
        {selected === undefined
          ? <section className="panel"><p className="status-line">No channel of this run was scored.</p></section>
          // a relabel's refit moves the band, so a new baseline mounts the chart afresh and fetches its trace again
          : <ChannelPanel key={run.baseline?.id ?? 0} runId={run.id} channel={selected} />}
      </div>
    </>
  )
}

function ChannelsTable({ channels, selected, k }: { channels: readonly Channel[]; selected: Channel | undefined; k: number | null }) {
  if (channels.length === 0) {
    return <p className="status-line">None.</p>
  }
  return (
    <div className="table-wrap">
      <table className="compact">
        <thead>
          <tr>
            <th scope="col" className="num">Rank</th>
            <th scope="col">Channel</th>
            <th scope="col">Persistent z</th>
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
                {channel.deviation && <span className="tag">Deviates</span>}
                {channel.holds.length > 0 && <span className="tag">Stuck</span>}
              </td>
              <td>{k === null ? formatScore(channel.persistentZ) : <ZMeter z={channel.persistentZ} k={k} />}</td>
              <td className="num">{channel.excursions.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChannelPanel({ runId, channel }: { runId: number; channel: Channel }) {
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

  return (
    <section className="panel" aria-labelledby="trace-title">
      <header className="panel-head">
        <h2 id="trace-title">{formatChannelName(channel.channel)}</h2>
        <div className="segmented" role="group" aria-label="Part of the record shown">
          <button type="button" aria-pressed={sameView(view, ETCH)} onClick={() => show(ETCH)}>Etch</button>
          {zoom !== null && (
            <button type="button" aria-pressed={sameView(view, zoom)} onClick={() => show(zoom)}>
              {`Cycles ${zoom.from} to ${zoom.to}`}
            </button>
          )}
          <button type="button" aria-pressed={view.kind === 'record'} onClick={() => show({ kind: 'record' })}>
            Whole record
          </button>
        </div>
      </header>
      <Loaded resource={trace}>{(data) => <TraceChart trace={data} />}</Loaded>
      <EvidenceTable phases={channel.phases} />
      {channel.excursions.length > 0 && <ExcursionsTable excursions={channel.excursions} />}
      {channel.holds.length > 0 && <HoldsTable holds={channel.holds} longestHold={channel.longestHold} />}
    </section>
  )
}

function HoldsTable({ holds, longestHold }: { holds: readonly Hold[]; longestHold: number }) {
  return (
    <div className="table-wrap">
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

function EvidenceTable({ phases }: { phases: readonly PhaseEvidence[] }) {
  return (
    <div className="table-wrap">
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
              <td className="num">{formatScore(phase.meanZ)}</td>
              <td className="num">{formatValue(phase.sd)}</td>
              <td className="num">{formatValue(phase.goodSd)}</td>
              <td className="num">{formatScore(phase.sdZ)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ExcursionsTable({ excursions }: { excursions: readonly Excursion[] }) {
  return (
    <div className="table-wrap">
      <table>
        <caption>Excursions</caption>
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
    <section className="panel" aria-labelledby="label-title">
      <h2 id="label-title">Label</h2>
      <p className="note">
        Good runs teach the baseline. This run is labeled {formatLabel(label)}, so it {LABEL_MEANINGS[label]}
      </p>
      {readOnly
        ? <p className="note">Labels cannot be changed on this ChamberWatch, a read-only demo.</p>
        : (
          <div className="segmented" role="group" aria-label="Label">
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
    </section>
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
    + `${result.scored} runs scored, ${result.flagged} flagged.`
  return result.current ? summary : `${summary} A relabel that read newer labels finished first, and its baseline is the current one.`
}

/** What the simulator put into a synthetic run, next to what the detectors made of it. The detectors never see this. */
function InjectedFaultPanel({ fault, assessment, scoredChannels }: {
  fault: InjectedFault
  assessment: Score | null
  scoredChannels: readonly Channel[]
}) {
  const scored = scoredChannels.some((channel) => channel.channel === fault.channel)
  return (
    <section className="panel" aria-labelledby="fault-title">
      <h2 id="fault-title">Injected fault</h2>
      <p className="note">
        This is a simulated run. The simulator put one fault into it, and the detectors scored the run without knowing.
      </p>
      <dl className="facts">
        <dt>Kind</dt>
        <dd>{formatFaultKind(fault.kind)}</dd>
        <dt>Channel</dt>
        <dd>
          {scored
            ? (
                <Link to={{ search: `?channel=${encodeURIComponent(fault.channel)}` }} replace preventScrollReset>
                  {formatChannelName(fault.channel)}
                </Link>
              )
            : formatChannelName(fault.channel)}
        </dd>
        <dt>What it did</dt>
        <dd>{describeFault(fault)}</dd>
        <dt>Caught</dt>
        <dd>{describeCatch(fault, assessment)}</dd>
      </dl>
    </section>
  )
}

function AlignmentFacts({ alignment }: { alignment: Alignment }) {
  if (alignment.kind === 'failed') {
    return <p>The aligner could not place this run on the recipe grid: {alignment.note ?? 'no reason was recorded'}.</p>
  }
  const { gap } = alignment
  return (
    <dl className="facts">
      <dt>Status</dt>
      <dd>{alignment.status === 'ALIGNED' ? 'Aligned cleanly' : `Degraded${alignment.note === null ? '' : `: ${alignment.note}`}`}</dd>
      <dt>Etch</dt>
      <dd>{`${formatSeconds(alignment.etchStartS)} to ${formatSeconds(alignment.etchEndS)}`}</dd>
      <dt>Cycles</dt>
      <dd>{`${alignment.c4f8Phases} C4F8 phases, last cycle ${alignment.lastCycle}`}</dd>
      <dt>Cycle 1</dt>
      <dd>{alignment.cycle1Sf6 ? 'Starts with SF6' : 'Starts with C4F8'}</dd>
      <dt>Phase onsets</dt>
      <dd>{`${alignment.onsetsDetected} found, ${alignment.onsetsPredicted} predicted`}</dd>
      <dt>Largest gap</dt>
      <dd>
        {gap === null
          ? 'None'
          : `${formatSeconds(gap.lengthS)} at ${formatSeconds(gap.startS)}, ${gap.insideEtch ? 'inside' : 'outside'} the etch`}
      </dd>
      {alignment.irregularCycles.length > 0 && (
        <>
          <dt>Irregular cycles</dt>
          <dd>{alignment.irregularCycles.join(', ')}</dd>
        </>
      )}
    </dl>
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
