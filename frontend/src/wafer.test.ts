import { describe, expect, it } from 'vitest'
import { type MeasurementPoint, measurementsSchema } from './api/schema'
import { centerAndEdge, radialProfile } from './wafer'

const fixtures = import.meta.glob('../e2e/fixtures/measurements-55*.json', { eager: true, import: 'default' })
const eightyNine = measurementsSchema.parse(fixtures['../e2e/fixtures/measurements-55.json'])
const nine = measurementsSchema.parse(fixtures['../e2e/fixtures/measurements-55-nine.json'])

/** A site at (x, y) in millimetres with the given depth. */
function site(xMm: number, yMm: number, depthUm: number): MeasurementPoint {
  return { pointNo: 1, locId: null, xUm: xMm * 1000, yUm: yMm * 1000, preoxUm: 0, postoxUm: 0, postoxMeasured: true, stepheightUm: depthUm, depthUm }
}

describe('wafer', () => {
  it('orders the sites from the center out, in millimetres', () => {
    const profile = radialProfile([site(30, 40, 42), site(0, 0, 40), site(-60, 0, 41)])

    expect(profile).toEqual([{ radiusMm: 0, depthUm: 40 }, { radiusMm: 50, depthUm: 42 }, { radiusMm: 60, depthUm: 41 }])
  })

  it('compares the third of the sites nearest the edge with the third nearest the center', () => {
    const sides = centerAndEdge([site(0, 0, 40), site(10, 0, 41), site(50, 0, 43), site(60, 0, 44), site(90, 0, 47), site(95, 0, 49)])

    expect(sides).toEqual({ centerUm: 40.5, edgeUm: 48 })
    expect(centerAndEdge([site(0, 0, 40), site(90, 0, 47)])).toBeNull()
  })

  it('finds wafer 55 deeper at its edge than at its center', () => {
    const sides = centerAndEdge(eightyNine.values)

    expect(sides?.edgeUm).toBeCloseTo(47.67, 2)
    expect(sides?.centerUm).toBeCloseTo(41.22, 2)
  })

  it('never splits a ring of sites at the same distance, so the order of the rows cannot change the answer', () => {
    // the 9-point set: one site at the center, four on a ring at 53.7 mm, four on a ring at 76 mm
    const sides = centerAndEdge(nine.values)

    expect(sides?.centerUm).toBeCloseTo(40.07, 2)
    expect(sides?.edgeUm).toBeCloseTo(41.04, 2)
    expect(centerAndEdge([...nine.values].reverse())).toEqual(sides)
    expect(centerAndEdge([...eightyNine.values].reverse())).toEqual(centerAndEdge(eightyNine.values))
  })

  it('has no answer when the center and the edge would be the same ring', () => {
    expect(centerAndEdge([site(50, 0, 40), site(-50, 0, 41), site(0, 50, 42), site(0, -50, 43)])).toBeNull()
    expect(centerAndEdge([])).toBeNull()
  })
})
