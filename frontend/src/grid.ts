import type { Lot, RunRow } from './api/schema'
import { baselinePrefix } from './baseline'
import { describeLots, type RunState, runState } from './summary'

// Every run of a source laid out as lots by wafer position, for the Runs page's cassette map. Only calculations.

export interface GridCell {
  readonly run: RunRow
  readonly state: RunState
}

export interface GridRow {
  readonly lotId: number
  readonly lotNo: number
  readonly lot: Lot | null
  /** One slot per wafer position, null where the lot has no wafer at that position. */
  readonly cells: readonly (GridCell | null)[]
  readonly out: number
}

export interface LotGrid {
  readonly rows: readonly GridRow[]
  readonly positions: number
  /** The baseline runs are the first `baseline` positions of every lot; null when they are not, or there are none. */
  readonly baseline: number | null
}

/** Lots are planned at 10 wafers, so a shorter lot still shows where its missing wafers would sit. */
const MIN_POSITIONS = 10

/** The runs as rows of lots in lot order, each cell at its wafer's position. */
export function lotGrid(runs: readonly RunRow[], lots: readonly Lot[]): LotGrid {
  const positions = Math.max(MIN_POSITIONS, ...runs.map((run) => run.positionInLot))
  const byLot = new Map<number, RunRow[]>()
  for (const run of runs) {
    byLot.set(run.lotId, [...(byLot.get(run.lotId) ?? []), run])
  }
  const rows = [...byLot.entries()].map(([lotId, lotRuns]): GridRow => {
    // the database keeps one run per position, counted from 1; a row is built by position so nothing else can land in it
    const cells = Array.from({ length: positions }, (_, index): GridCell | null => {
      const run = lotRuns.find((candidate) => candidate.positionInLot === index + 1)
      return run === undefined ? null : { run, state: runState(run) }
    })
    return {
      lotId,
      lotNo: lotRuns[0]?.lotNo ?? 0,
      lot: lots.find((lot) => lot.id === lotId) ?? null,
      cells,
      out: cells.filter((cell) => cell?.state === 'out').length,
    }
  })
  return { rows: rows.sort((a, b) => a.lotNo - b.lotNo), positions, baseline: baselinePrefix([...byLot.values()]) }
}

/** Which kinds of mark a grid holds, so its key names only what is on the page. */
export interface GridKinds {
  readonly inRange: boolean
  readonly outOfRange: boolean
  /** A wafer that was not scored or could not be aligned. */
  readonly unmeasured: boolean
  /** A position where a lot ran no wafer. */
  readonly missing: boolean
  readonly baseline: boolean
}

export function gridKinds(grid: LotGrid): GridKinds {
  const cells = grid.rows.flatMap((row) => row.cells)
  return {
    inRange: cells.some((cell) => cell?.state === 'in'),
    outOfRange: cells.some((cell) => cell?.state === 'out'),
    unmeasured: cells.some((cell) => cell?.state === 'failed' || cell?.state === 'unscored'),
    missing: cells.some((cell) => cell === null),
    baseline: cells.some((cell) => cell?.run.good === true),
  }
}

/** One stretch of a lot's row, left to right: a wafer, the gap after the baseline, or slots the lot never ran. */
export type GridSegment =
  | { readonly kind: 'slot'; readonly position: number; readonly cell: GridCell }
  | { readonly kind: 'gap' }
  | { readonly kind: 'not-run'; readonly from: number; readonly to: number }

/**
 * A row as the map draws it. Positions a lot never ran merge into one stretch, so it can carry a single "not run"
 * label, and the gap after the baseline sits after position `baseline` in every row so the divider lines up.
 */
export function rowSegments(row: GridRow, baseline: number | null): GridSegment[] {
  const segments: GridSegment[] = []
  row.cells.forEach((cell, index) => {
    const position = index + 1
    const last = segments.at(-1)
    if (cell !== null) {
      segments.push({ kind: 'slot', position, cell })
    }
    else if (last !== undefined && last.kind === 'not-run' && last.to === position - 1) {
      segments[segments.length - 1] = { ...last, to: position }
    }
    else {
      segments.push({ kind: 'not-run', from: position, to: position })
    }
    if (baseline !== null && position === baseline && position < row.cells.length) {
      segments.push({ kind: 'gap' })
    }
  })
  return segments
}

/** The key's line for the slots lots never ran: "Lot 7 ran 6 wafers." Null when every lot ran every slot. */
export function describeNotRun(grid: LotGrid): string | null {
  const short = grid.rows
    .filter((row) => row.cells.some((cell) => cell === null))
    .map((row) => ({ lotNo: row.lotNo, ran: row.cells.filter((cell) => cell !== null).length }))
  const [first] = short
  if (first === undefined) {
    return null
  }
  const wafers = (count: number) => `${count} ${count === 1 ? 'wafer' : 'wafers'}`
  if (short.length === 1) {
    return `Lot ${first.lotNo} ran ${wafers(first.ran)}.`
  }
  if (short.every((entry) => entry.ran === first.ran)) {
    const lots = describeLots(short.map((entry) => entry.lotNo))
    return `${lots.charAt(0).toUpperCase()}${lots.slice(1)} ran ${wafers(first.ran)} each.`
  }
  return 'A slot its lot never ran.'
}

/** A keyboard stop in the grid: column 0 is the lot's link, column c the wafer at position c. */
export interface GridStop {
  readonly row: number
  readonly col: number
}

/** Whether a stop has a link to focus: every lot has its own, a position only where the lot ran a wafer. */
export function hasStop(grid: LotGrid, { row, col }: GridStop): boolean {
  const cells = grid.rows[row]?.cells
  return cells !== undefined && col >= 0 && col <= grid.positions && (col === 0 || (cells[col - 1] ?? null) !== null)
}

/**
 * Where a key moves the focus from a stop: an arrow to the next link that way, skipping positions a lot never ran and
 * staying put at an edge; Home and End to the row's first and last link, or the grid's with Ctrl. Null for a key the
 * grid leaves alone.
 */
export function nextStop(grid: LotGrid, from: GridStop, key: string, ctrl: boolean): GridStop | null {
  const scan = (start: GridStop, rowStep: number, colStep: number): GridStop => {
    let row = start.row + rowStep
    let col = start.col + colStep
    while (row >= 0 && row < grid.rows.length && col >= 0 && col <= grid.positions) {
      if (hasStop(grid, { row, col })) {
        return { row, col }
      }
      row += rowStep
      col += colStep
    }
    return from
  }
  switch (key) {
    case 'ArrowRight':
      return scan(from, 0, 1)
    case 'ArrowLeft':
      return scan(from, 0, -1)
    case 'ArrowDown':
      return scan(from, 1, 0)
    case 'ArrowUp':
      return scan(from, -1, 0)
    case 'Home':
      return { row: ctrl ? 0 : from.row, col: 0 }
    case 'End':
      return scan({ row: ctrl ? grid.rows.length - 1 : from.row, col: grid.positions + 1 }, 0, -1)
    default:
      return null
  }
}
