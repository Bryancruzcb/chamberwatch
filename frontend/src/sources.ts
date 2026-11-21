import type { Source } from './api/schema'

// What the app says about each source of wafers: where its numbers come from, and how wafers get into an empty one.

/** The line under a figure that says where its wafers come from. */
export const SOURCE_LINES = {
  PUBLIC: 'Source: Zenodo record 17122442, "A Multi-Model Dataset for BOSCH Plasma-Etching", TU Chemnitz and Fraunhofer ENAS, CC BY 4.0.',
  SYNTHETIC: 'Source: ChamberWatch\'s seeded simulator. The faults are planted, and the detectors score the wafers without knowing.',
  LIVE: 'Source: wafers the C chamber simulator streamed to this app on the Live page.',
} as const satisfies Record<Source, string>

/** What a page says where a source has no wafers yet. */
export const EMPTY_HINTS = {
  PUBLIC: 'The public wafers show up here once the ingest command has loaded them.',
  SYNTHETIC: 'The simulated wafers show up here once the simulate-lot command has stored them.',
  LIVE: 'A wafer recorded on the Live page shows up here when its run ends.',
} as const satisfies Record<Source, string>
