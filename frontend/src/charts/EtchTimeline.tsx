import { Link } from 'react-router'
import { type Channel, type InjectedFault, isFlagged, type Score } from '../api/schema'
import { ZMeter } from '../components/ZMeter'
import { describeEvidence, formatChannelName, formatSeconds, formatUnusual } from '../format'
import { closestChannel, deviatingChannels, etchTimeline, type Lane, positionIn } from '../timeline'

const percent = (share: number) => `${(share * 100).toFixed(3)}%`

/**
 * When each channel left its range, along the etch: one lane per channel in rank order, solid red for an excursion past
 * the limit and hatched brown for a stuck value, with the fault the simulator put in as a dashed line. Each lane ends on
 * how unusual the channel got against the limit. A run no channel left shows the one that came closest instead, and a
 * run caught only on a phase mean or spread lists those channels.
 */
export function EtchTimeline({ assessment, channels, k, etch, fault }: {
  assessment: Score
  channels: readonly Channel[]
  k: number | null
  etch: { fromS: number; toS: number }
  fault: InjectedFault | null
}) {
  const timeline = etchTimeline(channels, etch.fromS, etch.toS)
  const evidence = describeEvidence(assessment, channels)
  const deviating = timeline.lanes.length === 0 && isFlagged(assessment) ? deviatingChannels(channels) : null
  if (deviating !== null && deviating.shown.length > 0) {
    // Out of range with nothing to draw: no meter either, since the meter shows the limit rule, which these passed.
    return (
      <section className="panel timeline" aria-labelledby="timeline-title">
        <h2 id="timeline-title">Phase mean or spread off the good runs</h2>
        <ul className="lanes">
          {deviating.shown.map((channel) => (
            <li key={channel.channel} className="lane lane-closest">
              <ChannelLink channel={channel} />
            </li>
          ))}
        </ul>
        <p className="timeline-foot">
          {`${evidence ?? ''} No channel stayed past the limit or got stuck, so there is no moment to draw along the etch.`.trim()}
          {deviating.hidden > 0 && ` ${deviating.hidden} more ${deviating.hidden === 1 ? 'channel is' : 'channels are'} in the list below.`}
        </p>
      </section>
    )
  }
  if (timeline.lanes.length === 0) {
    const closest = closestChannel(channels)
    return (
      <section className="panel timeline" aria-labelledby="timeline-title">
        <h2 id="timeline-title">Closest to the limit</h2>
        {closest !== null && (
          <ul className="lanes">
            <li className="lane lane-closest">
              <ChannelLink channel={closest} />
              <Meter z={closest.persistentZ} k={k} />
            </li>
          </ul>
        )}
        {evidence !== null && <p className="timeline-foot">{evidence}</p>}
      </section>
    )
  }
  const faultAt = fault === null ? null : positionIn(etch.fromS, etch.toS, fault.startS)
  const kinds = new Set(timeline.lanes.flatMap((lane) => lane.spans.map((span) => span.kind)))
  return (
    <section className="panel timeline" aria-labelledby="timeline-title">
      <h2 id="timeline-title">When channels left their range</h2>
      <ul className="lanes">
        {timeline.lanes.map((lane) => (
          <li key={lane.channel.channel} className="lane">
            <ChannelLink channel={lane.channel} />
            <span className="lane-track" aria-hidden="true">
              {lane.spans.map((span, index) => (
                <span
                  key={index}
                  data-kind={span.kind}
                  className={`lane-span ${span.kind}`}
                  style={{ left: percent(span.start), width: percent(span.width) }}
                />
              ))}
              {faultAt !== null && <span className="lane-fault" style={{ left: percent(faultAt) }} />}
            </span>
            <span className="visually-hidden">{describeLane(lane)}</span>
            <Meter z={lane.channel.persistentZ} k={k} />
          </li>
        ))}
        <li className="lane lane-axis" aria-hidden="true">
          <span />
          <span className="lane-track">
            {timeline.ticks.map((tick) => (
              <span key={tick.s} className="lane-tick" style={{ left: percent(tick.at) }}>{tick.s}</span>
            ))}
          </span>
          <span className="lane-unit">seconds</span>
        </li>
      </ul>
      {timeline.hidden > 0 && (
        <p className="timeline-foot">{`${timeline.hidden} more ${timeline.hidden === 1 ? 'channel' : 'channels'} left the range; the table below lists every one.`}</p>
      )}
      <div className="timeline-foot">
        {evidence !== null && <p>{evidence}</p>}
        <p className="timeline-key" aria-hidden="true">
          {kinds.has('excursion') && <span><i className="key-span excursion" />excursion</span>}
          {kinds.has('hold') && <span><i className="key-span hold" />stuck value</span>}
          {faultAt !== null && <span><i className="key-fault" />{`fault put in, ${formatSeconds(fault?.startS ?? null)}`}</span>}
        </p>
      </div>
    </section>
  )
}

function ChannelLink({ channel }: { channel: Channel }) {
  return (
    <Link className="lane-name" to={{ search: `?channel=${encodeURIComponent(channel.channel)}` }} replace preventScrollReset>
      {formatChannelName(channel.channel)}
    </Link>
  )
}

function Meter({ z, k }: { z: number; k: number | null }) {
  return k === null ? <span className="num meter-value">{formatUnusual(z)}</span> : <ZMeter z={z} k={k} />
}

/** What a lane draws, in words, for a reader who cannot see it. */
function describeLane(lane: Lane): string {
  const times = [...lane.channel.excursions, ...lane.channel.holds].flatMap((stretch) => (stretch.startTimeS === null ? [] : [stretch.startTimeS]))
  const first = times.length === 0 ? null : Math.min(...times)
  const counts = [
    ...(lane.channel.excursions.length > 0 ? [`${lane.channel.excursions.length} ${lane.channel.excursions.length === 1 ? 'excursion' : 'excursions'}`] : []),
    ...(lane.channel.holds.length > 0 ? [`${lane.channel.holds.length} stuck ${lane.channel.holds.length === 1 ? 'value' : 'values'}`] : []),
  ]
  return ` ${counts.join(' and ')}${first === null ? '' : `, first at ${formatSeconds(first)}`}.`
}
