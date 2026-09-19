import { Link, useParams, useSearchParams } from 'react-router'
import { type Measurements, type MeasurementSet, measurementsSchema, runDepthSchema, runDetailSchema } from '../api/schema'
import { withSource } from '../api/source'
import { useResource } from '../api/useResource'
import { WaferMap } from '../charts/WaferMap'
import { Loaded } from '../components/Loaded'
import { Segmented } from '../components/Segmented'
import { Stat } from '../components/Stat'
import { describeResidual, formatMicrons } from '../format'
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
      <p className="note">
        A ridge regression on every channel's phase means and spreads predicts the wafer's mean depth. The model that
        predicts this wafer was fitted on the other lots only, so it never saw this lot's depths.{' '}
        <Link to="/lots">The lots page</Link> compares it with two simpler guesses.
      </p>
      <Loaded resource={depth}>
        {(data) => (
          <dl className="stats">
            <Stat label="Predicted depth" value={formatMicrons(data.predictedUm)} detail={describeResidual(data.residualUm)} />
            <Stat label="Measured depth" value={formatMicrons(data.measuredUm)} detail="Mean over the measured sites" />
            <Stat
              label={`Lot ${data.lotNo} error`}
              value={formatMicrons(data.lotRmseUm)}
              detail="Root mean square over the lot's measured wafers, all predicted without the lot"
            />
          </dl>
        )}
      </Loaded>
    </section>
  )
}

function MeasurementsView({ measurements }: { measurements: Measurements }) {
  const depths = measurements.values.map((site) => site.depthUm)
  return (
    <>
      <dl className="stats">
        <Stat label="Sites" value={measurements.points} />
        <Stat label="Mean depth" value={formatMicrons(measurements.meanDepthUm)} />
        <Stat label="Spread" value={formatMicrons(measurements.sdDepthUm)} detail="Standard deviation across the sites" />
        {depths.length > 0 && (
          <Stat label="Range" value={formatMicrons(Math.max(...depths) - Math.min(...depths))} detail="Deepest site less shallowest" />
        )}
      </dl>
      <section className="panel" aria-labelledby="wafer-title">
        <h2 id="wafer-title">Etch depth across the wafer</h2>
        <p className="note">
          Depth is step height less the oxide left on top. The 9-point and 89-point sets were measured months apart with
          different instruments, so they are never mixed.
        </p>
        {measurements.points === 0
          ? <p className="status-line">No measured depth in this set.</p>
          : <WaferMap measurements={measurements} />}
      </section>
    </>
  )
}
