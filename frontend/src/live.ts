import type { LiveSession } from './api/schema'
import { formatSeconds } from './format'
import type { Answer } from './lotSummary'

// What the Live page says at the top, from the session the server reports. Only calculations.

/** Etch cycles in the simulator's recipe. */
const CYCLES = 100

/**
 * The Live page's answer: whether a wafer is being etched now, and where it is, or what the last recording came to.
 * A recording that stopped with a failure says so first, since its run was never stored.
 */
export function liveAnswer(session: LiveSession): Answer {
  if (session.recording) {
    const where = `cycle ${session.cycle} of ${CYCLES}, ${formatSeconds(session.timeS)} in.`
    return { title: 'A wafer is being etched now.', lead: session.run === null ? `At ${where}` : `${session.run}, at ${where}` }
  }
  if (session.failure !== null) {
    return { title: 'The last recording stopped.', lead: 'It stored no run.' }
  }
  if (session.stored !== null) {
    return { title: 'Nothing is being etched.', lead: `The last wafer it recorded, ${session.stored.run}, is stored as a run.` }
  }
  return { title: 'Nothing is being etched.', lead: 'Start the chamber simulator, then record from it here.' }
}
