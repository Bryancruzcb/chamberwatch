import { useState } from 'react'
import { Link } from 'react-router'
import type { Channel } from '../api/schema'
import { Figure } from '../components/Figure'
import { describeLineup, formatChannelName, formatScore, formatShortAgainstLimit } from '../format'
import { describeHiddenChannels, splitLineup } from '../run'
import { scoreLineEnd } from './scale'

const percent = (share: number) => `${(share * 100).toFixed(3)}%`

/** A limit closer to 0 than this share of the scale has its label set from the line rightward, and the 0 left off. */
const NEAR_START = 0.2

/**
 * A run's channels on one how-unusual scale, in the detectors' rank, as lollipops against one limit line. Past the
 * limit is a heavy red stem and dot; under it a thin stem and a hollow ring. The first ten show, or every channel past
 * the limit if that is more; a button shows the rest in place, and starts open when the channel picked in the URL is
 * one of them. A name opens that channel's trace.
 */
export function ChannelLineup({ channels, selected, k, n }: {
  channels: readonly Channel[]
  selected: Channel | undefined
  /** The limit, in standard deviations. */
  k: number
  /** How many samples in a row a reading must hold past the limit. */
  n: number
}) {
  const { shown, hidden } = splitLineup(channels, k)
  const [open, setOpen] = useState(() => selected !== undefined && hidden.includes(selected))
  const rows = open ? [...shown, ...hidden] : shown
  const { end, past } = scoreLineEnd(channels.map((channel) => channel.persistentZ), k)
  const at = (z: number) => Math.min(Math.max(z, 0), end) / end
  return (
    <Figure id="lineup" title="Every channel against the limit" answer={describeLineup(channels, k)} className="lineup">
      <div className="lineup-rows">
        <div className="lineup-row lineup-scale" aria-hidden="true">
          <span className="lineup-head">Channel</span>
          <span className="lineup-track">
            {/* a limit near 0 takes the start's place, since its label would cover the 0 */}
            {at(k) >= NEAR_START && <span className="lineup-tick start" style={{ left: 0 }}>0</span>}
            <span className={at(k) < NEAR_START ? 'lineup-tick limit near-start' : 'lineup-tick limit'} style={{ left: percent(at(k)) }}>
              {`limit ${formatScore(k)}`}
            </span>
            <span className="lineup-tick end" style={{ left: '100%' }}>{`${end}${past > 0 ? '+' : ''}`}</span>
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
        <button type="button" className="link-button lineup-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? `Show the first ${shown.length} only` : describeHiddenChannels(hidden)}
        </button>
      )}
      <details className="how">
        <summary>How the channels are ranked</summary>
        <p className="figure-source">
          {`In the detectors' rank: channels that left their range or got stuck come first, by when; the rest follow by how far a phase's mean or spread moved from the good runs, so the dots need not fall in order. How unusual: the most standard deviations a channel stayed from the good runs for ${n} samples in a row.${past > 0 ? ` The scale stops at ${end}; an arrow marks a channel past it.` : ''}`}
        </p>
      </details>
    </Figure>
  )
}
