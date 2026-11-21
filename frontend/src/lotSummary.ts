import type { DriftChannel, DriftState, Phase, RunRow } from './api/schema'
import { describeWafers, listWords, runState } from './summary'

// What a lot's page says at the top, worked out from the lot's runs and its drift answer. Only calculations.

/** The drift verdicts in the order a reader should meet them: out first, then heading out, then the quiet ones. */
export const DRIFT_ORDER: readonly DriftState[] = ['OUT_OF_BAND', 'WILL_EXIT', 'STAYS_IN', 'NO_TREND', 'INSUFFICIENT_RUNS']

export interface DriftCount {
  readonly state: DriftState
  readonly count: number
}

/** How many channels end the lot in each drift verdict, in reading order, leaving out the verdicts no channel has. */
export function driftCounts(channels: readonly DriftChannel[]): DriftCount[] {
  return DRIFT_ORDER.map((state) => ({ state, count: channels.filter((channel) => channel.state === state).length }))
    .filter((entry) => entry.count > 0)
}

/**
 * The lot's answer: which of its wafers are out of range, and how many channels' phase mean has left the band or is
 * heading out by the last wafer. Facts only; the page shows where they come from.
 */
export function describeLot({ runs, channels, phase }: { runs: readonly RunRow[]; channels: readonly DriftChannel[]; phase: Phase }): string {
  const wafers = describeLotWafers(runs)
  if (channels.length === 0) {
    return `${wafers} No channel has a good-run band for this phase yet.`
  }
  const outside = channels.filter((channel) => channel.state === 'OUT_OF_BAND').length
  const leaving = channels.filter((channel) => channel.state === 'WILL_EXIT').length
  const channelWord = (count: number) => (count === 1 ? '1 channel' : `${count} channels`)
  if (outside === 0 && leaving === 0) {
    return `${wafers} No channel's ${phase} mean has left the band or is heading out.`
  }
  if (outside === 0) {
    return `${wafers} No channel's ${phase} mean is outside the band yet; ${channelWord(leaving)} ${leaving === 1 ? 'is' : 'are'} heading out.`
  }
  const heading = leaving === 0 ? 'none is heading out' : `${leaving} more ${leaving === 1 ? 'is' : 'are'} heading out`
  return `${wafers} By the last wafer, the ${phase} mean of ${channelWord(outside)} is outside the band, and ${heading}.`
}

/**
 * Which of a lot's wafers are out of range. A wafer that was not scored, or could not be aligned, is not in range, so
 * a lot with any of those says how the rest divide, and a lot nobody has scored says so rather than "none out".
 */
export function describeLotWafers(runs: readonly RunRow[]): string {
  const states = runs.map((run) => runState(run))
  const count = (state: (typeof states)[number]) => states.filter((entry) => entry === state).length
  const total = runs.length
  const inRange = count('in')
  const unscored = count('unscored')
  const failed = count('failed')
  const out = runs.filter((_, index) => states[index] === 'out').map((run) => run.positionInLot).sort((a, b) => a - b)
  if (total === 1) {
    return `Its one wafer ${out.length === 1 ? 'is out of range' : inRange === 1 ? 'is in range' : failed === 1 ? 'could not be aligned' : 'has not been scored yet'}.`
  }
  const rest = listWords([
    ...(inRange > 0 ? [`${inRange} ${inRange === 1 ? 'is' : 'are'} in range`] : []),
    ...(unscored > 0 ? [`${unscored} ${unscored === 1 ? 'was' : 'were'} not scored`] : []),
    ...(failed > 0 ? [`${failed} could not be aligned`] : []),
  ])
  if (out.length === 0) {
    if (unscored === total) {
      return `None of its ${total} wafers has been scored yet.`
    }
    return inRange === total ? `None of its ${total} wafers is out of range.` : `None of its ${total} wafers is out of range: ${rest}.`
  }
  const lead = `${out.length} of ${total} wafers ${out.length === 1 ? 'is' : 'are'} out of range: ${describeWafers(out)}.`
  return out.length + inRange === total ? lead : `${lead} Of the rest, ${rest}.`
}
