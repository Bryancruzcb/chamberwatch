// Where a source's baseline runs sit in their lots, so a figure can mark them once instead of on every wafer. Only
// calculations. A run is a baseline run when the API says `good`, and a relabel can change that, so nothing here
// assumes "wafers 1 to 3".

/** The two facts the rule needs about a run: where it sits in its lot and whether the baseline learns from it. */
export interface BaselineSlot {
  readonly positionInLot: number
  readonly good: boolean
}

/**
 * N when, in every lot, the baseline runs are exactly the lot's first N positions, or the whole lot when the lot is
 * shorter than N. Null when they are not, or when no lot has a baseline run: then a figure marks each baseline run
 * on its own instead of drawing one bracket over the first N columns.
 */
export function baselinePrefix(lots: ReadonlyArray<ReadonlyArray<BaselineSlot>>): number | null {
  // a lot with runs past its baseline fixes N; a lot that is all baseline only says N is at least its length
  let fixed: number | null = null
  let atLeast = 0
  for (const runs of lots) {
    if (runs.length === 0) {
      continue
    }
    const length = Math.max(...runs.map((run) => run.positionInLot))
    const good = [...new Set(runs.filter((run) => run.good).map((run) => run.positionInLot))].sort((a, b) => a - b)
    if (!good.every((position, index) => position === index + 1)) {
      return null
    }
    if (good.length < length) {
      if (fixed !== null && fixed !== good.length) {
        return null
      }
      fixed = good.length
    }
    else {
      atLeast = Math.max(atLeast, good.length)
    }
  }
  if (fixed === null) {
    return atLeast > 0 ? atLeast : null
  }
  return fixed > 0 && fixed >= atLeast ? fixed : null
}
