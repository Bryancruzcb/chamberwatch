import type { Interval } from './scale'

/** Which of `bins` equal steps across a range a value falls in, 0 for the lowest. Values past either end clamp to it. */
export function binIndex(value: number, [low, high]: Interval, bins: number): number {
  if (!(high > low)) {
    return 0
  }
  const index = Math.floor(((value - low) / (high - low)) * bins)
  return Math.min(bins - 1, Math.max(0, index))
}
