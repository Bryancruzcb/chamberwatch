import { type CSSProperties, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  type DepthModel, depthModelSchema, type DriftVsDepth, driftVsDepthSchema, type Lot, lotsSchema, type MeasurementSet,
  runsPageSchema, type Source,
} from '../api/schema'
import { readSource, withSource } from '../api/source'
import { type Resource, useResource } from '../api/useResource'
import { PositionChart, type PositionPoint, type PositionSeries } from '../charts/PositionChart'
import { niceInterval, niceTicks, tickFormat } from '../charts/scale'
import { Disc } from '../components/Disc'
import { Figure } from '../components/Figure'
import { SourceSwitch } from '../components/SourceSwitch'
import { AnswerSkeleton, EmptySource, ErrorState } from '../components/States'
import {
  describeDepthModel, describeDepthTrend, describeEveryWafer, formatConditioning, formatDate, formatDepthFeature, formatDepthMethod,
  formatMicrons, formatShortScore, MISSING, splitAround, tieUnits,
} from '../format'
import { type GridRow, gridKinds, type LotGrid, lotGrid, rowSegments } from '../grid'
import { describeRunsByPosition, describeWaferKey, lotColumns, lotsAnswer, thinPositions } from '../lotSummary'
import { SOURCE_LINES } from '../sources'

const twoDecimals = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const threeDecimals = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

const STATE_WORDS = { out: 'out of range', in: 'in range', failed: 'not aligned', unscored: 'not scored' } as const

/** Lots are planned at 10 wafers, so the column holds ten slots until the runs say otherwise. */
const PLANNED = 10

type WafersStyle = CSSProperties & Record<'--positions' | '--base', number>
type SpanStyle = CSSProperties & Record<'--span', number>
type ShareStyle = CSSProperties & Record<'--share', number>

const spanStyle = (span: number): SpanStyle => ({ '--span': span })
const shareStyle = (share: number): ShareStyle => ({ '--share': share })

/**
 * Every lot of a source. The answer comes first, in facts: which lots hold the out-of-range runs. Then the lots as a
 * table with each lot's wafers as small discs, then how drift and depth move with a wafer's place in its lot, and for
 * the public wafers how well the telemetry predicts depth. The Source switch sits in the first figure's head, so it
 * keeps its place while a source loads.
 */
export function LotsPage() {
  const [params, setParams] = useSearchParams()
  const source = readSource(params)
  const [lots, reloadLots] = useResource('/api/lots', lotsSchema)
  const [runs, reloadRuns] = useResource(withSource('/api/runs', source), runsPageSchema)
  const [report, reloadReport] = useResource(withSource('/api/reports/drift-vs-depth', source), driftVsDepthSchema)
  const sourceLots = lots.kind === 'ready' ? lots.data.filter((lot) => lot.source === source) : null
  // the runs of the source just picked; the last source's runs never stand in for them
  const current = runs.kind === 'ready' && !runs.refreshing ? runs.data : null
  const failed = lots.kind === 'error'
  const empty = sourceLots !== null && sourceLots.length === 0
  const scored = current !== null ? current.baseline !== null : runs.kind === 'error' ? 'failed' : 'loading'
  const answer = sourceLots === null ? null : lotsAnswer(sourceLots, scored)
  const grid = current === null || sourceLots === null ? null : lotGrid(current.runs, sourceLots)
  return (
    <>
      <title>Lots · ChamberWatch</title>
      <section className="answer" aria-live="polite" aria-busy={lots.kind === 'loading'}>
        {failed
          ? <h1>The lots did not load.</h1>
          : answer === null
            ? <AnswerSkeleton name="Lots" />
            : (
                <>
                  <h1><KeepWhole text={tieUnits(answer.title)} phrase="out-of-range" /></h1>
                  {answer.lead !== null && <p className="answer-next">{tieUnits(answer.lead)}</p>}
                </>
              )}
      </section>
      <div className="sheet">
        <Figure
          id="lots"
          title="Every lot"
          numbered={!failed && !empty}
          busy={sourceLots === null && !failed}
          control={<SourceSwitch value={source} onChange={(next) => setParams(next === 'PUBLIC' ? {} : { source: next }, { replace: true })} />}
        >
          {lots.kind === 'error'
            ? <ErrorState title="Could not load the lots" message={lots.error.message} onRetry={reloadLots} />
            : sourceLots === null
              ? <span className="skel skel-lots" aria-hidden="true" />
              : empty
                ? <EmptySource source={source} />
                : <LotsTable lots={sourceLots} grid={grid} runsFailed={runs.kind === 'error'} onRetryRuns={reloadRuns} source={source} />}
        </Figure>
        {!empty && !failed && <DriftFigure report={report} onRetry={reloadReport} baseline={grid?.baseline ?? null} />}
        {source === 'PUBLIC' && !failed && (
          <DepthModelFigure reference={report.kind === 'ready' && !report.refreshing ? report.data.referenceWafers : null} />
        )}
      </div>
      {!empty && <p className="figure-source page-source">{SOURCE_LINES[source]}</p>}
    </>
  )
}

/** A sentence with one phrase held on a single line: "out-of-range" would otherwise break at a hyphen in a 36px headline. */
function KeepWhole({ text, phrase }: { text: string; phrase: string }) {
  const parts = splitAround(text, phrase)
  return parts === null ? text : <>{parts.before}<span className="keep-whole">{parts.phrase}</span>{parts.after}</>
}

/**
 * The lot list, each lot's wafers drawn as small discs from the source's runs: a bracket over the baseline positions
 * when every lot keeps them first, or a centre dot in each baseline disc when not. The discs wait for the runs; if they
 * fail, one line in the key's place says so and asks again, since the rest of the table needs only the lot list.
 */
function LotsTable({ lots, grid, runsFailed, onRetryRuns, source }: {
  lots: readonly Lot[]
  grid: LotGrid | null
  runsFailed: boolean
  onRetryRuns: () => void
  source: Source
}) {
  const positions = grid?.positions ?? PLANNED
  const bracket = grid?.baseline ?? null
  const style: WafersStyle = { '--positions': positions, '--base': bracket ?? 0 }
  const columns = lotColumns(lots)
  return (
    <>
      <div className="table-wrap">
        <table className="lots" style={style}>
          <caption className="visually-hidden">Every lot</caption>
          <thead>
            <tr>
              <th scope="col">Lot</th>
              {columns.date && <th scope="col" className="c-date">Date</th>}
              <th scope="col" className="c-wafers">
                {bracket !== null && <span className="wafers-bracket" aria-hidden="true" />}
                {`Wafers 1 to ${positions}`}
              </th>
              {columns.conditioning && <th scope="col" className="c-cond">Conditioning</th>}
              <th scope="col" className="num c-runs">Runs</th>
              <th scope="col" className="num c-out">Out of range</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => (
              <tr key={lot.id}>
                <th scope="row" className="c-lot"><Link className="lot-name" to={`/lots/${lot.id}`}>{`Lot ${lot.lotNo}`}</Link></th>
                {columns.date && <td className="c-date">{lot.runDate === null ? MISSING : formatDate(lot.runDate)}</td>}
                <td className="c-wafers">
                  {grid === null
                    ? (runsFailed ? null : <span className="skel skel-minis" aria-hidden="true" />)
                    : <MiniDiscs row={grid.rows.find((row) => row.lotId === lot.id) ?? null} bracket={bracket} />}
                </td>
                {columns.conditioning && (
                  <td className="c-cond">
                    {lot.conditioningCount === null || lot.conditioningSurface === null
                      ? MISSING
                      : formatConditioning(lot.conditioningCount, lot.conditioningSurface)}
                  </td>
                )}
                <td className="num c-runs">{lot.runs}</td>
                <td className={lot.flaggedRuns === 0 ? 'num c-out zero' : 'num c-out'}>
                  {/* the count opens the lot's rows in the runs page's out-of-range ledger */}
                  {lot.flaggedRuns === 0 ? 0 : <Link to={`${withSource('/', source)}#lot-${lot.id}`}>{lot.flaggedRuns}</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {grid !== null && <p className="figure-note lots-key">{describeWaferKey(gridKinds(grid), bracket)}</p>}
      {grid === null && runsFailed && (
        <p className="figure-note" role="alert">
          The wafers did not load.{' '}
          <button type="button" className="link-button" onClick={onRetryRuns}>Try again</button>
        </p>
      )}
    </>
  )
}

/**
 * One lot's wafers as 18px discs on 26px targets, with a dotted divider after the baseline and a dash where the lot ran
 * no wafer. Each disc links to its run but takes no tab stop: the lot's own page lists the same wafers as links, so the
 * keyboard meets one link per lot here rather than a hundred.
 */
function MiniDiscs({ row, bracket }: { row: GridRow | null; bracket: number | null }) {
  if (row === null) {
    return null
  }
  return (
    <span className="minis">
      {rowSegments(row, bracket).map((segment) => {
        if (segment.kind === 'gap') {
          return <span key="gap" className="mini-gap" aria-hidden="true" />
        }
        if (segment.kind === 'not-run') {
          const span = segment.to - segment.from + 1
          return (
            <span key={segment.from} className="mini-none" style={spanStyle(span)} data-kind="not-run">
              <span className="visually-hidden">{span === 1 ? `wafer ${segment.from} not run` : `wafers ${segment.from} to ${segment.to} not run`}</span>
            </span>
          )
        }
        const { run, state } = segment.cell
        const z = run.score?.persistentZ ?? null
        return (
          <Disc
            key={run.id}
            state={state}
            size="mini"
            baseline={bracket === null && run.good}
            to={`/runs/${run.id}`}
            tabIndex={-1}
            label={`Lot ${row.lotNo}, wafer ${run.positionInLot}: ${STATE_WORDS[state]}${z === null ? '' : `, how unusual ${formatShortScore(z)}`}${run.good ? ', baseline run' : ''}`}
            data={{ kind: 'mini' }}
          />
        )
      })}
    </span>
  )
}

/**
 * Drift and depth loss by wafer position, averaged over every lot of the source. `baseline` is how many first wafers of
 * every lot are the baseline runs, from the runs; null when they are not a common prefix or the runs are not in.
 */
function DriftFigure({ report, onRetry, baseline }: { report: Resource<DriftVsDepth>; onRetry: () => void; baseline: number | null }) {
  // while another source's report loads, the last one's answer would speak for the wrong wafers
  const settled = report.kind === 'ready' && !report.refreshing ? report.data : null
  const answer = settled === null ? null : describeDepthTrend(settled) ?? describeRunsByPosition(settled.positions)
  // a source with no measured depth draws the drift alone, so the title names only what is drawn
  const depthless = settled !== null && !settled.positions.some((position) => position.depth.length > 0)
  return (
    <Figure
      id="report"
      title={depthless ? 'Drift by wafer position' : 'Drift and depth by wafer position'}
      answer={answer}
      busy={report.kind === 'loading' || (report.kind === 'ready' && report.refreshing)}
    >
      {report.kind === 'loading' && <span className="skel skel-charts" aria-hidden="true" />}
      {report.kind === 'error' && <ErrorState title="Could not load the drift report" message={report.error.message} onRetry={onRetry} />}
      {report.kind === 'ready' && (
        <div className={report.refreshing ? 'figure-body refreshing' : 'figure-body'} aria-busy={report.refreshing || undefined}>
          <DriftReport report={report.data} baseline={baseline} />
        </div>
      )}
    </Figure>
  )
}

function DriftReport({ report, baseline }: { report: DriftVsDepth; baseline: number | null }) {
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
  if (score.points.length === 0) {
    return <p className="state">No wafer has a drift score yet, so there is nothing to place by position.</p>
  }
  const reference = `FIRST ${report.referenceWafers}`
  // a mean over one lot's wafer is not the drift of a position, so the highest one is not called out
  const thin = thinPositions(report.positions)
  const top = score.points.reduce<PositionPoint | null>((best, point) => (best === null || point.value > best.value ? point : best), null)
  const runsAt = (position: number) => report.positions.find((entry) => entry.position === position)?.runs ?? 0
  return (
    <>
      {!measured && <p className="figure-note">Simulated wafers have no measured depth, so only the drift score is shown.</p>}
      <div className="chart-pair">
        <PositionChart
          title="Mean drift score"
          label="Mean drift score by wafer position"
          positions={positions}
          series={[score]}
          baseline={baseline === report.referenceWafers ? baseline : null}
          labelEnds
          peak={top !== null && !thin.includes(top.position)}
          formatValue={(value) => twoDecimals.format(value)}
          details={(position) => [['Runs', String(runsAt(position))]]}
        />
        {measured && (
          <PositionChart
            title="Depth loss, µm"
            label="Depth loss by wafer position"
            positions={positions}
            series={loss}
            baseline={report.referenceWafers}
            zoneLabel={reference}
            labelEnds
            formatValue={(value) => twoDecimals.format(value)}
          />
        )}
      </div>
      <div className="figure-links">
        <button type="button" className="link-button" aria-expanded={tableShown} onClick={() => setTableShown(!tableShown)}>
          {tableShown ? 'Hide the table' : 'Show as a table'}
        </button>
        <details className="how">
          <summary>How this is counted</summary>
          <p>
            {`A position averages every lot that ran a wafer there. A run's drift score is the root mean square of its channels' SF6 phase mean
            z-scores. Depth loss is how much shallower a wafer etched than the mean of the first ${report.referenceWafers}
            wafers of its lot. The two measurement sets come from different instruments, so each keeps its own line.`}
          </p>
        </details>
      </div>
      {tableShown && <ReportTable report={report} />}
    </>
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
            <th scope="col" className="num">Out of range</th>
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

/**
 * Depth predicted from the telemetry against measured depth, and how the model compares with two simpler guesses.
 * `reference` is how many first wafers of a lot the depth is measured against, null until the drift report says.
 */
function DepthModelFigure({ reference }: { reference: number | null }) {
  const [model, reload] = useResource('/api/reports/depth-model', depthModelSchema)
  const answer = model.kind === 'ready' ? describeDepthModel(model.data) : null
  return (
    <Figure id="depth-model" title="Depth predicted from the telemetry" answer={answer} busy={model.kind === 'loading'}>
      {model.kind === 'loading' && <span className="skel skel-charts" aria-hidden="true" />}
      {model.kind === 'error' && <ErrorState title="Could not load the depth model" message={model.error.message} onRetry={reload} />}
      {model.kind === 'ready' && <DepthModelReport model={model.data} reference={reference} />}
    </Figure>
  )
}

function DepthModelReport({ model, reference }: { model: DepthModel; reference: number | null }) {
  const [tableShown, setTableShown] = useState(false)
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
  const every = describeEveryWafer(model)
  return (
    <div className="depth-model">
      <div className="depth-main">
        <PositionChart
          title="Mean depth, µm"
          label="Measured and predicted mean depth by wafer position"
          positions={positions}
          series={series}
          baseline={reference}
          zoneLabel={`FIRST ${reference ?? 0}`}
          labelEnds
          formatValue={(value) => twoDecimals.format(value)}
        />
        <div className="figure-links">
          <button type="button" className="link-button" aria-expanded={tableShown} onClick={() => setTableShown(!tableShown)}>
            {tableShown ? 'Hide the table' : 'Show as a table'}
          </button>
        </div>
        {tableShown && <DepthModelTable model={model} />}
      </div>
      <div className="depth-side">
        <MissBars model={model} reference={reference} />
        {every !== null && <p className="figure-note">{every}</p>}
        <h3 className="side-title">What the model leans on</h3>
        <ol className="leans">
          {model.strongest.slice(0, 5).map((coefficient, index) => (
            <li key={coefficient.feature}>
              <span className="lean-rank">{index + 1}</span>
              <span className="lean-name">{formatDepthFeature(coefficient.feature)}</span>
              <span className="lean-value">
                {`${coefficient.perSdUm < 0 ? '−' : '+'}${threeDecimals.format(Math.abs(coefficient.perSdUm))} µm`}
              </span>
            </li>
          ))}
        </ol>
        <p className="figure-note">Change in depth per standard deviation of each feature, in the model fitted on every lot.</p>
        <details className="how">
          <summary>How this is counted</summary>
          <p>
            {`A ridge regression on ${model.features} phase means and spreads predicts each wafer's mean ${model.set === 'NINE_POINT' ? '9' : '89'}-point
            depth. Every lot is predicted by a model fitted on the other lots only, with its penalty chosen the same way inside
            them, so no lot takes part in its own prediction. ${model.wafers} measured wafers in ${model.lots} lots.`}
          </p>
          <p>
            The errors are root mean square errors. The first wafers' guess needs those wafers' own depth, so it only scores
            the ones after them.
          </p>
        </details>
      </div>
    </div>
  )
}

function DepthModelTable({ model }: { model: DepthModel }) {
  return (
    <div className="table-wrap">
      <table>
        <caption className="visually-hidden">Measured and predicted mean depth by wafer position</caption>
        <thead>
          <tr>
            <th scope="col" className="num">Position</th>
            <th scope="col" className="num">Wafers</th>
            <th scope="col" className="num">Measured, µm</th>
            <th scope="col" className="num">Predicted, µm</th>
          </tr>
        </thead>
        <tbody>
          {model.byPosition.map((position) => (
            <tr key={position.position}>
              <td className="num">{position.position}</td>
              <td className="num">{position.wafers}</td>
              <td className="num">{twoDecimals.format(position.meanMeasuredUm)}</td>
              <td className="num">{twoDecimals.format(position.meanPredictedUm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Each guess's miss on the wafers every guess can score, as bars on one scale with the value at each bar's end. The
 * worst is drawn hollow, so the order never rests on length alone.
 */
function MissBars({ model, reference }: { model: DepthModel; reference: number | null }) {
  const misses = model.methods.map((method) => ({ method: method.method, um: method.late.rmseUm }))
  const worst = Math.max(...misses.map((miss) => miss.um))
  const end = niceInterval([0, Math.max(worst, 0.1)], 4)[1]
  const share = (um: number) => um / end
  const ticks = niceTicks([0, end], 4)
  const tickText = tickFormat(ticks)
  return (
    <table className="miss-bars">
      <caption>
        How far each guess misses
        <span className="caption-note">
          {`Wafers after ${reference === null ? "each lot's first wafers" : `the first ${reference}`}, root mean square error.`}
        </span>
      </caption>
      <tbody>
        {misses.map((miss) => (
          <tr key={miss.method} className={miss.um === worst && misses.length > 1 ? 'worst' : undefined}>
            <th scope="row">{formatDepthMethod(miss.method)}</th>
            <td>
              <span className="miss-track" style={shareStyle(share(miss.um))}>
                <span className="miss-bar" aria-hidden="true" />
                <span className="miss-value">{formatMicrons(miss.um)}</span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot aria-hidden="true">
        <tr>
          <td />
          <td>
            <span className="miss-axis">
              {ticks.map((tick) => (
                <span key={tick} className="miss-tick" style={shareStyle(share(tick))}>{tickText(tick)}</span>
              ))}
            </span>
          </td>
        </tr>
      </tfoot>
    </table>
  )
}
