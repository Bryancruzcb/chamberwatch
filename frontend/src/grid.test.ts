import { describe, expect, it } from 'vitest'
import { lotsSchema, type RunRow, runsPageSchema } from './api/schema'
import { gridKinds, hasStop, lotGrid, nextStop, shadeOf } from './grid'

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
const K = 6

describe('grid', () => {
  it('shades an in-range run by how close it came to the limit', () => {
    expect(shadeOf(0, K, false)).toBe(1)
    expect(shadeOf(2.9, K, false)).toBe(1)
    expect(shadeOf(3, K, false)).toBe(2)
    expect(shadeOf(4.7, K, false)).toBe(2)
    expect(shadeOf(4.8, K, false)).toBe(3)
    expect(shadeOf(5.9, K, false)).toBe(3)
  })

  it('shades an out-of-range run by how far past the limit it went', () => {
    expect(shadeOf(6.1, K, true)).toBe(1)
    expect(shadeOf(11.9, K, true)).toBe(1)
    expect(shadeOf(12, K, true)).toBe(2)
    expect(shadeOf(18, K, true)).toBe(3)
    expect(shadeOf(97795, K, true)).toBe(3)
    // a stuck value or a phase average can flag a run that never passed the limit
    expect(shadeOf(1.5, K, true)).toBe(1)
  })

  it('takes the lightest shade when there is nothing to measure against', () => {
    expect(shadeOf(null, K, false)).toBe(1)
    expect(shadeOf(9, null, true)).toBe(1)
    expect(shadeOf(9, 0, true)).toBe(1)
  })

  it('lays the public wafers out as ten lots by ten positions, with the out-of-range block in lots 6 to 9', () => {
    const grid = lotGrid(page.runs, lots, page.baseline?.k ?? null)

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
    const grid = lotGrid(page.runs, lots, K)
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

    const grid = lotGrid(long, [], K)
    expect(grid.positions).toBe(12)
    expect(grid.rows).toHaveLength(1)
    expect(grid.rows[0]?.lot).toBeNull()
    expect(lotGrid([], [], K)).toEqual({ rows: [], positions: 10 })
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
    const lot6 = lotGrid(runs, lots, K).rows[5]

    expect(lot6?.cells.map((cell) => cell?.state)).toEqual(['in', 'in', 'in', 'unscored', 'failed', 'failed', 'out', 'out', 'out', 'out'])
    expect(lot6?.cells[3]?.shade).toBe(1)
    expect(lot6?.cells[4]?.shade).toBe(1)
    expect(lot6?.out).toBe(4)
  })

  it('shades every wafer the lightest without a baseline, and still counts the out-of-range ones', () => {
    const grid = lotGrid(page.runs, lots, null)

    expect(grid.rows.flatMap((row) => row.cells).every((cell) => cell === null || cell.shade === 1)).toBe(true)
    expect(grid.rows.map((row) => row.out)).toEqual([0, 0, 0, 0, 0, 7, 3, 1, 4, 0])
  })

  it('says which kinds of cell a grid holds, so the key names only those', () => {
    // the public wafers: in range, out of range, baseline runs, and lot 7's four missing positions
    expect(gridKinds(lotGrid(page.runs, lots, K))).toEqual({ inRange: true, outOfRange: true, unmeasured: false, missing: true, baseline: true })
    const unscored = page.runs.filter((run) => run.lotNo === 1).map((run): RunRow => ({ ...run, score: null, good: false }))
    expect(gridKinds(lotGrid(unscored, lots, null))).toEqual({ inRange: false, outOfRange: false, unmeasured: true, missing: false, baseline: false })
    expect(gridKinds(lotGrid([], [], K))).toEqual({ inRange: false, outOfRange: false, unmeasured: false, missing: false, baseline: false })
  })

  it("moves the keyboard between the grid's links, skipping positions a lot never ran", () => {
    const grid = lotGrid(page.runs, lots, K)

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
