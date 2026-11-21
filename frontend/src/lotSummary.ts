import type { DriftChannel, DriftState, Lot, Phase, RunRow } from './api/schema'
import { formatBigScore, formatScore } from './format'
import type { GridKinds } from './grid'
import { capitalize, describeLots, describeWafers, listWords, type RunState, runState } from './summary'

// What the Lots page and a lot's page say at the top, worked out from the lot list, a lot's runs and its drift answer.
// Only calculations.

/** A page's answer: the sentence the `h1` states, and the one line under it, if any. */
export interface Answer {
  readonly title: string
  readonly lead: string | null
}

/**
 * The Lots page's answer, from the lot list of one source: which lots hold the out-of-range runs, then what the other
 * lots ran. `scored` is false when the source has no baseline, so no run has a score and "none out of range" would
 * claim more than is known. Only the runs say which, so while they load, or if they fail, a source whose lots are all
 * clean gets no answer, or one that claims nothing about scoring. Null means wait.
 */
export function lotsAnswer(lots: readonly Lot[], scored: boolean | 'loading' | 'failed'): Answer | null {
  const n = lots.length
  const first = lots[0]
  if (first === undefined) {
    return { title: 'No lots yet.', lead: null }
  }
  if (scored === false) {
    return {
      title: n === 1 ? `Lot ${first.lotNo} has not been scored yet.` : `None of the ${n} lots has been scored yet.`,
      lead: 'There is no baseline yet, so no run has a score.',
    }
  }
  const holding = lots.filter((lot) => lot.flaggedRuns > 0)
  const others = lots.filter((lot) => lot.flaggedRuns === 0)
  const out = holding.reduce((sum, lot) => sum + lot.flaggedRuns, 0)
  if (holding.length === 0 && scored === 'loading') {
    return null
  }
  if (holding.length === 0 && scored === 'failed') {
    return { title: 'No lot has an out-of-range run on record.', lead: null }
  }
  if (holding.length === 0) {
    return { title: n === 1 ? `Lot ${first.lotNo} has no out-of-range run.` : `None of the ${n} lots has an out-of-range run.`, lead: null }
  }
  const named = capitalize(describeLots(holding.map((lot) => lot.lotNo)))
  const title = out === 1
    ? `${named} holds the one out-of-range run.`
    : `${named} ${holding.length === 1 ? 'holds' : 'hold'} all ${out} out-of-range runs.`
  if (others.length === 0) {
    return { title, lead: n === 1 ? null : 'Every lot has at least one.' }
  }
  const wafers = others.reduce((sum, lot) => sum + lot.runs, 0)
  const rest = others.length === 1 ? 'The other lot ran' : `The other ${others.length} lots ran`
  return { title, lead: `${rest} ${wafers} ${wafers === 1 ? 'wafer' : 'wafers'} with none out of range.` }
}

/** A wafer position and how many lots ran a wafer there. */
export interface PositionRuns {
  readonly position: number
  readonly runs: number
}

/**
 * The positions whose average rests on fewer than half the lots of the fullest position, such as the slots only one
 * long lot reached. A position one lot short, as when one lot skipped a slot, is not thin.
 */
export function thinPositions(positions: readonly PositionRuns[]): number[] {
  const most = Math.max(0, ...positions.map((entry) => entry.runs))
  return positions.filter((entry) => entry.runs * 2 < most).map((entry) => entry.position)
}

/**
 * The answer for a by-position figure with no depth to speak of: which positions come from only a few lots, against
 * how many the others average. "Wafers 4 to 10 come from one lot; wafers 1 to 3 average 11 lots." Null when no position
 * is thin.
 */
export function describeRunsByPosition(positions: readonly PositionRuns[]): string | null {
  const thinAt = thinPositions(positions)
  const thin = positions.filter((entry) => thinAt.includes(entry.position))
  const full = positions.filter((entry) => !thinAt.includes(entry.position))
  if (thin.length === 0 || full.length === 0) {
    return null
  }
  const fewest = Math.min(...thin.map((entry) => entry.runs))
  const most = Math.max(...thin.map((entry) => entry.runs))
  const lotsWord = (count: number) => (count === 1 ? 'lot' : 'lots')
  const from = fewest === most
    ? `${fewest === 1 ? 'one' : fewest} ${lotsWord(fewest)}`
    : `${fewest} to ${most} lots each`
  const average = Math.round(full.reduce((sum, entry) => sum + entry.runs, 0) / full.length)
  const thinWords = capitalize(describeWafers(thin.map((entry) => entry.position)))
  const fullWords = describeWafers(full.map((entry) => entry.position))
  return `${thinWords} ${thin.length === 1 ? 'comes' : 'come'} from ${from}; `
    + `${fullWords} ${full.length === 1 ? 'averages' : 'average'} ${average} ${lotsWord(average)}.`
}

interface StateCounts {
  readonly total: number
  /** The positions of the out-of-range wafers, in order. */
  readonly out: readonly number[]
  readonly inRange: number
  readonly unscored: number
  readonly failed: number
}

function countStates(runs: readonly RunRow[]): StateCounts {
  const states = runs.map((run) => runState(run))
  const count = (state: RunState) => states.filter((entry) => entry === state).length
  return {
    total: runs.length,
    out: runs.filter((_, index) => states[index] === 'out').map((run) => run.positionInLot).sort((a, b) => a - b),
    inRange: count('in'),
    unscored: count('unscored'),
    failed: count('failed'),
  }
}

/**
 * A lot page's `h1`: which of its wafers are out of range, in the run page's words ("Wafer 5 of Lot 6 is out of
 * range."). A wafer that was not scored or could not be aligned is not in range, so such a lot never reads as clean.
 * "Lot 6" never breaks across lines.
 */
export function lotHeadline(lotNo: number, runs: readonly RunRow[]): string {
  const lot = `Lot ${lotNo}`
  const { total, out, inRange, unscored, failed } = countStates(runs)
  const only = runs[0]
  if (only === undefined) {
    return `${lot} has no runs yet.`
  }
  if (out.length > 0) {
    if (out.length === total && total > 1) {
      return `Every wafer of ${lot} is out of range.`
    }
    return `${capitalize(describeWafers(out))} of ${lot} ${out.length === 1 ? 'is' : 'are'} out of range.`
  }
  if (total === 1) {
    const wafer = `Wafer ${only.positionInLot} of ${lot}`
    return inRange === 1 ? `${wafer} is in range.` : failed === 1 ? `${wafer} could not be aligned.` : `${wafer} was not scored.`
  }
  if (unscored === total) {
    return `No wafer of ${lot} has been scored yet.`
  }
  return inRange === total ? `Every wafer of ${lot} is in range.` : `No wafer of ${lot} is out of range.`
}

/**
 * The line under a lot's `h1`: how the wafers that are not out of range divide when some were not scored or aligned,
 * then for how many channels the line fitted through the phase means is outside the band or heading out by the last wafer.
 */
export function lotLead({ runs, channels, phase }: { runs: readonly RunRow[]; channels: readonly DriftChannel[]; phase: Phase }): string {
  return [describeRest(runs), describeChannels(channels, phase)].filter((part) => part !== null).join(' ')
}

/** The wafers that are neither out of range nor in range, said only when there are some beside the others. */
function describeRest(runs: readonly RunRow[]): string | null {
  const { total, out, inRange, unscored, failed } = countStates(runs)
  if (total <= 1 || unscored + failed === 0 || unscored === total) {
    return null
  }
  const rest = listWords([
    ...(inRange > 0 ? [`${inRange} ${inRange === 1 ? 'is' : 'are'} in range`] : []),
    ...(unscored > 0 ? [`${unscored} ${unscored === 1 ? 'was' : 'were'} not scored`] : []),
    ...(failed > 0 ? [`${failed} could not be aligned`] : []),
  ])
  return out.length > 0 ? `Of the rest, ${rest}.` : `${capitalize(rest)}.`
}

/**
 * For how many channels the line fitted through the lot's phase means is outside the band by the last wafer, and for
 * how many more it is heading out. The verdicts judge the fitted line, not the last wafer's own mean, which can sit
 * inside the band while one faulted wafer tilts the line out of it. A channel with too few wafers was never judged.
 */
function describeChannels(channels: readonly DriftChannel[], phase: Phase): string {
  if (channels.length === 0) {
    return 'No channel has a good-run band for this phase yet.'
  }
  const count = (state: DriftState) => channels.filter((channel) => channel.state === state).length
  const outside = count('OUT_OF_BAND')
  const leaving = count('WILL_EXIT')
  const few = count('INSUFFICIENT_RUNS')
  if (few === channels.length) {
    return `Too few wafers to judge a trend in the ${phase} mean yet.`
  }
  const channelWord = (n: number) => (n === 1 ? '1 channel' : `${n} channels`)
  const line = `the line fitted through the lot's ${phase} means`
  const unjudged = few === 0 ? null : `There are too few wafers to judge ${channelWord(few)}.`
  if (outside === 0 && leaving === 0) {
    if (unjudged === null) {
      return `${capitalize(line)} is inside the band for every channel, and none is heading out.`
    }
    const judged = channels.length - few
    return `${unjudged} For the other ${judged === 1 ? 'channel' : judged}, ${line} is inside the band, and none is heading out.`
  }
  const verdict = outside === 0
    ? `${capitalize(line)} is heading out of the band for ${channelWord(leaving)}, and is outside it for none yet.`
    : `By the last wafer, ${line} is outside the band for ${channelWord(outside)}, and ${
      leaving === 0 ? 'none is heading out' : `${leaving} more ${leaving === 1 ? 'is' : 'are'} heading out`}.`
  return unjudged === null ? verdict : `${verdict} ${unjudged}`
}

/**
 * Where the line fitted through the lot's wafers sits at the last wafer, in the band's standard deviations from its
 * centre: the number the channel's verdict judges. Null before a line can be fitted, or for a band of no width.
 */
export function fittedZ(channel: DriftChannel): number | null {
  const fit = channel.points.at(-1)?.fit ?? null
  if (fit === null || channel.bandSd === 0) {
    return null
  }
  return (fit.fitted - channel.bandMean) / channel.bandSd
}

/** The verdicts a lot's channel table always shows: a trend that is out, leaving, or staying in the band. */
const SHOWN_VERDICTS: readonly DriftState[] = ['OUT_OF_BAND', 'WILL_EXIT', 'STAYS_IN']

/**
 * A lot's channels split for its table, keeping their rank order: the ones with a trend verdict and the picked one show,
 * and the ones with no trend or too few wafers fold behind a button.
 */
export function splitDriftChannels(channels: readonly DriftChannel[], picked: DriftChannel | undefined): {
  shown: DriftChannel[]
  hidden: DriftChannel[]
} {
  const shows = (channel: DriftChannel) => channel === picked || SHOWN_VERDICTS.includes(channel.state)
  return { shown: channels.filter(shows), hidden: channels.filter((channel) => !shows(channel)) }
}

/**
 * The button over the folded channels, saying what they are: "17 more channels, no trend" while they are folded, and
 * "Hide the 17 channels with no trend" while they show.
 */
export function describeHiddenDriftChannels(hidden: readonly DriftChannel[], open = false): string {
  if (hidden.length === 0) {
    return ''
  }
  const few = hidden.filter((channel) => channel.state === 'INSUFFICIENT_RUNS').length
  const quiet = hidden.length - few
  if (open) {
    const what = few === 0 ? 'no trend' : quiet === 0 ? 'too few wafers to judge' : 'no trend or too few wafers to judge'
    return hidden.length === 1 ? `Hide the channel with ${what}` : `Hide the ${hidden.length} channels with ${what}`
  }
  const more = hidden.length === 1 ? '1 more channel' : `${hidden.length} more channels`
  if (few === 0) {
    return `${more}, no trend`
  }
  return quiet === 0 ? `${more}, too few wafers to judge` : `${more}: ${quiet} no trend, ${few} too few wafers to judge`
}

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

/** Whether a drift verdict warns: past the band, or heading out of it. Those words take the warning color. */
export function driftWarns(state: DriftState): boolean {
  return state === 'OUT_OF_BAND' || state === 'WILL_EXIT'
}

/**
 * The key under the lot table's small discs, naming only the marks it holds: "Filled: out of range. Ring: in range.
 * Dash: not run. Wafers 1 to 3, left of the dotted line, are the baseline runs." The dotted line is drawn at every width,
 * where the bracket over the column is not.
 */
export function describeWaferKey(kinds: GridKinds, baseline: number | null): string {
  return [
    kinds.outOfRange ? 'Filled: out of range.' : null,
    kinds.inRange ? 'Ring: in range.' : null,
    kinds.unmeasured ? 'Dashed ring: not scored or not aligned.' : null,
    kinds.missing ? 'Dash: not run.' : null,
    !kinds.baseline
      ? null
      : baseline !== null
        ? `${capitalize(describeWafers(Array.from({ length: baseline }, (_, index) => index + 1)))}, left of the dotted line, ${baseline === 1 ? 'is the baseline run' : 'are the baseline runs'}.`
        : 'A centre dot marks a baseline run.',
  ].filter((part) => part !== null).join(' ')
}

/**
 * The answer over a lot's score lines: its highest score and which wafer, then the scale every line shares. Null when
 * no wafer of the lot has a score.
 */
export function describeLotScores(runs: readonly RunRow[], k: number, end: number, past: number): string | null {
  const scored = runs.flatMap((run) => (run.score === null ? [] : [{ position: run.positionInLot, z: run.score.persistentZ }]))
  const top = scored.reduce<(typeof scored)[number] | null>((best, entry) => (best === null || entry.z > best.z ? entry : best), null)
  if (top === null) {
    return null
  }
  return `The highest score is ${formatBigScore(top.z)}, wafer ${top.position}. Each line runs from 0 to ${end}; the tick is the limit, ${formatScore(k)}`
    + `${past === 0 ? '' : `, and ${past} ${past === 1 ? 'score runs' : 'scores run'} past its end`}.`
}
