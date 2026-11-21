import type { Lot, RunRow } from './api/schema'
import { type RunState, runState } from './summary'

// Every run of a source laid out as lots by wafer position, for the Runs page's grid. Only calculations.

/** Three steps of shade. In range: how close a wafer came to the limit. Out of range: how far past it went. */
export type Shade = 1 | 2 | 3

export interface GridCell {
  readonly run: RunRow
  readonly state: RunState
  readonly shade: Shade
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
}

/** Lots are planned at 10 wafers, so a shorter lot still shows where its missing wafers would sit. */
const MIN_POSITIONS = 10

/**
 * The shade of a scored run against the limit `k`. In range: under half the limit is 1, under 80 percent 2, closer 3.
 * Out of range: under twice the limit 1, under three times 2, further 3. A run flagged by a rule other than the limit,
 * a stuck value or a phase average, can sit under the limit and still be out; it takes the lightest red.
 */
export function shadeOf(z: number | null, k: number | null, out: boolean): Shade {
  if (z === null || k === null || k <= 0) {
    return 1
  }
  if (out) {
    return z >= 3 * k ? 3 : z >= 2 * k ? 2 : 1
  }
  // whole-number multiples on both sides: 0.8 * 6 is 4.800000000000001, which would push a run at 4.8 down a shade
  return 5 * z >= 4 * k ? 3 : 2 * z >= k ? 2 : 1
}

/** The runs as rows of lots in lot order, each cell at its wafer's position. */
export function lotGrid(runs: readonly RunRow[], lots: readonly Lot[], k: number | null): LotGrid {
  const positions = Math.max(MIN_POSITIONS, ...runs.map((run) => run.positionInLot))
  const byLot = new Map<number, RunRow[]>()
  for (const run of runs) {
    byLot.set(run.lotId, [...(byLot.get(run.lotId) ?? []), run])
  }
  const rows = [...byLot.entries()].map(([lotId, lotRuns]): GridRow => {
    // the database keeps one run per position, counted from 1; a row is built by position so nothing else can land in it
    const cells = Array.from({ length: positions }, (_, index): GridCell | null => {
      const run = lotRuns.find((candidate) => candidate.positionInLot === index + 1)
      if (run === undefined) {
        return null
      }
      const state = runState(run)
      return { run, state, shade: shadeOf(run.score?.persistentZ ?? null, k, state === 'out') }
    })
    return {
      lotId,
      lotNo: lotRuns[0]?.lotNo ?? 0,
      lot: lots.find((lot) => lot.id === lotId) ?? null,
      cells,
      out: cells.filter((cell) => cell?.state === 'out').length,
    }
  })
  return { rows: rows.sort((a, b) => a.lotNo - b.lotNo), positions }
}
