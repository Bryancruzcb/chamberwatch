import type { LotStrip as Strip, StripSlot } from '../run'
import { Disc } from './Disc'

/**
 * A lot as a row of discs, each a link to its run: one bracket over the baseline wafers when they are the lot's first
 * N, or a centre dot in each baseline disc when they are not. Every disc prints its wafer number. The run page sets its
 * own wafer larger with a "This wafer" label; a lot's own page marks none. The strip scrolls on its own if a long lot
 * will not fit.
 */
export function LotStrip({ strip, lotNo }: { strip: Strip; lotNo: number }) {
  const n = strip.baseline
  const baseline = n === null ? [] : strip.slots.filter((slot) => slot.position <= n)
  const rest = n === null ? strip.slots : strip.slots.filter((slot) => slot.position > n)
  // the "this wafer" label goes under its disc when the baseline bracket already holds the space above it
  const hereInBaseline = baseline.some((slot) => slot.current)
  return (
    <div className={hereInBaseline ? 'lot-strip label-below' : 'lot-strip'} role="group" aria-label={`Lot ${lotNo}, wafer by wafer`}>
      {baseline.length > 0 && (
        <span className="strip-baseline">
          <span className="strip-bracket" aria-hidden="true">Baseline</span>
          {baseline.map((slot) => <StripDisc key={slot.id} slot={slot} marked={false} />)}
        </span>
      )}
      {rest.map((slot) => <StripDisc key={slot.id} slot={slot} marked={n === null && slot.good} />)}
    </div>
  )
}

/** The strip's place while the lot's runs load, at the strip's own height so nothing under it moves. */
export function LotStripPlaceholder() {
  return <div className="lot-strip placeholder" aria-hidden="true"><span className="skel skel-strip" /></div>
}

function StripDisc({ slot, marked }: { slot: StripSlot; marked: boolean }) {
  const disc = (
    <Disc
      state={slot.state}
      size={slot.current ? 'here' : 'strip'}
      text={slot.text}
      to={`/runs/${slot.id}`}
      label={slot.label}
      current={slot.current}
      baseline={marked}
    />
  )
  if (!slot.current) {
    return disc
  }
  return (
    <span className="strip-here">
      <span className="strip-here-label" aria-hidden="true">This wafer</span>
      {disc}
    </span>
  )
}
