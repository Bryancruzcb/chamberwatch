import { describe, expect, it } from 'vitest'
import type { LiveSession } from './api/schema'
import { liveAnswer, showsHowToStart } from './live'

const IDLE: LiveSession = { recording: false, run: null, state: null, cycle: 0, samples: 0, timeS: 0, stored: null, failure: null }
const STORED = {
  run: 'LIVE-s7-L1-W01', runId: 4242, samples: 2988, reason: 'COMPLETE', alignment: 'ALIGNED', faultKind: null, faultChannel: null,
} as const

describe('the Live page answer', () => {
  it('says where the wafer being etched is', () => {
    const etching: LiveSession = { ...IDLE, recording: true, run: 'LIVE-s7-L1-W01', state: 'ETCH_SF6', cycle: 12, samples: 640, timeS: 128 }

    expect(liveAnswer(etching)).toEqual({ title: 'A wafer is being etched now.', lead: 'LIVE-s7-L1-W01, at cycle 12 of 100, 128.0 s in.' })
    expect(liveAnswer({ ...etching, run: null }).lead).toBe('At cycle 12 of 100, 128.0 s in.')
  })

  it('says what the last recording came to once the chamber is idle', () => {
    expect(liveAnswer({ ...IDLE, stored: STORED })).toEqual({
      title: 'Nothing is being etched.',
      lead: 'The last wafer it recorded, LIVE-s7-L1-W01, is stored as a run.',
    })
    expect(liveAnswer({ ...IDLE, stored: STORED, failure: 'the simulator closed the connection' }))
      .toEqual({ title: 'The last recording stopped.', lead: 'It stored no run.' })
  })

  it('says how to start when nothing has been recorded', () => {
    expect(liveAnswer(IDLE)).toEqual({ title: 'Nothing is being etched.', lead: 'Start the chamber simulator, then record from it here.' })
  })
})

describe("the Live page's instructions", () => {
  it('opens how to start only on a writable instance that has recorded nothing and is not recording', () => {
    expect(showsHowToStart(IDLE, false)).toBe(true)
    expect(showsHowToStart(IDLE, true)).toBe(false)
    expect(showsHowToStart({ ...IDLE, recording: true }, false)).toBe(false)
    expect(showsHowToStart({ ...IDLE, stored: STORED }, false)).toBe(false)
    expect(showsHowToStart({ ...IDLE, failure: 'the simulator closed the connection' }, false)).toBe(false)
  })
})
