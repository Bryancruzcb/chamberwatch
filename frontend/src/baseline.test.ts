import { describe, expect, it } from 'vitest'
import { runsPageSchema, type RunRow } from './api/schema'
import { baselinePrefix, type BaselineSlot } from './baseline'

const fixtures = import.meta.glob('../e2e/fixtures/*.json', { eager: true, import: 'default' })

function fixture(name: string): unknown {
  const key = `../e2e/fixtures/${name}`
  if (!(key in fixtures)) {
    throw new Error(`no fixture ${name}`)
  }
  return fixtures[key]
}

function byLot(runs: readonly RunRow[]): RunRow[][] {
  const lots = new Map<number, RunRow[]>()
  for (const run of runs) {
    lots.set(run.lotId, [...(lots.get(run.lotId) ?? []), run])
  }
  return [...lots.values()]
}

/** A lot written as its baseline marks by position: 'b' a baseline run, 'w' another run, '.' a slot never run. */
function lot(marks: string): BaselineSlot[] {
  return [...marks].flatMap((mark, index) => (mark === '.' ? [] : [{ positionInLot: index + 1, good: mark === 'b' }]))
}

describe('baselinePrefix', () => {
  it('finds wafers 1 to 3 in every public and every simulated lot', () => {
    expect(baselinePrefix(byLot(runsPageSchema.parse(fixture('runs.json')).runs))).toBe(3)
    // ten simulated lots of three wafers, all baseline, and lot 901 of ten with its first three
    expect(baselinePrefix(byLot(runsPageSchema.parse(fixture('runs-synthetic.json')).runs))).toBe(3)
  })

  it('counts a lot shorter than N, all baseline, as keeping the rule', () => {
    expect(baselinePrefix([lot('bbbwwwwwww'), lot('bb'), lot('bbbwww....')])).toBe(3)
    // lot 7 ran six wafers: its empty slots do not matter
    expect(baselinePrefix([lot('bbbwww')])).toBe(3)
  })

  it('gives up when a relabel moves the baseline off the first positions', () => {
    // wafer 5 of the second lot relabeled good
    expect(baselinePrefix([lot('bbbwwwwwww'), lot('bbbwbwwwww')])).toBeNull()
    // wafer 2 relabeled bad
    expect(baselinePrefix([lot('bbbwwwwwww'), lot('bwbwwwwwww')])).toBeNull()
  })

  it('gives up when the lots disagree on N', () => {
    expect(baselinePrefix([lot('bbbwwwwwww'), lot('bbwwwwwwww')])).toBeNull()
    // a whole lot of baseline runs longer than N is not "the first N"
    expect(baselinePrefix([lot('bbbwwwwwww'), lot('bbbbb')])).toBeNull()
    // a lot with runs and no baseline run among them
    expect(baselinePrefix([lot('bbbwwwwwww'), lot('wwwwwwwwww')])).toBeNull()
  })

  it('takes the whole lot when every lot is all baseline', () => {
    expect(baselinePrefix([lot('bbb'), lot('bb')])).toBe(3)
    expect(baselinePrefix([lot('bbbbbbbbbb')])).toBe(10)
  })

  it('works on one lot, the way the run page asks', () => {
    expect(baselinePrefix([lot('bbbwwwwwww')])).toBe(3)
    expect(baselinePrefix([lot('wbbwwwwwww')])).toBeNull()
  })

  it('has nothing to mark without baseline runs', () => {
    expect(baselinePrefix([])).toBeNull()
    expect(baselinePrefix([[]])).toBeNull()
    expect(baselinePrefix([lot('wwwww'), lot('www')])).toBeNull()
  })

  it('reads a baseline run at a slot that was never run before it as off the prefix', () => {
    expect(baselinePrefix([lot('b.bwwwwwww')])).toBeNull()
  })
})
