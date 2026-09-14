import { describe, expect, it } from 'vitest'
import { isFlagged, lotsSchema, runDetailSchema, runsPageSchema, traceSchema } from './schema'

// Responses captured from the real API on the public data, the same ones the end-to-end tests serve. The pages read
// these shapes, so each one must parse.
const fixtures = import.meta.glob('../../e2e/fixtures/*.json', { eager: true, import: 'default' })

function fixture(name: string): unknown {
  const key = `../../e2e/fixtures/${name}`
  if (!(key in fixtures)) {
    throw new Error(`no fixture ${name}`)
  }
  return fixtures[key]
}

describe('captured API responses', () => {
  it.each([
    ['lots.json', lotsSchema],
    ['runs.json', runsPageSchema],
    ['run-55.json', runDetailSchema],
    ['run-11.json', runDetailSchema],
    ['trace-55.json', traceSchema],
  ] as const)('%s parses', (name, schema) => {
    const parsed = schema.safeParse(fixture(name))

    expect(parsed.error?.issues ?? []).toEqual([])
  })

  it('count the 15 flagged public wafers', () => {
    const page = runsPageSchema.parse(fixture('runs.json'))

    expect(page.runs).toHaveLength(96)
    expect(page.runs.filter((run) => isFlagged(run.score))).toHaveLength(15)
  })
})
