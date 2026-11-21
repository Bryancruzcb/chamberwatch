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

/** A run that names no first channel and no time it left its range: every run in range, and every unscored one. */
export function leftNoRange(run: RunRow): boolean {
  return (run.score?.firstChannel ?? null) === null && (run.score?.firstTimeS ?? null) === null
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

/** How many out-of-range runs name a channel first, and which. `channel` is null for runs that name none. */
export interface ChannelCount {
  readonly channel: string | null
  readonly count: number
  /** The runs, by lot and wafer. */
  readonly runs: readonly RunRow[]
}

/** Runs of one lot, kept together so a figure can cluster them. */
export interface LotCluster {
  readonly lotId: number
  readonly lotNo: number
  readonly runs: readonly RunRow[]
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
  const byChannel = new Map<string | null, RunRow[]>()
  for (const run of out) {
    const channel = run.score?.firstChannel ?? null
    byChannel.set(channel, [...(byChannel.get(channel) ?? []), run])
  }
  return [...byChannel.entries()]
    .map(([channel, runs]) => ({ channel, count: runs.length, runs: [...runs].sort(byLotAndWafer) }))
    .sort((a, b) => b.count - a.count || channelOrder(a.channel, b.channel))
}

function byLotAndWafer(a: RunRow, b: RunRow): number {
  return a.lotNo - b.lotNo || a.positionInLot - b.positionInLot || a.id - b.id
}

/** Runs grouped by lot in lot order, wafers in order inside each, for a figure that clusters them. */
export function clusterByLot(runs: readonly RunRow[]): LotCluster[] {
  const clusters: LotCluster[] = []
  for (const run of [...runs].sort(byLotAndWafer)) {
    const last = clusters.at(-1)
    if (last !== undefined && last.lotId === run.lotId) {
      clusters[clusters.length - 1] = { ...last, runs: [...last.runs, run] }
    }
    else {
      clusters.push({ lotId: run.lotId, lotNo: run.lotNo, runs: [run] })
    }
  }
  return clusters
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
  /** The start of the lead to set in the out-of-range color: the count, when any run is out of range. */
  readonly signal: string | null
  readonly start: Start | null
  /** The words to set in bold at the start of the start sentence, empty for a tie. */
  readonly startStrong: string
  /** The rest of the start sentence. */
  readonly startText: string
  /** For a page with nothing out of range: how the runs split, when not all of them are in range. */
  readonly detail: string | null
}

const QUIET = { signal: null, start: null, startStrong: '', startText: '', detail: null } as const

export function headline(summary: RunsSummary): Headline {
  const total = summary.runs.length
  const outCount = summary.out.length
  if (total === 0) {
    return { ...QUIET, lead: 'No runs stored for this source yet.' }
  }
  if (outCount === 0 && summary.inRange === 0) {
    return unscoredHeadline(summary)
  }
  if (outCount === 0) {
    if (summary.inRange === total) {
      return { ...QUIET, lead: total === 1 ? 'The one run is in range.' : `All ${total} runs are in range.` }
    }
    return { ...QUIET, lead: `None of the ${total} runs are out of range.`, detail: describeSplit(summary) }
  }
  const lots = describeLots(summary.attention.map((group) => group.lotNo))
  if (total === 1) {
    return { ...QUIET, lead: `The one run is out of range, in ${lots}.` }
  }
  const start = startOf(summary.attention)
  return {
    lead: outCount === 1
      ? `1 of ${total} runs is out of range, in ${lots}.`
      : `${outCount} of ${total} runs are out of range, all in ${lots}.`,
    signal: String(outCount),
    start,
    ...startSentence(start),
    detail: null,
  }
}

/**
 * No run of the source is scored, so "none out of range" would claim more than is known. The detail line is kept only
 * for the runs that could not be aligned, since "not scored" would repeat the lead.
 */
function unscoredHeadline(summary: RunsSummary): Headline {
  const total = summary.runs.length
  if (total === 1) {
    return { ...QUIET, lead: 'The run has not been scored yet.', detail: summary.failed === 0 ? null : 'It could not be aligned.' }
  }
  return {
    ...QUIET,
    lead: `None of the ${total} runs has been scored yet.`,
    detail: summary.failed === 0 ? null : describeSplit(summary),
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
    // a lot that skipped slots can have wafer 5 among 2 runs; "wafers 4 and 5 of 2" would read as a slip
    const of = Math.max(...start.wafers) > start.of ? '' : ` of ${start.of}`
    return {
      startStrong: `Start with Lot ${start.lotNo}:`,
      startText: ` ${describeWafers(start.wafers)}${of} ${start.wafers.length === 1 ? 'is' : 'are'} out.`,
    }
  }
  return { startStrong: '', startText: `Lots ${listWords(start.lotNos.map(String))} tie for the most: ${start.count} out each.` }
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
 * Which channel left its range first: "Platen RF load cap in 10 of the 15 runs and Platen RF tuning cap in 5." Channels
 * named first by a single run are counted together once there are two or more of them.
 */
export function describeFirstChannels(counts: ReadonlyArray<Pick<ChannelCount, 'channel' | 'count'>>, outCount: number): string {
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
  return `${listWords([first, ...several, ...tail])}.${none}`
}

/**
 * The lots with nothing out of range, in one line: "Lots 1 to 5 and 10: 60 wafers, none out of range." A lot with no
 * scored run is not called clean: it gets "none scored" in a sentence of its own.
 */
export function describeClean(clean: readonly LotRuns[]): string | null {
  const scored = clean.filter((group) => group.runs.some((run) => runState(run) === 'in'))
  const unscored = clean.filter((group) => !scored.includes(group))
  const sentences = [cleanSentence(scored, 'none out of range'), cleanSentence(unscored, 'none scored')].filter((line) => line !== null)
  return sentences.length === 0 ? null : sentences.join(' ')
}

function cleanSentence(groups: readonly LotRuns[], words: string): string | null {
  if (groups.length === 0) {
    return null
  }
  const wafers = groups.reduce((total, group) => total + group.runs.length, 0)
  const lots = describeLots(groups.map((group) => group.lotNo))
  return `${capitalize(lots)}: ${wafers} ${wafers === 1 ? 'wafer' : 'wafers'}, ${words}.`
}

/** "lots 6 to 9" at the start of a sentence. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
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
  const byLot = byLotAndWafer
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

const NO_DRIFT_DATA = 'No drift data'
const DRIFT_FAILED = 'Drift did not load'
const TOO_FEW = 'Too few wafers to judge a trend'
const NOTHING_DRIFTING = 'No channel outside the band or heading out'

/**
 * The drift figure's answer, or null while any lot is still loading, since a late lot can add a channel.
 * "No channel" is said only when some lot was judged and found quiet: a lot with no data, too few
 * wafers or a failed call judged nothing.
 */
export function describeDrift(drift: DriftSummary): string | null {
  if (drift.loading.length > 0) {
    return null
  }
  if (drift.lines.length === 0) {
    return drift.groups.some((group) => group.label === NOTHING_DRIFTING)
      ? 'No channel is outside the band or heading out, by each lot\'s last wafer.'
      : 'No lot has a drift verdict yet.'
  }
  const count = drift.lines.length
  return `${count} ${count === 1 ? 'channel is' : 'channels are'} outside the band or heading out, by each lot's last wafer.`
}

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
