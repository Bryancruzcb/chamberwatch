import { useState } from 'react'
import { Link } from 'react-router'
import type { Channel } from '../api/schema'
import { Figure } from '../components/Figure'
import { describeLineup, formatChannelName, formatScore, formatShortAgainstLimit } from '../format'
import { describeHiddenChannels, splitLineup } from '../run'
import { endClearsLimit, scoreLineEnd, startClearsLimit } from './scale'
import { useWidth } from './useWidth'

const percent = (share: number) => `${(share * 100).toFixed(3)}%`

/** A limit closer to 0 than this share of the scale has its label set from the line rightward, and the 0 left off. */
const NEAR_START = 0.2
/** The scale's labels, in px of mono type, and the least room left between the 0 and the limit's label. */
const TICK_PX = 12
const TICK_GAP = 8

/**
 * A run's channels on one how-unusual scale, in the detectors' rank, as lollipops against one limit line. Past the
 * limit is a heavy red stem and dot; under it a thin stem and a hollow ring. The first ten show, with every channel
 * past the limit, the one with the largest score and every one that deviates or got stuck (see `splitLineup`); a
 * button shows the rest in place, and opens when the channel picked is one of them. A name opens that channel's trace.
 */
export function ChannelLineup({ channels, selected, k, n, runZ }: {
  channels: readonly Channel[]
  selected: Channel | undefined
  /** The limit, in standard deviations. */
  k: number
  /** How many samples in a row a reading must hold past the limit. */
  n: number
  /** How far, in standard deviations, a phase's mean or spread may sit from the good runs' before the channel deviates. */
  runZ: number
}) {
  const { shown, hidden } = splitLineup(channels, k)
  // Only the reader's last click is state, with the channel picked when they made it. A folded channel picked since,
  // here or from another figure, opens the list so its row shows; otherwise the click stands.
  const [click, setClick] = useState<{ readonly open: boolean; readonly under: string | undefined } | null>(null)
  const pickedFolded = selected !== undefined && hidden.includes(selected)
  const open = pickedFolded && click?.under !== selected.channel ? true : (click?.open ?? false)
  const rows = open ? [...shown, ...hidden] : shown
  const { end, past } = scoreLineEnd(channels.map((channel) => channel.persistentZ), k)
  const at = (z: number) => Math.min(Math.max(z, 0), end) / end
  const [trackWidth, measureTrack] = useWidth()
  const limitText = `limit ${formatScore(k)}`
  const endText = `${end}${past > 0 ? '+' : ''}`
  const nearStart = at(k) < NEAR_START
  return (
    <Figure id="lineup" title="Every channel against the limit" answer={describeLineup(channels, k)} className="lineup">
      <div className="lineup-rows">
        <div className="lineup-row lineup-scale" aria-hidden="true">
          <span className="lineup-head">Channel</span>
          <span className="lineup-track" ref={measureTrack}>
            {/* a limit near 0 takes the start's place, and on a short scale either end gives way to the limit's label */}
            {!nearStart && startClearsLimit(trackWidth, at(k), limitText, TICK_PX, TICK_GAP) && (
              <span className="lineup-tick start" style={{ left: 0 }}>0</span>
            )}
            <span className={nearStart ? 'lineup-tick limit near-start' : 'lineup-tick limit'} style={{ left: percent(at(k)) }}>
              {limitText}
            </span>
            {endClearsLimit(trackWidth, at(k), limitText, endText, TICK_PX, TICK_GAP, !nearStart) && (
              <span className="lineup-tick end" style={{ left: '100%' }}>{endText}</span>
            )}
          </span>
          <span />
        </div>
        <ul className="lineup-list">
          {rows.map((channel) => {
            const over = channel.persistentZ > k
            const classes = ['lineup-row', over ? 'over' : null, channel === selected ? 'selected' : null, channel.persistentZ > end ? 'past' : null]
              .filter((name) => name !== null)
              .join(' ')
            return (
              <li key={channel.channel} className={classes}>
                <span className="lineup-name">
                  <Link
                    to={{ search: `?channel=${encodeURIComponent(channel.channel)}` }}
                    replace
                    preventScrollReset
                    aria-current={channel === selected ? 'true' : undefined}
                  >
                    {formatChannelName(channel.channel)}
                  </Link>
                  {channel.deviation && <span className="word">Deviates</span>}
                  {channel.holds.length > 0 && <span className="word warn">Stuck</span>}
                </span>
                <span className="lineup-track" aria-hidden="true">
                  <span className="lineup-limit" style={{ left: percent(at(k)) }} />
                  <span className="lineup-stem" style={{ width: percent(at(channel.persistentZ)) }} />
                  <span className="lineup-dot" style={{ left: percent(at(channel.persistentZ)) }} />
                </span>
                <span className="lineup-value">
                  {formatShortAgainstLimit(channel.persistentZ, k)}
                  <span className="visually-hidden">{over ? ', past the limit' : ', under the limit'}</span>
                </span>
              </li>
            )
          })}
        </ul>
      </div>
      {hidden.length > 0 && (
        <button type="button" className="link-button lineup-more" aria-expanded={open} onClick={() => setClick({ open: !open, under: selected?.channel })}>
          {open ? `Show the first ${shown.length} only` : describeHiddenChannels(hidden)}
        </button>
      )}
      <details className="how">
        <summary>How the channels are ranked</summary>
        <p className="figure-source">
          {`In the detectors' rank: channels that left their range or got stuck come first, by when; the rest follow by how far a phase's mean or spread moved from the good runs, so the dots need not fall in order. How unusual: the most standard deviations a channel stayed from the good runs for ${n} samples in a row. Deviates: a phase's mean or spread sat more than ${formatScore(runZ)} standard deviations from the good runs'.${past > 0 ? ` The scale stops at ${end}; an arrow marks a channel past it.` : ''}`}
        </p>
      </details>
    </Figure>
  )
}
