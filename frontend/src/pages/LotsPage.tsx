import { useState } from 'react'
import { Link } from 'react-router'
import { type DriftVsDepth, driftVsDepthSchema, type Lot, lotsSchema, type MeasurementSet } from '../api/schema'
import { useResource } from '../api/useResource'
import { PositionChart, type PositionPoint, type PositionSeries } from '../charts/PositionChart'
import { Loaded } from '../components/Loaded'
import { formatConditioning, formatDate, formatMicrons, MISSING } from '../format'

const twoDecimals = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function LotsPage() {
  const [lots] = useResource('/api/lots', lotsSchema)
  const [report] = useResource('/api/reports/drift-vs-depth', driftVsDepthSchema)
  return (
    <>
      <title>Lots · ChamberWatch</title>
      <header className="page-head">
        <h1>Lots</h1>
        <p className="subtitle">The public lots, each started after a chamber clean, and how wafers change with their position in a lot.</p>
      </header>
      <Loaded resource={lots}>{(data) => <LotsTable lots={data.filter((lot) => lot.source === 'PUBLIC')} />}</Loaded>
      <Loaded resource={report}>{(data) => <DriftReport report={data} />}</Loaded>
    </>
  )
}

function LotsTable({ lots }: { lots: readonly Lot[] }) {
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
              <td className="num">{lot.flaggedRuns === 0 ? 0 : <Link to={`/?lot=${lot.id}&flagged=true`}>{lot.flaggedRuns}</Link>}</td>
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
      </p>
      <div className="chart-pair">
        <PositionChart
          title="Mean drift score"
          label="Mean drift score by wafer position"
          positions={positions}
          series={[score]}
          formatValue={(value) => twoDecimals.format(value)}
        />
        <PositionChart
          title="Depth loss, µm"
          label="Depth loss by wafer position"
          positions={positions}
          series={loss}
          formatValue={(value) => twoDecimals.format(value)}
        />
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
