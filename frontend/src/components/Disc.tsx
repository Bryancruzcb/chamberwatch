import { Link } from 'react-router'
import type { RunState } from '../summary'

/**
 * The sizes a wafer is drawn at: the cassette map (46px, 24px on a phone), the run page's lot strip (34px) and its
 * current wafer (48px), a ledger row (26px), a cluster (32px), a mini disc in a table (18px on a 26 by 32px target),
 * and a key's sample (34px).
 */
export type DiscSize = 'map' | 'strip' | 'here' | 'ledger' | 'cluster' | 'mini' | 'key'

/**
 * A wafer, drawn as one. In range is a hollow ring, out of range a solid red disc that can carry its score, and a
 * wafer that was not scored or could not be aligned a dashed ring, so the state never rests on color alone.
 *
 * With `to` the disc is a link; with `label` it speaks for itself (a link's name, or an image's); with neither it is
 * decoration, for a row whose text already says what the disc shows. `baseline` adds a centre dot, for a figure that
 * cannot mark its baseline runs with one bracket. `current` gives the ink halo and `aria-current` of "this wafer".
 * `data` becomes `data-*` attributes, which the cassette map's keyboard reads back.
 */
export function Disc({ state, size, text, baseline = false, current = false, to, label, tabIndex, data }: {
  state: RunState
  size: DiscSize
  text?: string
  baseline?: boolean
  current?: boolean
  to?: string
  label?: string
  tabIndex?: number
  data?: Readonly<Record<string, string | number>>
}) {
  const className = `disc disc-${size} ${state}${baseline ? ' baseline' : ''}${current ? ' current' : ''}`
  const attributes = Object.fromEntries(Object.entries(data ?? {}).map(([key, value]) => [`data-${key}`, value]))
  const mark = (
    <span className="disc-mark">
      {text !== undefined && <span className="disc-text">{text}</span>}
    </span>
  )
  if (to !== undefined) {
    return (
      <Link
        to={to}
        className={className}
        aria-label={label}
        title={label}
        aria-current={current ? 'page' : undefined}
        tabIndex={tabIndex}
        {...attributes}
      >
        {mark}
      </Link>
    )
  }
  return label === undefined
    ? <span className={className} aria-hidden="true" {...attributes}>{mark}</span>
    : <span className={className} role="img" aria-label={label} aria-current={current ? 'true' : undefined} {...attributes}>{mark}</span>
}
