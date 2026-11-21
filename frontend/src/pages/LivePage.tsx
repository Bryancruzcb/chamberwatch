import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ApiError, deleteJson, postJson } from '../api/client'
import { type LiveSession, liveSessionSchema, settingsSchema } from '../api/schema'
import { useResource } from '../api/useResource'
import { Figure } from '../components/Figure'
import { Stat } from '../components/Stat'
import { AnswerSkeleton, ErrorState } from '../components/States'
import { formatChannelName, formatCount, formatFaultKind, formatSeconds, MISSING, tieUnits } from '../format'
import { liveAnswer, showsHowToStart } from '../live'

/** How often the page asks the server what the chamber is doing. One tick of the recipe is 0.2 s. */
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

  useEffect(() => {
    if (!recording) {
      return undefined
    }
    const timer = setInterval(reload, POLL_MS)
    return () => clearInterval(timer)
  }, [recording, reload])

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
  const answer = live === null ? null : liveAnswer(live)
  // the instructions are the page's one next step when nothing has happened yet; a read-only instance cannot use them
  const howOpen = live !== null && settings.kind !== 'loading' && showsHowToStart(live, settings.kind === 'ready' && settings.data.readOnly)
  return (
    <div className="sheet">
      <title>Live · ChamberWatch</title>
      <header className="answer" aria-live="polite">
        {session.kind === 'error'
          ? <h1>The live session did not load.</h1>
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
            {settings.kind === 'ready' && settings.data.readOnly
              ? <p className="figure-note live-note">This ChamberWatch is read-only, so it does not record live runs.</p>
              : (
                  <div className="actions" role="group" aria-label="Live recording">
                    <button
                      type="button"
                      className="button"
                      disabled={busy || live.recording || settings.kind === 'loading'}
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
