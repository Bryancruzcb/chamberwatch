import { describe, expect, it } from 'vitest'
import type { LiveSession } from './api/schema'
import { liveAnswer, notesReadOnly, showsHowToStart } from './live'

const IDLE: LiveSession = { recording: false, run: null, state: null, cycle: 0, samples: 0, timeS: 0, stored: null, failure: null }
const STORED = {
  run: 'LIVE-s7-L1-W01', runId: 4242, samples: 2988, reason: 'COMPLETE', alignment: 'ALIGNED', faultKind: null, faultChannel: null,
} as const

describe('the Live page answer', () => {
  it('says where the wafer being etched is', () => {
    const etching: LiveSession = { ...IDLE, recording: true, run: 'LIVE-s7-L1-W01', state: 'ETCH_SF6', cycle: 12, samples: 640, timeS: 128 }

    expect(liveAnswer(etching, false)).toEqual({ title: 'A wafer is being etched now.', lead: 'LIVE-s7-L1-W01, at cycle 12 of 100, 128.0 s in.' })
    expect(liveAnswer({ ...etching, run: null }, false).lead).toBe('At cycle 12 of 100, 128.0 s in.')
  })

  it('says what the last recording came to once the chamber is idle', () => {
    for (const readOnly of [false, true, 'unknown'] as const) {
      expect(liveAnswer({ ...IDLE, stored: STORED }, readOnly)).toEqual({
        title: 'Nothing is being etched.',
        lead: 'The last wafer it recorded, LIVE-s7-L1-W01, is stored as a run.',
      })
      expect(liveAnswer({ ...IDLE, stored: STORED, failure: 'the simulator closed the connection' }, readOnly))
        .toEqual({ title: 'The last recording stopped.', lead: 'It stored no run.' })
    }
  })

  it('says how to start when nothing has been recorded', () => {
    expect(liveAnswer(IDLE, false)).toEqual({ title: 'Nothing is being etched.', lead: 'Start the chamber simulator, then record from it here.' })
  })

  it('says a read-only instance does not record, and waits for the settings before saying either', () => {
    expect(liveAnswer(IDLE, true)).toEqual({ title: 'Nothing is being etched.', lead: 'This ChamberWatch is read-only, so it does not record live runs.' })
    expect(liveAnswer(IDLE, 'unknown')).toEqual({ title: 'Nothing is being etched.', lead: null })
  })
})

describe('the read-only note under the chamber', () => {
  it('shows only on a read-only instance whose lead has not already said so', () => {
    expect(notesReadOnly(IDLE, true)).toBe(false)
    expect(notesReadOnly({ ...IDLE, stored: STORED }, true)).toBe(true)
    expect(notesReadOnly({ ...IDLE, failure: 'the simulator closed the connection' }, true)).toBe(true)
    expect(notesReadOnly({ ...IDLE, stored: STORED }, false)).toBe(false)
    expect(notesReadOnly({ ...IDLE, stored: STORED }, 'unknown')).toBe(false)
  })
})

describe("the Live page's instructions", () => {
  it('opens how to start only on a writable instance that has recorded nothing and is not recording', () => {
    expect(showsHowToStart(IDLE, false)).toBe(true)
    expect(showsHowToStart(IDLE, true)).toBe(false)
    // until the settings arrive it is not known whether the instructions can be followed
    expect(showsHowToStart(IDLE, 'unknown')).toBe(false)
    expect(showsHowToStart({ ...IDLE, recording: true }, false)).toBe(false)
    expect(showsHowToStart({ ...IDLE, stored: STORED }, false)).toBe(false)
    expect(showsHowToStart({ ...IDLE, failure: 'the simulator closed the connection' }, false)).toBe(false)
  })
})
