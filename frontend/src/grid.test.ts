import { describe, expect, it } from 'vitest'
import { lotsSchema, type RunRow, runsPageSchema } from './api/schema'
import { describeNotRun, gridKinds, hasStop, lotGrid, nextStop, rowSegments } from './grid'

const fixtures = import.meta.glob('../e2e/fixtures/*.json', { eager: true, import: 'default' })

function fixture(name: string): unknown {
  const key = `../e2e/fixtures/${name}`
  if (!(key in fixtures)) {
    throw new Error(`no fixture ${name}`)
  }
  return fixtures[key]
}

const lots = lotsSchema.parse(fixture('lots.json'))
const page = runsPageSchema.parse(fixture('runs.json'))

describe('grid', () => {
  it('lays the public wafers out as ten lots by ten positions, with the out-of-range block in lots 6 to 9', () => {
    const grid = lotGrid(page.runs, lots)

    expect(grid.positions).toBe(10)
    expect(grid.rows.map((row) => row.lotNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(grid.rows.map((row) => row.out)).toEqual([0, 0, 0, 0, 0, 7, 3, 1, 4, 0])
    expect(grid.rows.reduce((sum, row) => sum + row.cells.filter((cell) => cell !== null).length, 0)).toBe(96)
    const lot6 = grid.rows[5]
    expect(lot6?.cells.map((cell) => cell?.state)).toEqual(['in', 'in', 'in', 'out', 'out', 'out', 'out', 'out', 'out', 'out'])
    expect(lot6?.cells.slice(0, 3).every((cell) => cell?.run.good)).toBe(true)
    expect(lot6?.lot?.runDate).toBe('2024-08-01')
  })

  it('leaves a gap where a lot has no wafer, and puts each wafer at its own position', () => {
    const grid = lotGrid(page.runs, lots)
    const lot7 = grid.rows[6]

    // lot 7 ran six wafers
    expect(lot7?.cells.map((cell) => cell === null)).toEqual([false, false, false, false, false, false, true, true, true, true])
    for (const row of grid.rows) {
      row.cells.forEach((cell, index) => {
        if (cell !== null) {
          expect(cell.run.positionInLot).toBe(index + 1)
        }
      })
    }
  })

  it('widens for a lot longer than ten wafers and still works without the lot list', () => {
    const first = page.runs[0]
    if (first === undefined) {
      throw new Error('no public runs')
    }
    const long: RunRow[] = Array.from({ length: 12 }, (_, index) => ({ ...first, id: 9000 + index, positionInLot: index + 1 }))

    const grid = lotGrid(long, [])
    expect(grid.positions).toBe(12)
    expect(grid.rows).toHaveLength(1)
    expect(grid.rows[0]?.lot).toBeNull()
    expect(lotGrid([], [])).toEqual({ rows: [], positions: 10, baseline: null })
  })

  it('keeps an unscored and a misaligned wafer in their own slots, out of the count', () => {
    const runs = page.runs.map((run): RunRow => {
      if (run.lotNo !== 6) {
        return run
      }
      if (run.positionInLot === 4) {
        return { ...run, score: null }
      }
      if (run.positionInLot === 5) {
        return { ...run, alignment: 'FAILED', score: null }
      }
      // a misaligned run that still carries a score is misaligned first
      return run.positionInLot === 6 ? { ...run, alignment: 'FAILED' } : run
    })
    const lot6 = lotGrid(runs, lots).rows[5]

    expect(lot6?.cells.map((cell) => cell?.state)).toEqual(['in', 'in', 'in', 'unscored', 'failed', 'failed', 'out', 'out', 'out', 'out'])
    expect(lot6?.out).toBe(4)
  })

  it('counts the out-of-range wafers without a baseline too', () => {
    expect(lotGrid(page.runs, lots).rows.map((row) => row.out)).toEqual([0, 0, 0, 0, 0, 7, 3, 1, 4, 0])
  })

  it('finds the baseline in the first three positions, and loses it when a relabel moves it', () => {
    expect(lotGrid(page.runs, lots).baseline).toBe(3)
    const relabeled = page.runs.map((run): RunRow => (run.lotNo === 6 && run.positionInLot === 5 ? { ...run, good: true } : run))
    expect(lotGrid(relabeled, lots).baseline).toBeNull()
  })

  it('draws a row as wafers, the gap after the baseline, and one stretch for the slots never run', () => {
    const grid = lotGrid(page.runs, lots)
    const lot7 = grid.rows[6]
    if (lot7 === undefined) {
      throw new Error('no lot 7')
    }
    const kinds = (segments: ReturnType<typeof rowSegments>) => segments.map((segment) => (segment.kind === 'slot' ? segment.position : segment.kind === 'gap' ? '|' : `${segment.from}-${segment.to}`))

    expect(kinds(rowSegments(lot7, 3))).toEqual([1, 2, 3, '|', 4, 5, 6, '7-10'])
    expect(kinds(rowSegments(lot7, null))).toEqual([1, 2, 3, 4, 5, 6, '7-10'])
    // a stretch never crosses the gap, and a baseline as long as the row leaves no gap
    const short = { ...lot7, cells: lot7.cells.map((cell, index) => (index === 1 || index === 3 ? null : cell)) }
    expect(kinds(rowSegments(short, 2))).toEqual([1, '2-2', '|', 3, '4-4', 5, 6, '7-10'])
    expect(kinds(rowSegments(grid.rows[0] ?? lot7, 10))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('names the lots that ran fewer wafers than the map has slots', () => {
    expect(describeNotRun(lotGrid(page.runs, lots))).toBe('Lot 7 ran 6 wafers.')
    expect(describeNotRun(lotGrid(page.runs.filter((run) => run.lotNo === 1), lots))).toBeNull()
    const threes = page.runs.filter((run) => run.lotNo < 4 && run.positionInLot <= 3)
    expect(describeNotRun(lotGrid(threes, lots))).toBe('Lots 1 to 3 ran 3 wafers each.')
    const one = page.runs.filter((run) => run.lotNo === 2 && run.positionInLot === 1)
    expect(describeNotRun(lotGrid(one, lots))).toBe('Lot 2 ran 1 wafer.')
    expect(describeNotRun(lotGrid([...threes, ...page.runs.filter((run) => run.lotNo === 7)], lots))).toBe('A slot its lot never ran.')
  })

  it('says which kinds of mark a grid holds, so the key names only those', () => {
    // the public wafers: in range, out of range, baseline runs, and lot 7's four missing positions
    expect(gridKinds(lotGrid(page.runs, lots))).toEqual({ inRange: true, outOfRange: true, unmeasured: false, missing: true, baseline: true })
    const unscored = page.runs.filter((run) => run.lotNo === 1).map((run): RunRow => ({ ...run, score: null, good: false }))
    expect(gridKinds(lotGrid(unscored, lots))).toEqual({ inRange: false, outOfRange: false, unmeasured: true, missing: false, baseline: false })
    expect(gridKinds(lotGrid([], []))).toEqual({ inRange: false, outOfRange: false, unmeasured: false, missing: false, baseline: false })
  })

  it("moves the keyboard between the grid's links, skipping positions a lot never ran", () => {
    const grid = lotGrid(page.runs, lots)

    expect(nextStop(grid, { row: 0, col: 0 }, 'ArrowRight', false)).toEqual({ row: 0, col: 1 })
    // at an edge the focus stays where it is
    expect(nextStop(grid, { row: 0, col: 0 }, 'ArrowLeft', false)).toEqual({ row: 0, col: 0 })
    expect(nextStop(grid, { row: 0, col: 0 }, 'ArrowUp', false)).toEqual({ row: 0, col: 0 })
    expect(nextStop(grid, { row: 9, col: 10 }, 'ArrowDown', false)).toEqual({ row: 9, col: 10 })
    // lot 7, row 6, ran six wafers: down from lot 6 wafer 8 lands on lot 8, and its row ends at wafer 6
    expect(nextStop(grid, { row: 5, col: 8 }, 'ArrowDown', false)).toEqual({ row: 7, col: 8 })
    expect(nextStop(grid, { row: 7, col: 8 }, 'ArrowUp', false)).toEqual({ row: 5, col: 8 })
    expect(nextStop(grid, { row: 6, col: 0 }, 'End', false)).toEqual({ row: 6, col: 6 })
    expect(nextStop(grid, { row: 6, col: 6 }, 'ArrowRight', false)).toEqual({ row: 6, col: 6 })
    expect(nextStop(grid, { row: 4, col: 5 }, 'Home', false)).toEqual({ row: 4, col: 0 })
    expect(nextStop(grid, { row: 4, col: 5 }, 'Home', true)).toEqual({ row: 0, col: 0 })
    expect(nextStop(grid, { row: 4, col: 5 }, 'End', true)).toEqual({ row: 9, col: 10 })
    // a key the grid has no use for is left to the browser
    expect(nextStop(grid, { row: 0, col: 0 }, 'Enter', false)).toBeNull()
    expect(nextStop(grid, { row: 0, col: 0 }, 'Tab', false)).toBeNull()
    expect(hasStop(grid, { row: 6, col: 6 })).toBe(true)
    expect(hasStop(grid, { row: 6, col: 7 })).toBe(false)
    expect(hasStop(grid, { row: 10, col: 0 })).toBe(false)
    expect(hasStop(grid, { row: 0, col: 11 })).toBe(false)
  })
})
