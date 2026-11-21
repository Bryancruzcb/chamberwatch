import { type Channel, isFlagged, type RunDetail, type RunRow, type Score } from './api/schema'
import { baselinePrefix } from './baseline'
import { formatChannelName, formatScore, formatShortAgainstLimit, formatShortScore } from './format'
import { type RunState, runState } from './summary'

// What the run page says about its run, and how it lays out the run's lot and channels. Only calculations: the page
// fetches, these decide.

/** A run's state, checked in the same order as the runs table: not aligned, then not scored, then the flags. */
export function runDetailState(run: Pick<RunDetail, 'alignment' | 'assessment'>): RunState {
  if (run.alignment.kind === 'failed') {
    return 'failed'
  }
  if (run.assessment === null) {
    return 'unscored'
  }
  return isFlagged(run.assessment) ? 'out' : 'in'
}

type Named = Pick<RunDetail, 'lotNo' | 'positionInLot'>

/** The page's `h1`: a sentence from the run's state, never its file name. */
export function runHeadline(run: Named & Pick<RunDetail, 'alignment' | 'assessment'>): string {
  const name = `Wafer ${run.positionInLot} of Lot ${run.lotNo}`
  const state = runDetailState(run)
  switch (state) {
    case 'out':
      return `${name} is out of range.`
    case 'in':
      return `${name} is in range.`
    case 'unscored':
      return `${name} was not scored.`
    case 'failed':
      return `${name} could not be aligned.`
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

/** The browser tab's title, lot first so a row of tabs sorts by lot. */
export function runTitle(run: Named): string {
  return `Lot ${run.lotNo}, wafer ${run.positionInLot} · ChamberWatch`
}

/** The lead under the `h1` of a run with no score, saying why it has none. */
export function describeUnscored(run: Pick<RunDetail, 'alignment' | 'baseline'>): string {
  if (run.alignment.kind === 'failed') {
    return run.alignment.note === null
      ? 'The aligner could not place it on the recipe grid, so the detectors could not score it.'
      : `The aligner could not place it on the recipe grid: ${run.alignment.note}.`
  }
  return run.baseline === null
    ? 'There is no baseline yet, so no run has a score.'
    : 'It has no score under the current baseline.'
}

/**
 * The verdict's sentence beside its big numeral. A stuck value or a phase mean or spread can put a run out of range
 * while its score stays under the limit, and then the sentence says which.
 */
export function describeVerdict(score: Score, k: number): string {
  const limit = formatScore(k)
  if (!isFlagged(score)) {
    return `In range: under the limit of ${limit}`
  }
  if (score.persistentZ > k) {
    return `Out of range: past the limit of ${limit}`
  }
  if (score.stuckFlags > 0) {
    return `Out of range: a stuck sensor, under the limit of ${limit}`
  }
  return `Out of range on a phase mean or spread, under the limit of ${limit}`
}

/** One wafer of the lot strip above the `h1`. */
export interface StripSlot {
  readonly id: number
  readonly position: number
  readonly state: RunState
  readonly good: boolean
  readonly current: boolean
  /** What the disc prints: the wafer number, or this wafer's score when it has one. */
  readonly text: string
  /** The disc's name for a screen reader, the same words the cassette map uses. */
  readonly label: string
}

export interface LotStrip {
  readonly slots: readonly StripSlot[]
  /** N when the lot's baseline runs are its first N wafers, so one bracket marks them; null to mark each one. */
  readonly baseline: number | null
}

const STATE_WORDS = {
  out: 'out of range',
  in: 'in range',
  unscored: 'not scored',
  failed: 'not aligned',
} as const satisfies Record<RunState, string>

/**
 * The lot strip: every wafer of the run's lot in position order, from the runs list, with this run taken from its own
 * answer, which is newer than the list after a relabel. The baseline rule is the Runs page's, for one lot.
 */
export function lotStrip(rows: readonly RunRow[], run: RunDetail): LotStrip {
  const here: StripSlot = slot({
    id: run.id,
    position: run.positionInLot,
    lotNo: run.lotNo,
    state: runDetailState(run),
    good: run.good,
    z: run.assessment?.persistentZ ?? null,
    current: true,
  })
  return strip([...rowSlots(rows.filter((row) => row.lotId === run.lotId && row.id !== run.id)), here])
}

/** A lot's own strip, for its page: every wafer of the lot in position order, none of them marked as this one. */
export function lotWafers(rows: readonly RunRow[], lotId: number): LotStrip {
  return strip(rowSlots(rows.filter((row) => row.lotId === lotId)))
}

function rowSlots(rows: readonly RunRow[]): StripSlot[] {
  return rows.map((row) => slot({
    id: row.id,
    position: row.positionInLot,
    lotNo: row.lotNo,
    state: runState(row),
    good: row.good,
    z: row.score?.persistentZ ?? null,
    current: false,
  }))
}

function strip(unordered: readonly StripSlot[]): LotStrip {
  const slots = [...unordered].sort((a, b) => a.position - b.position)
  return { slots, baseline: baselinePrefix([slots.map((wafer) => ({ positionInLot: wafer.position, good: wafer.good }))]) }
}

function slot({ id, position, lotNo, state, good, z, current }: {
  id: number
  position: number
  lotNo: number
  state: RunState
  good: boolean
  z: number | null
  current: boolean
}): StripSlot {
  const score = z === null ? null : formatShortScore(z)
  const label = [`Lot ${lotNo}, wafer ${position}: ${STATE_WORDS[state]}`, ...(score === null ? [] : [`how unusual ${score}`]), ...(good ? ['baseline run'] : [])]
    .join(', ')
  return { id, position, state, good, current, text: current && score !== null ? score : String(position), label }
}

/** The lineup shows this many channels by rank before the rest fold away. */
const LINEUP_SHOWN = 10

export interface LineupSplit {
  readonly shown: readonly Channel[]
  readonly hidden: readonly Channel[]
}

/**
 * The lineup's rows in the detectors' rank: the first ten, plus every channel past the limit k should more than ten
 * be, then the rest behind a button.
 */
export function splitLineup(channels: readonly Channel[], k: number): LineupSplit {
  const ranked = [...channels].sort((a, b) => a.rank - b.rank)
  const shows = (channel: Channel, index: number) => index < LINEUP_SHOWN || channel.persistentZ > k
  return {
    shown: ranked.filter(shows),
    hidden: ranked.filter((channel, index) => !shows(channel, index)),
  }
}

/** The button under the lineup: "21 more channels, all under 3.0", the bound the next whole number past the largest. */
export function describeHiddenChannels(hidden: readonly Channel[]): string {
  if (hidden.length === 0) {
    return ''
  }
  const bound = formatScore(Math.floor(Math.max(...hidden.map((channel) => channel.persistentZ))) + 1)
  return hidden.length === 1 ? `1 more channel, under ${bound}` : `${hidden.length} more channels, all under ${bound}`
}

/** The answer of a run no channel left: which channel came closest to the limit, and how close. */
export function describeClosest(channel: Channel, k: number | null): string {
  const name = formatChannelName(channel.channel)
  const score = formatShortAgainstLimit(channel.persistentZ, k)
  return k === null ? `${name} came closest, at ${score}.` : `${name} came closest to the limit of ${formatScore(k)}, at ${score}.`
}
