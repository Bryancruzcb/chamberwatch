import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ApiError, deleteJson, postJson } from '../api/client'
import { type LiveSession, liveSessionSchema, settingsSchema } from '../api/schema'
import { useResource } from '../api/useResource'
import { Loaded } from '../components/Loaded'
import { Stat } from '../components/Stat'
import { formatChannelName, formatFaultKind, formatScore, formatSeconds, MISSING } from '../format'

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

  return (
    <>
      <header className="page-head">
        <h1>Live chamber</h1>
        <p className="note">
          The chamber simulator in <code>chamber-sim/</code> etches a wafer and streams what its 31 channels read,
          one frame every 0.2 s. ChamberWatch records the stream and, when the run ends, aligns, stores and scores
          it exactly as it does a wafer from the dataset. Start it with{' '}
          <code>chamber-sim --port=5610 --rate=50</code>, or <code>--fault=random</code> to give it something to
          find. Stream three clean wafers before a faulted one: the first wafer is the only good run its baseline
          has, so nothing can depart from anything yet.
        </p>
      </header>
      <Loaded resource={session}>
        {(live) => (
          <Loaded resource={settings}>
            {(allowed) => (
              <>
                <section className="panel" aria-labelledby="live-title">
                  <h2 id="live-title">{live.recording ? 'Etching now' : 'Nothing is being etched'}</h2>
                  <dl className="stats">
                    <Stat label="Wafer" value={live.run ?? MISSING} compact detail={live.recording ? 'streaming' : 'idle'} />
                    <Stat label="Step" value={live.state ?? MISSING} compact detail={`Cycle ${live.cycle} of 100`} />
                    <Stat label="Samples" value={formatScore(live.samples)} detail={formatSeconds(live.timeS)} />
                  </dl>
                  {allowed.readOnly
                    ? <p className="status-line">This ChamberWatch is read-only, so it does not record live runs.</p>
                    : (
                        <div className="segmented" role="group" aria-label="Live recording">
                          <button
                            type="button"
                            disabled={busy || live.recording}
                            onClick={() => void act(() => postJson('/api/live/start', { host: '127.0.0.1', port: 5610 }, liveSessionSchema))}
                          >
                            Record from 127.0.0.1:5610
                          </button>
                          <button
                            type="button"
                            disabled={busy || !live.recording}
                            onClick={() => void act(() => postJson('/api/live/inject', {
                              kind: 'GAS_FLOW_STUCK_LOW',
                              channel: 'Gas5Flow',
                              startS: live.timeS + 2,
                              magnitude: 0.36,
                            }, liveSessionSchema))}
                          >
                            Starve the SF6 flow
                          </button>
                          <button
                            type="button"
                            disabled={busy || !live.recording}
                            onClick={() => void act(() => deleteJson('/api/live/session', liveSessionSchema))}
                          >
                            Stop recording
                          </button>
                        </div>
                      )}
                  {problem !== null && <p role="alert" className="status-line">{problem}</p>}
                </section>
                <Outcome live={live} />
              </>
            )}
          </Loaded>
        )}
      </Loaded>
    </>
  )
}

/** What the last recording came to: the run it stored, or why it stopped without one. */
function Outcome({ live }: { live: LiveSession }) {
  if (live.failure !== null) {
    return (
      <section className="panel" aria-labelledby="outcome-title">
        <h2 id="outcome-title">The last recording stopped</h2>
        <p role="alert" className="status-line">{live.failure}</p>
      </section>
    )
  }
  if (live.stored === null) {
    return null
  }
  const stored = live.stored
  return (
    <section className="panel" aria-labelledby="outcome-title">
      <h2 id="outcome-title">The last wafer it recorded</h2>
      <dl className="stats">
        <Stat label="Run" value={stored.run} compact detail={`${stored.reason} after ${stored.samples} samples`} />
        <Stat label="Alignment" value={stored.alignment ?? MISSING} compact detail="On the recipe grid" />
        <Stat
          label="Fault put in"
          value={stored.faultKind === null ? 'None' : formatFaultKind(stored.faultKind)}
          compact
          detail={stored.faultChannel === null ? 'a clean wafer' : formatChannelName(stored.faultChannel)}
        />
      </dl>
      <p className="note">
        It is a run like any other now: <Link to={`/runs/${stored.runId}`}>open its page</Link> to see what the
        detectors made of it.
      </p>
    </section>
  )
}
