import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  type DepthModel, depthModelSchema, type DriftVsDepth, driftVsDepthSchema, type Lot, lotsSchema, type MeasurementSet, type Source,
} from '../api/schema'
import { readSource, withSource } from '../api/source'
import { useResource } from '../api/useResource'
import { PositionChart, type PositionPoint, type PositionSeries } from '../charts/PositionChart'
import { Loaded } from '../components/Loaded'
import { SourceSwitch } from '../components/SourceSwitch'
import { formatConditioning, formatDate, formatDepthFeature, formatDepthMethod, formatMicrons, MISSING } from '../format'

const twoDecimals = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const threeDecimals = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

const SUBTITLES = {
  PUBLIC: 'The public lots, each started after a chamber clean, and how wafers change with their position in a lot.',
  SYNTHETIC: 'The simulated lots: the clean training lots the baseline learns from, and the lot with known faults.',
} as const satisfies Record<Source, string>

export function LotsPage() {
  const [params, setParams] = useSearchParams()
  const source = readSource(params)
  const [lots] = useResource('/api/lots', lotsSchema)
  const [report] = useResource(withSource('/api/reports/drift-vs-depth', source), driftVsDepthSchema)
  return (
    <>
      <title>Lots · ChamberWatch</title>
      <header className="page-head">
        <h1>Lots</h1>
        <p className="subtitle">{SUBTITLES[source]}</p>
      </header>
      <div className="filters">
        <SourceSwitch
          value={source}
          onChange={(next) => setParams(next === 'PUBLIC' ? {} : { source: next }, { replace: true })}
        />
      </div>
      <Loaded resource={lots}>{(data) => <LotsTable lots={data.filter((lot) => lot.source === source)} source={source} />}</Loaded>
      <Loaded resource={report}>{(data) => <DriftReport report={data} />}</Loaded>
      {source === 'PUBLIC' && <DepthModelPanel />}
    </>
  )
}

/** Depth predicted from the telemetry against measured depth, and how the model compares with two baselines. */
function DepthModelPanel() {
  const [model] = useResource('/api/reports/depth-model', depthModelSchema)
  return <Loaded resource={model}>{(data) => <DepthModelReport model={data} />}</Loaded>
}

function DepthModelReport({ model }: { model: DepthModel }) {
  const positions = Math.max(0, ...model.byPosition.map((position) => position.position))
  const series: PositionSeries[] = [
    {
      id: 'measured',
      name: 'Measured',
      slot: 1,
      connect: true,
      points: model.byPosition.map((position) => ({ position: position.position, value: position.meanMeasuredUm })),
    },
    {
      id: 'predicted',
      name: 'Predicted',
      slot: 2,
      connect: true,
      points: model.byPosition.map((position) => ({ position: position.position, value: position.meanPredictedUm })),
    },
  ]
  return (
    <section className="panel" aria-labelledby="depth-model-title">
      <h2 id="depth-model-title">Depth predicted from the telemetry</h2>
      <p className="note">
        {`A ridge regression on ${model.features} phase means and spreads predicts each wafer's mean ${model.set === 'NINE_POINT' ? '9' : '89'}-point
        depth. Every lot is predicted by a model fitted on the other lots only, with its penalty chosen the same way inside
        them, so no lot takes part in its own prediction. ${model.wafers} measured wafers in ${model.lots} lots.`}
      </p>
      <PositionChart
        title="Mean depth, µm"
        label="Measured and predicted mean depth by wafer position"
        positions={positions}
        series={series}
        formatValue={(value) => twoDecimals.format(value)}
      />
      <div className="table-wrap">
        <table>
          <caption>Error of each way to guess a wafer's depth</caption>
          <thead>
            <tr>
              <th scope="col">Guess</th>
              <th scope="col" className="num">Every measured wafer</th>
              <th scope="col" className="num">Wafers after the first three</th>
            </tr>
          </thead>
          <tbody>
            {model.methods.map((method) => (
              <tr key={method.method}>
                <th scope="row">{formatDepthMethod(method.method)}</th>
                <td className="num">{method.all === null ? MISSING : formatMicrons(method.all.rmseUm)}</td>
                <td className="num">{formatMicrons(method.late.rmseUm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Root mean square error. The first wafers' guess needs those wafers' own depth, so it only scores the ones after
        them. The features that weigh most in the model fitted on every lot, per standard deviation:
      </p>
      <ol className="features">
        {model.strongest.slice(0, 5).map((coefficient) => (
          <li key={coefficient.feature}>
            {`${formatDepthFeature(coefficient.feature)}: ${coefficient.perSdUm < 0 ? '−' : '+'}${threeDecimals.format(Math.abs(coefficient.perSdUm))} µm`}
          </li>
        ))}
      </ol>
    </section>
  )
}

function LotsTable({ lots, source }: { lots: readonly Lot[]; source: Source }) {
  return (
    <div className="panel table-wrap">
      <table className="lots">
        <caption className="visually-hidden">Lots</caption>
        <thead>
          <tr>
            <th scope="col">Lot</th>
            <th scope="col">Date</th>
            <th scope="col">Conditioning</th>
            <th scope="col" className="num">Runs</th>
            <th scope="col" className="num">Flagged</th>
          </tr>
        </thead>
        <tbody>
          {lots.map((lot) => (
            <tr key={lot.id}>
              <td><Link to={`/lots/${lot.id}`}>{`Lot ${lot.lotNo}`}</Link></td>
              <td>{lot.runDate === null ? MISSING : formatDate(lot.runDate)}</td>
              <td>
                {lot.conditioningCount === null || lot.conditioningSurface === null
                  ? MISSING
                  : formatConditioning(lot.conditioningCount, lot.conditioningSurface)}
              </td>
              <td className="num">{lot.runs}</td>
              <td className="num">
                {lot.flaggedRuns === 0 ? 0 : <Link to={withSource(`/?lot=${lot.id}&flagged=true`, source)}>{lot.flaggedRuns}</Link>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DriftReport({ report }: { report: DriftVsDepth }) {
  const [tableShown, setTableShown] = useState(false)
  const positions = Math.max(0, ...report.positions.map((position) => position.position))
  const measured = report.positions.some((position) => position.depth.length > 0)
  const score: PositionSeries = {
    id: 'score',
    name: 'Mean drift score',
    slot: 1,
    connect: true,
    points: report.positions.flatMap((position) => (position.meanDriftScore === null
      ? []
      : [{ position: position.position, value: position.meanDriftScore }])),
  }
  const loss: PositionSeries[] = [
    { id: 'EIGHTY_NINE_POINT', name: '89-point', slot: 1, connect: true, points: lossPoints(report, 'EIGHTY_NINE_POINT') },
    { id: 'NINE_POINT', name: '9-point', slot: 2, connect: true, points: lossPoints(report, 'NINE_POINT') },
  ]
  return (
    <section className="panel" aria-labelledby="report-title">
      <h2 id="report-title">Drift and depth by wafer position</h2>
      <p className="note">
        {`Each position averages every lot. A run's drift score is the root mean square of its channels' SF6 phase mean
        z-scores. Depth loss is how much shallower a wafer etched than the mean of the first ${report.referenceWafers}
        wafers of its lot. The two measurement sets come from different instruments, so each keeps its own line.`}
        {!measured && ' Simulated wafers have no measured depth, so only the drift score is shown.'}
      </p>
      <div className="chart-pair">
        <PositionChart
          title="Mean drift score"
          label="Mean drift score by wafer position"
          positions={positions}
          series={[score]}
          formatValue={(value) => twoDecimals.format(value)}
        />
        {measured && (
          <PositionChart
            title="Depth loss, µm"
            label="Depth loss by wafer position"
            positions={positions}
            series={loss}
            formatValue={(value) => twoDecimals.format(value)}
          />
        )}
      </div>
      <button type="button" className="link-button" aria-expanded={tableShown} onClick={() => setTableShown(!tableShown)}>
        {tableShown ? 'Hide the table' : 'Show as a table'}
      </button>
      {tableShown && <ReportTable report={report} />}
    </section>
  )
}

function ReportTable({ report }: { report: DriftVsDepth }) {
  return (
    <div className="table-wrap">
      <table>
        <caption className="visually-hidden">Drift and depth by wafer position</caption>
        <thead>
          <tr>
            <th scope="col" className="num">Position</th>
            <th scope="col" className="num">Runs</th>
            <th scope="col" className="num">Flagged</th>
            <th scope="col" className="num">Mean drift score</th>
            <th scope="col" className="num">89-point loss</th>
            <th scope="col" className="num">Wafers</th>
            <th scope="col" className="num">9-point loss</th>
            <th scope="col" className="num">Wafers</th>
          </tr>
        </thead>
        <tbody>
          {report.positions.map((position) => {
            const eightyNine = position.depth.find((depth) => depth.set === 'EIGHTY_NINE_POINT')
            const nine = position.depth.find((depth) => depth.set === 'NINE_POINT')
            return (
              <tr key={position.position}>
                <td className="num">{position.position}</td>
                <td className="num">{position.runs}</td>
                <td className="num">{position.flaggedRuns}</td>
                <td className="num">{position.meanDriftScore === null ? MISSING : twoDecimals.format(position.meanDriftScore)}</td>
                <td className="num">{formatMicrons(eightyNine?.meanDepthLossUm ?? null)}</td>
                <td className="num">{eightyNine?.wafers ?? 0}</td>
                <td className="num">{formatMicrons(nine?.meanDepthLossUm ?? null)}</td>
                <td className="num">{nine?.wafers ?? 0}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function lossPoints(report: DriftVsDepth, set: MeasurementSet): PositionPoint[] {
  return report.positions.flatMap((position) => {
    const depth = position.depth.find((entry) => entry.set === set)
    return depth === undefined || depth.meanDepthLossUm === null
      ? []
      : [{ position: position.position, value: depth.meanDepthLossUm }]
  })
}
