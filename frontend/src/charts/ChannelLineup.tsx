import { Link } from 'react-router'
import type { Channel } from '../api/schema'
import { describeLineup, formatAgainstLimit, formatChannelName, formatScore } from '../format'

const percent = (share: number) => `${(share * 100).toFixed(3)}%`

/** The scale runs to twice the limit, like every how-unusual meter in the app, so the limit sits halfway and a step change pins the edge. */
const SPAN_IN_LIMITS = 2

/**
 * Every channel of a run on one how-unusual scale, in the detectors' rank, with the limit drawn once for all of them.
 * A channel past the limit is a red dot; one under it a hollow one. A name opens that channel's trace.
 */
export function ChannelLineup({ channels, selected, k, n }: {
  channels: readonly Channel[]
  selected: Channel | undefined
  /** The limit, in standard deviations. */
  k: number
  /** How many samples in a row a reading must hold past the limit. */
  n: number
}) {
  const span = SPAN_IN_LIMITS * k
  const at = (z: number) => Math.min(Math.max(z, 0), span) / span
  const ticks = Array.from({ length: SPAN_IN_LIMITS + 1 }, (_, index) => index * k)
  return (
    <section className="panel lineup" aria-labelledby="lineup-title">
      <h2 id="lineup-title">Every channel against the limit</h2>
      <p className="panel-answer">{describeLineup(channels, k)}</p>
      <ul className="lineup-rows">
        {channels.map((channel) => {
          const over = channel.persistentZ > k
          return (
            <li key={channel.channel} className={channel === selected ? 'lineup-row selected' : 'lineup-row'}>
              <span className="lineup-name">
                <Link
                  to={{ search: `?channel=${encodeURIComponent(channel.channel)}` }}
                  replace
                  preventScrollReset
                  aria-current={channel === selected ? 'true' : undefined}
                >
                  {formatChannelName(channel.channel)}
                </Link>
                {channel.deviation && <span className="tag">Deviates</span>}
                {channel.holds.length > 0 && <span className="tag tag-warn">Stuck</span>}
              </span>
              <span className="lineup-track" aria-hidden="true">
                <span className="lineup-normal" style={{ width: percent(at(k)) }} />
                <span className="lineup-limit" style={{ left: percent(at(k)) }} />
                <span className={over ? 'lineup-dot over' : 'lineup-dot'} style={{ left: percent(at(channel.persistentZ)) }} />
              </span>
              <span className={over ? 'lineup-value num over' : 'lineup-value num'}>
                {formatAgainstLimit(channel.persistentZ, k)}
                <span className="visually-hidden">{over ? ', past the limit' : ', under the limit'}</span>
              </span>
            </li>
          )
        })}
        <li className="lineup-row lineup-axis" aria-hidden="true">
          <span />
          <span className="lineup-track">
            {ticks.map((tick) => (
              <span key={tick} className={tick === k ? 'lineup-tick limit' : 'lineup-tick'} style={{ left: percent(at(tick)) }}>
                {tick === k ? `limit ${formatScore(k)}` : formatScore(tick)}
              </span>
            ))}
          </span>
          <span />
        </li>
      </ul>
      <p className="figure-source">
        {`In the detectors' rank: channels that left their range or got stuck come first, by when; the rest follow by how far a phase's mean or spread moved from the good runs, so the dots need not fall in order. How unusual: the most standard deviations a channel stayed from the good runs for ${n} samples in a row. The shaded part of each line is under the limit.`}
      </p>
    </section>
  )
}
