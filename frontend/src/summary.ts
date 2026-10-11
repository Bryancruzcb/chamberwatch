import { isFlagged, type Lot, type LotDrift, type RunRow } from './api/schema'
import { formatChannelName } from './format'

// What the runs page says at the top, worked out from the API's answers. Only calculations: no fetching, no clock.
// The answer states facts, never advice: which runs are out of range, which lot has the most of them (named only
// when one lot has more than every other), and which channel each out-of-range run names first.

/** One status per run, checked in the same order as the run page's verdict. */
export type RunState = 'out' | 'in' | 'failed' | 'unscored'

export function runState(run: RunRow): RunState {
  if (run.alignment === 'FAILED') {
    return 'failed'
  }
  if (run.score === null) {
    return 'unscored'
  }
  return isFlagged(run.score) ? 'out' : 'in'
}

/** The runs of one lot, by wafer position. `lot` is null when the lot list did not include it. */
export interface LotRuns {
  readonly lotId: number
  readonly lotNo: number
  readonly lot: Lot | null
  readonly runs: readonly RunRow[]
  readonly out: readonly RunRow[]
  /** The largest persistent z among the lot's out-of-range runs, 0 when it has none. */
  readonly maxZ: number
}

/** How many out-of-range runs name a channel first. `channel` is null for runs that name none. */
export interface ChannelCount {
  readonly channel: string | null
  readonly count: number
}

export interface RunsSummary {
  readonly runs: readonly RunRow[]
  readonly out: readonly RunRow[]
  readonly inRange: number
  readonly unscored: number
  readonly failed: number
  /** Every lot that has runs, by lot number. */
  readonly lots: readonly LotRuns[]
  /** The lots with out-of-range runs: most first, then the most unusual. */
  readonly attention: readonly LotRuns[]
  /** The lots with no out-of-range run, by lot number. */
  readonly clean: readonly LotRuns[]
  readonly firstChannels: readonly ChannelCount[]
}

export function summarize(runs: readonly RunRow[], lots: readonly Lot[]): RunsSummary {
  const states = runs.map((run) => runState(run))
  const out = runs.filter((_, index) => states[index] === 'out')
  const groups = groupByLot(runs, lots)
  return {
    runs,
    out,
    inRange: states.filter((state) => state === 'in').length,
    unscored: states.filter((state) => state === 'unscored').length,
    failed: states.filter((state) => state === 'failed').length,
    lots: groups,
    attention: groups.filter((group) => group.out.length > 0)
      .sort((a, b) => b.out.length - a.out.length || b.maxZ - a.maxZ || a.lotNo - b.lotNo),
    clean: groups.filter((group) => group.out.length === 0),
    firstChannels: countFirstChannels(out),
  }
}

function groupByLot(runs: readonly RunRow[], lots: readonly Lot[]): LotRuns[] {
  const byLot = new Map<number, RunRow[]>()
  for (const run of runs) {
    byLot.set(run.lotId, [...(byLot.get(run.lotId) ?? []), run])
  }
  return [...byLot.entries()]
    .map(([lotId, lotRuns]): LotRuns => {
      const ordered = [...lotRuns].sort((a, b) => a.positionInLot - b.positionInLot || a.id - b.id)
      const out = ordered.filter((run) => runState(run) === 'out')
      return {
        lotId,
        lotNo: ordered[0]?.lotNo ?? 0,
        lot: lots.find((lot) => lot.id === lotId) ?? null,
        runs: ordered,
        out,
        maxZ: out.reduce((max, run) => Math.max(max, run.score?.persistentZ ?? 0), 0),
      }
    })
    .sort((a, b) => a.lotNo - b.lotNo || a.lotId - b.lotId)
}

function countFirstChannels(out: readonly RunRow[]): ChannelCount[] {
  const counts = new Map<string | null, number>()
  for (const run of out) {
    const channel = run.score?.firstChannel ?? null
    counts.set(channel, (counts.get(channel) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([channel, count]) => ({ channel, count }))
    .sort((a, b) => b.count - a.count || channelOrder(a.channel, b.channel))
}

function channelOrder(a: string | null, b: string | null): number {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1
  }
  return formatChannelName(a).localeCompare(formatChannelName(b))
}

/** Where to start: one lot with more out-of-range runs than any other, or the lots that tie for the most. */
export type Start =
  | { readonly kind: 'one'; readonly lotNo: number; readonly wafers: readonly number[]; readonly of: number }
  | { readonly kind: 'tie'; readonly lotNos: readonly number[]; readonly count: number }

export interface Headline {
  /** The one sentence at the top. */
  readonly lead: string
  readonly start: Start | null
  /** The words to set in bold at the start of the start sentence, empty for a tie. */
  readonly startStrong: string
  /** The rest of the start sentence. */
  readonly startText: string
  /** Which channel left its range first, counted over the out-of-range runs. */
  readonly channelText: string | null
  /** For a page with nothing out of range: how the runs split, when not all of them are in range. */
  readonly detail: string | null
}

export function headline(summary: RunsSummary): Headline {
  const total = summary.runs.length
  const outCount = summary.out.length
  if (total === 0) {
    return { lead: 'No runs stored for this source yet.', start: null, startStrong: '', startText: '', channelText: null, detail: null }
  }
  if (outCount === 0) {
    return summary.inRange === total
      ? { lead: `All ${total} runs are in range.`, start: null, startStrong: '', startText: '', channelText: null, detail: null }
      : {
          lead: `None of the ${total} runs are out of range.`,
          start: null,
          startStrong: '',
          startText: '',
          channelText: null,
          detail: describeSplit(summary),
        }
  }
  const start = startOf(summary.attention)
  const lots = describeLots(summary.attention.map((group) => group.lotNo))
  return {
    lead: `${outCount} of ${total} runs are out of range, all in ${lots}.`,
    start,
    ...startSentence(start),
    channelText: describeFirstChannels(summary.firstChannels, outCount),
    detail: null,
  }
}

function startOf(attention: readonly LotRuns[]): Start {
  const most = Math.max(...attention.map((group) => group.out.length))
  const tied = attention.filter((group) => group.out.length === most)
  const [only] = tied
  if (tied.length === 1 && only !== undefined) {
    return { kind: 'one', lotNo: only.lotNo, wafers: only.out.map((run) => run.positionInLot), of: only.runs.length }
  }
  return { kind: 'tie', lotNos: tied.map((group) => group.lotNo).sort((a, b) => a - b), count: most }
}

function startSentence(start: Start): { startStrong: string; startText: string } {
  if (start.kind === 'one') {
    return {
      startStrong: `Start with Lot ${start.lotNo}`,
      startText: `, which has the most out-of-range runs: ${describeWafers(start.wafers)} of ${start.of}.`,
    }
  }
  return { startStrong: '', startText: `Lots ${listWords(start.lotNos.map(String))} tie for the most out-of-range runs, ${start.count} each.` }
}

function describeSplit(summary: RunsSummary): string {
  const parts = [
    summary.inRange === 0 ? null : `${summary.inRange} ${summary.inRange === 1 ? 'is' : 'are'} in range`,
    summary.unscored === 0 ? null : `${summary.unscored} ${summary.unscored === 1 ? 'was' : 'were'} not scored`,
    summary.failed === 0 ? null : `${summary.failed} could not be aligned`,
  ].filter((part) => part !== null)
  return `Of those, ${listWords(parts)}.`
}

/**
 * "First channel to leave its range: Platen RF load cap in 10 of the 15 runs and Platen RF tuning cap in 5." Channels
 * named first by a single run are counted together once there are two or more of them.
 */
export function describeFirstChannels(counts: readonly ChannelCount[], outCount: number): string {
  const named = counts.filter((entry): entry is { channel: string; count: number } => entry.channel !== null)
  const unnamed = counts.find((entry) => entry.channel === null)?.count ?? 0
  const none = unnamed === 0 ? '' : ` ${unnamed} ${unnamed === 1 ? 'run names' : 'runs name'} no first channel.`
  const [top, ...rest] = named
  if (top === undefined) {
    return `No out-of-range run names a first channel.`
  }
  const several = rest.filter((entry) => entry.count > 1).map((entry) => `${formatChannelName(entry.channel)} in ${entry.count}`)
  const singles = rest.filter((entry) => entry.count === 1)
  const [single] = singles
  const tail = singles.length === 0 || single === undefined
    ? []
    : singles.length === 1 ? [`${formatChannelName(single.channel)} in 1`] : [`${singles.length} other channels in 1 each`]
  const first = `${formatChannelName(top.channel)} in ${top.count} of the ${outCount} ${outCount === 1 ? 'run' : 'runs'}`
  return `First channel to leave its range: ${listWords([first, ...several, ...tail])}.${none}`
}

/** "a", "a and b", "a, b and c". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) {
    return words[0] ?? ''
  }
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** Numbers in order, three or more in a row written as a span: [1, 2, 3, 5] is "1 to 3 and 5". */
function describeNumbers(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  const spans: number[][] = []
  for (const value of sorted) {
    const last = spans.at(-1)
    if (last !== undefined && last.at(-1) === value - 1) {
      last.push(value)
    }
    else {
      spans.push([value])
    }
  }
  const words = spans.flatMap((span) => (span.length >= 3 ? [`${span[0]} to ${span.at(-1)}`] : span.map(String)))
  return listWords(words)
}

/** "lot 8", "lots 6 to 9", "lots 6, 7 and 901", "lots 1 to 5 and 7 to 10". */
export function describeLots(lotNos: readonly number[]): string {
  return `${new Set(lotNos).size === 1 ? 'lot' : 'lots'} ${describeNumbers(lotNos)}`
}

/** "wafer 7", "wafers 4 to 10", "wafers 5 to 7, 9 and 10". */
export function describeWafers(positions: readonly number[]): string {
  return `${new Set(positions).size === 1 ? 'wafer' : 'wafers'} ${describeNumbers(positions)}`
}

export type TableOrder = 'out' | 'lot' | 'z'

/** The runs table's orders: out of range first, by lot and wafer, or most unusual first. Ties keep lot order. */
export function sortRuns(runs: readonly RunRow[], order: TableOrder): RunRow[] {
  const byLot = (a: RunRow, b: RunRow) => a.lotNo - b.lotNo || a.positionInLot - b.positionInLot || a.id - b.id
  const sorted = [...runs]
  switch (order) {
    case 'out':
      return sorted.sort((a, b) => Number(runState(b) === 'out') - Number(runState(a) === 'out') || byLot(a, b))
    case 'lot':
      return sorted.sort(byLot)
    case 'z':
      return sorted.sort((a, b) => (b.score?.persistentZ ?? -1) - (a.score?.persistentZ ?? -1) || byLot(a, b))
    default: {
      const exhaustive: never = order
      return exhaustive
    }
  }
}

/** A lot's drift as the page received it: still coming, there, absent, or failed to load. */
export type LotDriftAnswer =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly drift: LotDrift }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed' }

/** One channel and the lots where, by their last wafer, it is outside the good runs' band or heading out of it. */
export interface DriftLine {
  readonly channel: string
  readonly text: string
}

/** Lots that name no drifting channel, and why. */
export interface DriftGroup {
  readonly label: string
  readonly lotNos: readonly number[]
}

export interface DriftSummary {
  readonly lines: readonly DriftLine[]
  readonly groups: readonly DriftGroup[]
  readonly loading: readonly number[]
  /** The band's width in standard deviations, from the first lot that answered. */
  readonly k: number | null
}

export const NO_DRIFT_DATA = 'No drift data'
const DRIFT_FAILED = 'Drift did not load'
const TOO_FEW = 'Too few wafers to judge a trend'
const NOTHING_DRIFTING = 'No channel outside the band or heading out'

/** The drift of every lot of the source by its last wafer, with each lot accounted for once, never left blank. */
export function summarizeDrift(lots: readonly LotRuns[], answers: ReadonlyMap<number, LotDriftAnswer>): DriftSummary {
  const outBy = new Map<string, number[]>()
  const exitBy = new Map<string, number[]>()
  const grouped = new Map<string, number[]>()
  const loading: number[] = []
  let k: number | null = null
  const add = (map: Map<string, number[]>, key: string, lotNo: number) => map.set(key, [...(map.get(key) ?? []), lotNo])
  for (const group of lots) {
    const answer = answers.get(group.lotId) ?? { kind: 'loading' }
    if (answer.kind === 'loading') {
      loading.push(group.lotNo)
      continue
    }
    if (answer.kind === 'missing' || (answer.kind === 'ready' && answer.drift.channels.length === 0)) {
      add(grouped, NO_DRIFT_DATA, group.lotNo)
      continue
    }
    if (answer.kind === 'failed') {
      add(grouped, DRIFT_FAILED, group.lotNo)
      continue
    }
    const { channels, rule } = answer.drift
    k = k ?? rule.k
    if (channels.every((channel) => channel.state === 'INSUFFICIENT_RUNS')) {
      add(grouped, TOO_FEW, group.lotNo)
      continue
    }
    const drifting = channels.filter((channel) => channel.state === 'OUT_OF_BAND' || channel.state === 'WILL_EXIT')
    if (drifting.length === 0) {
      add(grouped, NOTHING_DRIFTING, group.lotNo)
    }
    for (const channel of drifting) {
      add(channel.state === 'OUT_OF_BAND' ? outBy : exitBy, channel.channel, group.lotNo)
    }
  }
  const lines = [...new Set([...outBy.keys(), ...exitBy.keys()])]
    .map((channel) => {
      const out = outBy.get(channel) ?? []
      const exit = exitBy.get(channel) ?? []
      const parts = [
        out.length === 0 ? null : out.length === lots.length && lots.length > 1 ? `outside the band in all ${out.length} lots` : `outside the band in ${describeLots(out)}`,
        exit.length === 0 ? null : `heading out in ${describeLots(exit)}`,
      ].filter((part) => part !== null)
      return { channel, text: parts.join('; '), weight: out.length + exit.length }
    })
    .sort((a, b) => b.weight - a.weight || formatChannelName(a.channel).localeCompare(formatChannelName(b.channel)))
    .map(({ channel, text }) => ({ channel, text }))
  const order = [NOTHING_DRIFTING, TOO_FEW, NO_DRIFT_DATA, DRIFT_FAILED]
  const groups = order.flatMap((label) => {
    const lotNos = grouped.get(label)
    return lotNos === undefined ? [] : [{ label, lotNos }]
  })
  return { lines, groups, loading, k }
}
