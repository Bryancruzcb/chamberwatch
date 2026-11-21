import { Link, useParams, useSearchParams } from 'react-router'
import {
  type Measurements, type MeasurementSet, measurementsSchema, runDepthSchema, runDetailSchema, type RunDetail,
} from '../api/schema'
import { withSource } from '../api/source'
import { useResource } from '../api/useResource'
import { PredictionStrip } from '../charts/PredictionStrip'
import { RadialProfile } from '../charts/RadialProfile'
import { WaferMap } from '../charts/WaferMap'
import { Figure } from '../components/Figure'
import { Segmented } from '../components/Segmented'
import { Stat } from '../components/Stat'
import { ErrorState } from '../components/States'
import { describePrediction, describeWaferDepth, formatDate, formatMicrons, formatMeasurementSet, tieUnits, waferHeadline } from '../format'
import { NotFound, PageFailure } from './NotFound'

const SETS = [['EIGHTY_NINE_POINT', '89-point'], ['NINE_POINT', '9-point']] as const

export function WaferPage() {
  const { runId } = useParams()
  if (runId === undefined || !/^\d+$/.test(runId)) {
    return <NotFound />
  }
  return <WaferView key={runId} runId={Number(runId)} />
}

/**
 * A wafer's measured depth. The answer says which etched deeper, the sites near its edge or near its center; then the map of its sites
 * and, for a public wafer, the depth its telemetry predicts. The measurement set is chosen in the first figure's head.
 */
function WaferView({ runId }: { runId: number }) {
  const [params, setParams] = useSearchParams()
  const set: MeasurementSet = params.get('set') === 'NINE_POINT' ? 'NINE_POINT' : 'EIGHTY_NINE_POINT'
  const [run, reloadRun] = useResource(`/api/runs/${runId}`, runDetailSchema)
  const [measurements, reloadMeasurements] = useResource(`/api/runs/${runId}/measurements?set=${set}`, measurementsSchema)
  // a new set keeps the last set's sites on hand until its own arrive; they never stand in for the new set's answer
  const current = measurements.kind === 'ready' && !measurements.refreshing ? measurements.data : null
  if (run.kind === 'error') {
    return (
      <PageFailure
        error={run.error}
        onRetry={reloadRun}
        missing={`There is no run ${runId}.`}
        back={{ to: '/', label: 'Back to the runs' }}
        name="Measured depth"
        failed="This wafer did not load"
        title="Measured depth · ChamberWatch"
      />
    )
  }
  return (
    <div className="sheet">
      {run.kind === 'loading'
        ? <WaferHeadSkeleton />
        : <WaferHead run={run.data} measurements={current} failed={measurements.kind === 'error'} />}
      <Figure
        id="wafer"
        title="Etch depth across the wafer"
        answer={current === null ? undefined : describeWaferDepth(current)}
        busy={measurements.kind === 'loading'}
        control={(
          <Segmented
            label="Measurement set"
            value={set}
            options={SETS}
            onChange={(next) => setParams(next === 'EIGHTY_NINE_POINT' ? {} : { set: next }, { replace: true, preventScrollReset: true })}
          />
        )}
      >
        {measurements.kind === 'loading' && <span className="skel skel-wafer" aria-hidden="true" />}
        {measurements.kind === 'error' && (
          <ErrorState title="Could not load the measurements" message={measurements.error.message} onRetry={reloadMeasurements} />
        )}
        {measurements.kind === 'ready' && (
          <div className={measurements.refreshing ? 'figure-body refreshing' : 'figure-body'} aria-busy={measurements.refreshing || undefined}>
            <MeasurementsView measurements={measurements.data} />
          </div>
        )}
      </Figure>
      {run.kind === 'ready' && run.data.source === 'PUBLIC' && <PredictedDepth runId={runId} set={set} />}
    </div>
  )
}

/** The breadcrumb and the answer. When the measurements fail, Fig. 1 says why and the headline names the wafer plainly. */
function WaferHead({ run, measurements, failed }: { run: RunDetail; measurements: Measurements | null; failed: boolean }) {
  return (
    <header className="page-head">
      <title>{`Lot ${run.lotNo}, wafer ${run.positionInLot} depth · ChamberWatch`}</title>
      <p className="breadcrumb">
        <Link to={withSource('/', run.source)}>Runs</Link>
        <span aria-hidden="true"> / </span>
        <Link to={`/lots/${run.lotId}`}>{`Lot ${run.lotNo}`}</Link>
        <span aria-hidden="true"> / </span>
        <Link to={`/runs/${run.id}`}>{`Wafer ${run.positionInLot}`}</Link>
        <span aria-hidden="true"> / </span>
        Depth
      </p>
      {measurements !== null
        ? <h1>{tieUnits(waferHeadline(run, measurements))}</h1>
        : failed
          // a placeholder here would wait forever
          ? <h1>{`Wafer ${run.positionInLot} of Lot\u00a0${run.lotNo}`}</h1>
          : (
              <>
                <h1 className="visually-hidden">Measured depth</h1>
                <span className="skel skel-title" aria-hidden="true" />
                <span className="skel skel-title short" aria-hidden="true" />
              </>
            )}
      <p className="page-meta">
        {run.runDate !== null && <span>{formatDate(run.runDate)}</span>}
        <span className="run-key">{run.key}</span>
        <Link to={`/runs/${run.id}`}>Its run</Link>
      </p>
    </header>
  )
}

function WaferHeadSkeleton() {
  return (
    <div className="page-head" role="status">
      <span className="visually-hidden">Loading…</span>
      <span className="skel skel-crumb" aria-hidden="true" />
      <span className="skel skel-title" aria-hidden="true" />
      <span className="skel skel-title short" aria-hidden="true" />
    </div>
  )
}

/** What the wafer's telemetry says its depth should be, from a model that never saw its lot. Public wafers only. */
function PredictedDepth({ runId, set }: { runId: number; set: MeasurementSet }) {
  const [depth, reload] = useResource(`/api/runs/${runId}/depth?set=${set}`, runDepthSchema)
  // a new set keeps the last set's prediction on hand, dimmed, until its own arrives; it never answers for the new set
  const refreshing = depth.kind === 'ready' && depth.refreshing
  return (
    <Figure
      id="predicted"
      title="Predicted from the telemetry"
      answer={depth.kind === 'ready' && !depth.refreshing ? describePrediction(depth.data) : undefined}
      busy={depth.kind === 'loading' || refreshing}
    >
      {depth.kind === 'loading' && <span className="skel skel-strip-wide" aria-hidden="true" />}
      {depth.kind === 'error' && <ErrorState title="Could not load the prediction" message={depth.error.message} onRetry={reload} />}
      {depth.kind === 'ready' && (
        <div className={refreshing ? 'figure-body refreshing' : 'figure-body'} aria-busy={refreshing || undefined}>
          <PredictionStrip predictedUm={depth.data.predictedUm} measuredUm={depth.data.measuredUm} missUm={depth.data.lotRmseUm} />
        </div>
      )}
      <details className="how">
        <summary>How this is counted</summary>
        <p>
          A ridge regression on every channel's phase means and spreads predicts the wafer's mean depth. The model that
          predicts this wafer was fitted on the other lots only, so it never saw this lot's depths. The lot's typical miss
          is the root mean square error over its measured wafers, all predicted the same way.{' '}
          <Link to="/lots">The lots page</Link> compares the model with two simpler guesses.
        </p>
      </details>
    </Figure>
  )
}

function MeasurementsView({ measurements }: { measurements: Measurements }) {
  const depths = measurements.values.map((site) => site.depthUm)
  return (
    <>
      {measurements.values.length === 0
        ? <p className="state">{`This wafer has no ${formatMeasurementSet(measurements.set)} measurements.`}</p>
        : (
          <WaferMap measurements={measurements}>
            <dl className="stats wafer-facts">
              <Stat label="Mean" value={formatMicrons(measurements.meanDepthUm)} />
              <Stat label="Spread (sd)" value={formatMicrons(measurements.sdDepthUm)} />
              <Stat label="Range" value={formatMicrons(Math.max(...depths) - Math.min(...depths))} />
              <Stat label="Sites" value={measurements.points} />
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
    </>
  )
}
