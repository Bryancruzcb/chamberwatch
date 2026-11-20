import type { DriftChannel, DriftState, Phase, RunRow } from './api/schema'
import { describeWafers, runState } from './summary'

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
  const out = runs.filter((run) => runState(run) === 'out').map((run) => run.positionInLot).sort((a, b) => a - b)
  const wafers = out.length === 0
    ? `None of its ${runs.length} wafers is out of range.`
    : `${out.length} of ${runs.length} wafers are out of range: ${describeWafers(out)}.`
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
