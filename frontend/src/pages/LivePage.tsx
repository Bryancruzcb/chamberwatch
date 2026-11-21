import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ApiError, deleteJson, postJson } from '../api/client'
import { type LiveSession, liveSessionSchema, settingsSchema } from '../api/schema'
import { useResource } from '../api/useResource'
import { Figure } from '../components/Figure'
import { Stat } from '../components/Stat'
import { AnswerSkeleton, ErrorState } from '../components/States'
import { formatChannelName, formatCount, formatFaultKind, formatSeconds, MISSING, tieUnits } from '../format'
import { liveAnswer, notesReadOnly, READ_ONLY, type ReadOnly, showsHowToStart } from '../live'

/** How long the page waits after each answer before it asks the server again. One tick of the recipe is 0.2 s. */
const POLL_MS = 500

/**
 * A wafer being etched right now by the chamber simulator, and what ChamberWatch made of it when it finished.
 *
 * The page holds no copy of the run: everything it shows is derived from the session the server reports, which it
 * re-reads while a run is streaming and once more when it stops.
 */
export function LivePage() {
  const [session, reload] = useResource('/api/live/session', liveSessionSchema)
  const [settings] = useResource('/api/settings', settingsSchema)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const recording = session.kind === 'ready' && session.data.recording
  const refreshing = session.kind === 'ready' && session.refreshing

  // ask again only once the last answer is in: a new request cancels the one in flight, so a clock that ticked faster
  // than the server answers would cancel every answer and leave the page on its first reading
  useEffect(() => {
    if (!recording || refreshing) {
      return undefined
    }
    const timer = setTimeout(reload, POLL_MS)
    return () => clearTimeout(timer)
  }, [recording, refreshing, reload])

  const act = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      reload()
    }
    catch (error: unknown) {
      setProblem(error instanceof ApiError ? error.message : String(error))
    }
    finally {
      setBusy(false)
    }
  }, [reload])

  const live = session.kind === 'ready' ? session.data : null
  const readOnly: ReadOnly = settings.kind === 'loading' ? 'unknown' : settings.kind === 'ready' && settings.data.readOnly
  const answer = live === null ? null : liveAnswer(live, readOnly)
  // the instructions are the page's one next step when nothing has happened yet; a read-only instance cannot use them
  const howOpen = live !== null && showsHowToStart(live, readOnly)
  const title = session.kind === 'error' ? 'The live session did not load.' : answer?.title ?? null
  return (
    <div className="sheet">
      <title>Live · ChamberWatch</title>
      <header className="answer">
        {/* only the title is announced: it changes a few times a run, while the lead's clock changes on every poll */}
        <p className="visually-hidden" role="status">{title ?? ''}</p>
        {session.kind === 'error'
          ? <h1>{title}</h1>
          : answer === null
            ? <AnswerSkeleton name="Live chamber" lead={false} />
            : (
                <>
                  <h1>{tieUnits(answer.title)}</h1>
                  {answer.lead !== null && <p className="answer-next">{tieUnits(answer.lead)}</p>}
                </>
              )}
        <details className="how live-how" open={howOpen}>
          <summary>How to start the chamber simulator</summary>
          <p>
            The chamber simulator in <code>chamber-sim/</code> etches a wafer and streams what its 31 channels read,
            one frame every 0.2 s. ChamberWatch records the stream and, when the run ends, aligns, stores and scores
            it exactly as it does a wafer from the dataset. Start it with{' '}
            <code>chamber-sim --port=5610 --rate=60</code>, or <code>--fault=random</code> to give it something to
            find. A baseline learns from the first three wafers of each lot, so stream wafers 1 to 3 of ten lots before
            a faulted one: that is the 30 good runs the public baseline has, and fewer give bands too narrow to trust.
          </p>
        </details>
      </header>
      <Figure id="live" title="The chamber now" busy={session.kind === 'loading'}>
        {session.kind === 'loading' && <span className="skel skel-stats" aria-hidden="true" />}
        {session.kind === 'error' && <ErrorState title="Could not reach the chamber" message={session.error.message} onRetry={reload} />}
        {live !== null && (
          <>
            <dl className="stats">
              <Stat label="Wafer" value={live.run ?? MISSING} compact detail={live.recording ? 'streaming' : 'idle'} />
              <Stat label="Step" value={live.state ?? MISSING} compact detail={`Cycle ${live.cycle} of 100`} />
              <Stat label="Samples" value={formatCount(live.samples)} detail={formatSeconds(live.timeS)} />
            </dl>
            {readOnly === true
              ? notesReadOnly(live, readOnly) && <p className="figure-note live-note">{READ_ONLY}</p>
              : (
                  <div className="actions" role="group" aria-label="Live recording">
                    <button
                      type="button"
                      className="button"
                      disabled={busy || live.recording || readOnly === 'unknown'}
                      onClick={() => void act(() => postJson('/api/live/start', { host: '127.0.0.1', port: 5610 }, liveSessionSchema))}
                    >
                      Record from 127.0.0.1:5610
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy || !live.recording}
                      onClick={() => void act(() => postJson('/api/live/inject', {
                        kind: 'GAS_FLOW_STUCK_LOW',
                        channel: 'Gas5Flow',
                        startS: live.timeS + 2,
                        magnitude: 0.36,
                      }, liveSessionSchema))}
                    >
                      Plant a fault: cut Gas 5 flow to 36%
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy || !live.recording}
                      onClick={() => void act(() => deleteJson('/api/live/session', liveSessionSchema))}
                    >
                      Stop recording
                    </button>
                  </div>
                )}
            {problem !== null && <p role="alert" className="state">{problem}</p>}
          </>
        )}
      </Figure>
      {live !== null && <Outcome live={live} />}
    </div>
  )
}

/** What the last recording came to: the run it stored, or why it stopped without one. */
function Outcome({ live }: { live: LiveSession }) {
  if (live.failure !== null) {
    return (
      <Figure id="outcome" title="The last recording stopped" numbered={false}>
        <p role="alert" className="state">{live.failure}</p>
      </Figure>
    )
  }
  if (live.stored === null) {
    return null
  }
  const stored = live.stored
  return (
    <Figure
      id="outcome"
      title="The last wafer it recorded"
      answer={<>It is a run like any other now: <Link to={`/runs/${stored.runId}`}>open its page</Link> to see what the detectors made of it.</>}
    >
      <dl className="stats">
        <Stat label="Run" value={stored.run} compact detail={`${stored.reason} after ${formatCount(stored.samples)} samples`} />
        <Stat label="Alignment" value={stored.alignment ?? MISSING} compact />
        <Stat
          label="Fault put in"
          value={stored.faultKind === null ? 'None' : formatFaultKind(stored.faultKind)}
          compact
          detail={stored.faultChannel === null ? 'a clean wafer' : formatChannelName(stored.faultChannel)}
        />
      </dl>
    </Figure>
  )
}
