import { describe, expect, it } from 'vitest'
import { readSource, sourceQuery, withSource } from './source'

describe('source', () => {
  it('reads every source a link can name, and falls back to the public one', () => {
    expect(readSource(new URLSearchParams(''))).toBe('PUBLIC')
    expect(readSource(new URLSearchParams('source=SYNTHETIC'))).toBe('SYNTHETIC')
    expect(readSource(new URLSearchParams('source=LIVE'))).toBe('LIVE')
    expect(readSource(new URLSearchParams('source=NONSENSE'))).toBe('PUBLIC')
  })

  it('keeps a link on the source it came from, live ones included', () => {
    expect(sourceQuery('PUBLIC')).toBe('')
    expect(sourceQuery('SYNTHETIC')).toBe('source=SYNTHETIC')
    // a live run's links once went to the simulated lots, because the query was written for two sources only
    expect(sourceQuery('LIVE')).toBe('source=LIVE')
    expect(withSource('/lots/31', 'LIVE')).toBe('/lots/31?source=LIVE')
    expect(withSource('/?lot=31', 'LIVE')).toBe('/?lot=31&source=LIVE')
    expect(withSource('/lots/6', 'PUBLIC')).toBe('/lots/6')
  })
})
