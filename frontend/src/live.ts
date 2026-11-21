import type { LiveSession } from './api/schema'
import { formatSeconds } from './format'
import type { Answer } from './lotSummary'

// What the Live page says at the top, from the session the server reports. Only calculations.

/** Etch cycles in the simulator's recipe. */
const CYCLES = 100

/**
 * Whether this instance records live runs, from its settings: true when it is read-only, and 'unknown' until the
 * settings arrive. A failed settings call counts as false, so the buttons stay and the server's own answer says no.
 */
export type ReadOnly = boolean | 'unknown'

/** What a read-only instance says about live runs, as the lead or as the note under the chamber. */
export const READ_ONLY = 'This ChamberWatch is read-only, so it does not record live runs.'

/** Nothing recording, nothing stored and no failure: a session that has not happened yet. */
function isIdle(session: LiveSession): boolean {
  return !session.recording && session.stored === null && session.failure === null
}

/**
 * The Live page's answer: whether a wafer is being etched now, and where it is, or what the last recording came to.
 * A recording that stopped with a failure says so first, since its run was never stored. With nothing to report, the
 * lead is the one next step: record here, or, on a read-only instance, that it does not record. Until the settings say
 * which, there is no lead, so the page never tells a reader to do what it then says cannot be done.
 */
export function liveAnswer(session: LiveSession, readOnly: ReadOnly): Answer {
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
  if (readOnly === 'unknown') {
    return { title: 'Nothing is being etched.', lead: null }
  }
  return { title: 'Nothing is being etched.', lead: readOnly ? READ_ONLY : 'Start the chamber simulator, then record from it here.' }
}

/**
 * Whether the Live page opens its instructions for starting the simulator: only when they are the one next step, on an
 * instance known to record, with nothing recording, nothing stored and no failure to read first.
 */
export function showsHowToStart(session: LiveSession, readOnly: ReadOnly): boolean {
  return readOnly === false && isIdle(session)
}

/** Whether the chamber figure says the instance is read-only: only when the lead above it has not already said so. */
export function notesReadOnly(session: LiveSession, readOnly: ReadOnly): boolean {
  return readOnly === true && !isIdle(session)
}
