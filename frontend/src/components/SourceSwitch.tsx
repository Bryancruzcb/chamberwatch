import type { Source } from '../api/schema'
import { formatSource } from '../format'
import { Segmented } from './Segmented'

const SOURCES = [
  ['PUBLIC', formatSource('PUBLIC')],
  ['SYNTHETIC', formatSource('SYNTHETIC')],
  ['LIVE', formatSource('LIVE')],
] as const

/** Public wafers, simulated ones, or ones streamed live from the chamber simulator. */
export function SourceSwitch({ value, onChange }: { value: Source; onChange: (source: Source) => void }) {
  return <Segmented label="Source" value={value} options={SOURCES} onChange={onChange} />
}
