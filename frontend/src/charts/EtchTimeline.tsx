import { Link } from 'react-router'
import { type Channel, type InjectedFault, isFlagged, type Score } from '../api/schema'
import { Figure } from '../components/Figure'
import { ScoreLine } from '../components/ScoreLine'
import { describeEvidence, formatChannelName, formatSeconds, formatShortAgainstLimit } from '../format'
import { describeClosest } from '../run'
import { closestChannel, deviatingChannels, etchTimeline, type Lane, positionIn, type Tick } from '../timeline'
import { timeAxisLabels, verdictEnd } from './scale'
import { useWidth } from './useWidth'

const percent = (share: number) => `${(share * 100).toFixed(3)}%`

/** Past this share of the etch the first-moment label sits left of its leader, so it never runs off the lane. */
const LABEL_FLIP = 0.4
/** The axis's tick labels, in px of mono type. */
const TICK_PX = 12

/**
 * When each channel left its range, along the etch: one lane per channel in rank order, solid red for an excursion past
 * the limit and hatched ink for a stuck value, with the fault the simulator put in as a dashed line. A leader marks the
 * first moment, and each lane ends on how unusual the channel got, in mono with a state dot. A run no channel left shows
 * the one that came closest instead, and a run caught only on a phase mean or spread lists those channels.
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
    // Out of range with nothing to draw: no score either, since the score is read against the limit, which these passed.
    return (
      <Figure id="timeline" title="Phase mean or spread off the good runs" answer={evidence} className="timeline">
        <ul className="lanes lanes-plain">
          {deviating.shown.map((channel) => (
            <li key={channel.channel} className="lane lane-plain">
              <ChannelLink channel={channel} />
            </li>
          ))}
        </ul>
        <p className="figure-foot">
          No channel stayed past the limit or got stuck, so there is no moment to draw along the etch.
          {deviating.hidden > 0 && ` ${deviating.hidden} more ${deviating.hidden === 1 ? 'channel is' : 'channels are'} in the lineup.`}
        </p>
      </Figure>
    )
  }
  if (timeline.lanes.length === 0) {
    const closest = closestChannel(channels)
    return (
      <Figure
        id="timeline"
        title="Closest to the limit"
        answer={closest === null ? evidence : describeClosest(closest, k)}
        className="timeline"
      >
        {closest !== null && (
          <ul className="lanes">
            <li className="lane lane-closest">
              <ChannelLink channel={closest} />
              {k === null
                ? <span />
                : <ScoreLine z={closest.persistentZ} k={k} end={verdictEnd(closest.persistentZ, k)} out={false} ticks />}
              <LaneScore z={closest.persistentZ} k={k} />
            </li>
          </ul>
        )}
      </Figure>
    )
  }
  const faultAt = fault === null ? null : positionIn(etch.fromS, etch.toS, fault.startS)
  const kinds = new Set(timeline.lanes.flatMap((lane) => lane.spans.map((span) => span.kind)))
  const { first } = timeline
  return (
    <Figure id="timeline" title="When channels left their range" answer={evidence} className="timeline">
      <div className="lane lane-head" aria-hidden="true">
        <span />
        <span className="lane-track">
          {first !== null && (
            <span className={first.at > LABEL_FLIP ? 'lane-first flip' : 'lane-first'} style={{ left: percent(first.at) }}>
              {`${first.kind === 'hold' ? 'Stuck from' : 'First excursion,'} ${formatSeconds(first.s)}`}
            </span>
          )}
        </span>
        <span className="lane-unit">How unusual</span>
      </div>
      <ul className="lanes">
        {timeline.lanes.map((lane) => (
          <li key={lane.channel.channel} className="lane">
            <span className="lane-label">
              <ChannelLink channel={lane.channel} />
              {lane.channel.holds.length > 0 && <span className="word warn">Stuck</span>}
            </span>
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
            <LaneScore z={lane.channel.persistentZ} k={k} />
          </li>
        ))}
      </ul>
      <LaneAxis ticks={timeline.ticks} />
      <div className="figure-foot timeline-foot">
        {timeline.hidden > 0 && (
          <p>{`${timeline.hidden} more ${timeline.hidden === 1 ? 'channel' : 'channels'} left the range; the lineup lists every one.`}</p>
        )}
        <p className="timeline-key" aria-hidden="true">
          {kinds.has('excursion') && <span><i className="key-span excursion" />excursion past the limit</span>}
          {kinds.has('hold') && <span><i className="key-span hold" />stuck value</span>}
          {faultAt !== null && <span><i className="key-fault" />{`fault put in, ${formatSeconds(fault?.startS ?? null)}`}</span>}
        </p>
      </div>
    </Figure>
  )
}

/**
 * The time axis under the lanes, its last tick carrying the unit ("700 s"). That label ends on its mark rather than
 * pass the track's end, so on a phone nothing hangs in the page's gutter; the track is measured for it.
 */
function LaneAxis({ ticks }: { ticks: readonly Tick[] }) {
  const [width, measure] = useWidth()
  const labels = timeAxisLabels(ticks.map((tick) => ({ at: tick.at, x: tick.at * width, text: String(tick.s) })), 's', TICK_PX, width)
  return (
    <div className="lane lane-axis" aria-hidden="true">
      <span />
      <span className="lane-track" ref={measure}>
        {labels.map((label) => (
          <span key={label.at} className={label.anchor === 'end' ? 'lane-tick end' : 'lane-tick'} style={{ left: percent(label.at) }}>
            {label.text}
          </span>
        ))}
      </span>
      <span />
    </div>
  )
}

function ChannelLink({ channel }: { channel: Channel }) {
  return (
    <Link className="lane-name" to={{ search: `?channel=${encodeURIComponent(channel.channel)}` }} replace preventScrollReset>
      {formatChannelName(channel.channel)}
    </Link>
  )
}

/** How unusual a channel got, in mono, after a dot that is solid red past the limit and a hollow ring under it. */
function LaneScore({ z, k }: { z: number; k: number | null }) {
  const over = k !== null && z > k
  return (
    <span className={over ? 'lane-score over' : 'lane-score'}>
      {k !== null && <span className="state-dot" aria-hidden="true" />}
      {formatShortAgainstLimit(z, k)}
      {k !== null && <span className="visually-hidden">{over ? ', past the limit' : ', under the limit'}</span>}
    </span>
  )
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
