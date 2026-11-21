import { Link, useParams, useSearchParams } from 'react-router'
import { type Measurements, type MeasurementSet, measurementsSchema, runDepthSchema, runDetailSchema } from '../api/schema'
import { withSource } from '../api/source'
import { useResource } from '../api/useResource'
import { PredictionStrip } from '../charts/PredictionStrip'
import { RadialProfile } from '../charts/RadialProfile'
import { WaferMap } from '../charts/WaferMap'
import { Loaded } from '../components/Loaded'
import { Segmented } from '../components/Segmented'
import { describePrediction, describeWaferDepth, formatMicrons } from '../format'
import { NotFound } from './NotFound'

const SETS = [['EIGHTY_NINE_POINT', '89-point'], ['NINE_POINT', '9-point']] as const

export function WaferPage() {
  const { runId } = useParams()
  if (runId === undefined || !/^\d+$/.test(runId)) {
    return <NotFound />
  }
  return <WaferView key={runId} runId={Number(runId)} />
}

function WaferView({ runId }: { runId: number }) {
  const [params, setParams] = useSearchParams()
  const set: MeasurementSet = params.get('set') === 'NINE_POINT' ? 'NINE_POINT' : 'EIGHTY_NINE_POINT'
  const [run] = useResource(`/api/runs/${runId}`, runDetailSchema)
  const [measurements] = useResource(`/api/runs/${runId}/measurements?set=${set}`, measurementsSchema)
  return (
    <>
      <header className="page-head">
        <Loaded resource={run}>
          {(detail) => (
            <>
              <title>{`${detail.key} depth · ChamberWatch`}</title>
              <p className="breadcrumb">
                <Link to={withSource('/', detail.source)}>Runs</Link>
                <span aria-hidden="true"> / </span>
                <Link to={`/lots/${detail.lotId}`}>{`Lot ${detail.lotNo}`}</Link>
                <span aria-hidden="true"> / </span>
                <Link to={`/runs/${detail.id}`}>{`Wafer ${detail.positionInLot}`}</Link>
              </p>
              <h1>Measured depth</h1>
              <p className="subtitle key">{detail.key}</p>
            </>
          )}
        </Loaded>
      </header>
      <Segmented
        label="Measurement set"
        value={set}
        options={SETS}
        onChange={(next) => setParams(next === 'EIGHTY_NINE_POINT' ? {} : { set: next }, { replace: true, preventScrollReset: true })}
      />
      <Loaded resource={measurements}>{(data) => <MeasurementsView measurements={data} />}</Loaded>
      <Loaded resource={run}>{(detail) => (detail.source === 'PUBLIC' ? <PredictedDepth runId={runId} set={set} /> : null)}</Loaded>
    </>
  )
}

/** What the wafer's telemetry says its depth should be, from a model that never saw its lot. Public wafers only. */
function PredictedDepth({ runId, set }: { runId: number; set: MeasurementSet }) {
  const [depth] = useResource(`/api/runs/${runId}/depth?set=${set}`, runDepthSchema)
  return (
    <section className="panel" aria-labelledby="predicted-title">
      <h2 id="predicted-title">Predicted from the telemetry</h2>
      <Loaded resource={depth}>
        {(data) => (
          <>
            <p className="panel-answer">{describePrediction(data)}</p>
            <PredictionStrip predictedUm={data.predictedUm} measuredUm={data.measuredUm} missUm={data.lotRmseUm} />
          </>
        )}
      </Loaded>
      <details className="how">
        <summary>How this is counted</summary>
        <p>
          A ridge regression on every channel's phase means and spreads predicts the wafer's mean depth. The model that
          predicts this wafer was fitted on the other lots only, so it never saw this lot's depths. The lot's typical miss
          is the root mean square error over its measured wafers, all predicted the same way.{' '}
          <Link to="/lots">The lots page</Link> compares the model with two simpler guesses.
        </p>
      </details>
    </section>
  )
}

function MeasurementsView({ measurements }: { measurements: Measurements }) {
  const depths = measurements.values.map((site) => site.depthUm)
  const answer = describeWaferDepth(measurements)
  return (
    <section className="panel" aria-labelledby="wafer-title">
      <h2 id="wafer-title">Etch depth across the wafer</h2>
      {answer !== null && <p className="panel-answer">{answer}</p>}
      {measurements.points === 0
        ? <p className="status-line">No measured depth in this set.</p>
        : (
          <WaferMap measurements={measurements}>
            <dl className="wafer-facts">
              <div><dt>Mean</dt><dd className="num">{formatMicrons(measurements.meanDepthUm)}</dd></div>
              <div><dt>Spread (sd)</dt><dd className="num">{formatMicrons(measurements.sdDepthUm)}</dd></div>
              <div><dt>Range</dt><dd className="num">{formatMicrons(Math.max(...depths) - Math.min(...depths))}</dd></div>
              <div><dt>Sites</dt><dd className="num">{measurements.points}</dd></div>
            </dl>
            <RadialProfile sites={measurements.values} />
          </WaferMap>
        )}
      <details className="how">
        <summary>How this is counted</summary>
        <p>
          Depth is step height less the oxide left on top. The 9-point and 89-point sets were measured months apart
          with different instruments, so they are never mixed. Sites near the center and near the edge are the third of
          the sites closest to the center and the third farthest from it, widened so that a ring of sites at the same
          distance is never split.
        </p>
      </details>
    </section>
  )
}
