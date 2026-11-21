import { type KeyboardEvent, useEffect, useMemo } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { lotsSchema, runsPageSchema, type Source } from '../api/schema'
import { readSource, withSource } from '../api/source'
import { useLotDrifts } from '../api/useLotDrifts'
import { useResource } from '../api/useResource'
import { LotGrid, LotGridSkeleton } from '../charts/LotGrid'
import { Figure } from '../components/Figure'
import { SourceSwitch } from '../components/SourceSwitch'
import { AnswerSkeleton, ErrorState } from '../components/States'
import { EMPTY_HINTS } from '../sources'
import { headline, type RunsSummary, summarize, type TableOrder } from '../summary'
import { AttentionPanel } from './RunsAttention'
import { RunsTablePanel } from './RunsTable'

/** The three views of the page: the lots that need a look, every run, or the runs in range. */
type Tab = 'attention' | 'all' | 'in'

const TABS = [
  { id: 'attention', text: 'Needs a look' },
  { id: 'all', text: 'All runs' },
  { id: 'in', text: 'In range' },
] as const satisfies ReadonlyArray<{ id: Tab; text: string }>

interface View {
  readonly source: Source
  readonly tab: Tab
  readonly lotId: number | null
  readonly order: TableOrder
}

/**
 * The page the app opens to. It leads with the answer, in facts: how many runs are out of range and where, and the lot
 * with the most of them; then every wafer as a cassette map, and the figures that explain the out-of-range runs.
 * Everything shown is derived from two answers of the API, the source's runs and the lot list, plus each lot's drift;
 * the view itself lives in the URL.
 */
export function RunsPage() {
  const [params, setParams] = useSearchParams()
  const view = readView(params)
  const [lots] = useResource('/api/lots', lotsSchema)
  const [page, reload] = useResource(withSource('/api/runs', view.source), runsPageSchema)
  // a new source keeps the old runs on hand until its own arrive; they never stand in for the new source's answer
  const summary = useMemo(() => {
    if (page.kind !== 'ready' || page.refreshing) {
      return null
    }
    const known = lots.kind === 'ready' ? lots.data.filter((lot) => lot.source === view.source) : []
    return summarize(page.data.runs, known)
  }, [page, lots, view.source])
  const drifts = useLotDrifts(summary === null ? [] : summary.lots.map((group) => group.lotId))
  // the lot list only adds dates and conditioning, so the page waits for it but does without it if it fails
  const ready = page.kind === 'ready' && lots.kind !== 'loading' && summary !== null

  function update(changes: Record<string, string | null>) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) {
          next.delete(key)
        }
        else {
          next.set(key, value)
        }
      }
      return next
    }, { replace: true, preventScrollReset: true })
  }

  function choose(tab: Tab) {
    // a lot filter belongs to the table, and a link with a lot opens the table, so leaving the table drops it
    update(tab === 'attention' ? { show: null, lot: null, flagged: null } : { show: tab, flagged: null })
  }

  useScrollToHash(ready && view.tab === 'attention')
  const failed = page.kind === 'error'
  const empty = ready && summary.runs.length === 0

  return (
    <>
      <title>Runs · ChamberWatch</title>
      <section className="answer" aria-live="polite" aria-busy={!ready && !failed}>
        {failed
          ? <h1>The runs did not load.</h1>
          : !ready
            ? <AnswerSkeleton name="Runs" />
            : <Answer summary={summary} />}
      </section>
      {/* one figure throughout, so the Source switch keeps its place and its focus while a source loads */}
      <Figure
        id="lot-grid"
        className="lot-grid"
        title="Every wafer, lot by lot"
        numbered={!failed && !empty}
        busy={!ready && !failed}
        control={<SourceSwitch value={view.source} onChange={(next) => update({ source: next === 'PUBLIC' ? null : next, lot: null })} />}
      >
        {page.kind === 'error'
          ? <ErrorState title="Could not load the runs" message={page.error.message} onRetry={reload} />
          : !ready || page.kind !== 'ready'
            ? <LotGridSkeleton source={view.source} />
            : summary.runs.length === 0
              ? <EmptyState source={view.source} />
              : (
                  <LotGrid
                    runs={summary.runs}
                    lots={lots.kind === 'ready' ? lots.data.filter((lot) => lot.source === view.source) : []}
                    k={page.data.baseline?.k ?? null}
                    source={view.source}
                  />
                )}
      </Figure>
      {!failed && !empty && (
        <>
          <Tabs tab={view.tab} summary={ready ? summary : null} onChoose={choose} />
          <div id="runs-panel" role="tabpanel" aria-labelledby={`tab-${view.tab}`} className="runs-panel">
            {!ready || page.kind !== 'ready'
              ? <PanelSkeleton />
              : view.tab === 'attention'
                ? <AttentionPanel key={view.source} summary={summary} baseline={page.data.baseline} drifts={drifts} source={view.source} />
                : (
                    <RunsTablePanel
                      key={`${view.source} ${view.tab}`}
                      summary={summary}
                      baseline={page.data.baseline}
                      inRangeOnly={view.tab === 'in'}
                      lotId={view.lotId}
                      order={view.order}
                      onLot={(lotId) => update({ lot: lotId === null ? null : String(lotId) })}
                      onOrder={(order) => update({ order: order === 'out' ? null : order })}
                    />
                  )}
          </div>
        </>
      )}
    </>
  )
}

function Answer({ summary }: { summary: RunsSummary }) {
  const said = headline(summary)
  const next = said.startText !== '' || said.detail !== null
  return (
    <>
      <h1>
        {said.signal === null
          ? said.lead
          : <><span className="signal-count">{said.signal}</span>{said.lead.slice(said.signal.length)}</>}
      </h1>
      {next && (
        <p className="answer-next">
          {said.startStrong !== '' && <strong>{said.startStrong}</strong>}
          {said.startText}
          {said.detail}
        </p>
      )}
    </>
  )
}

function Tabs({ tab, summary, onChoose }: { tab: Tab; summary: RunsSummary | null; onChoose: (tab: Tab) => void }) {
  const counts: Record<Tab, number | null> = summary === null
    ? { attention: null, all: null, in: null }
    : { attention: summary.out.length, all: summary.runs.length, in: summary.inRange }

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) {
      return
    }
    event.preventDefault()
    const index = TABS.findIndex((entry) => entry.id === tab)
    const next = TABS[(index + step + TABS.length) % TABS.length]
    if (next !== undefined) {
      onChoose(next.id)
      document.getElementById(`tab-${next.id}`)?.focus()
    }
  }

  return (
    <div className="tabs" role="tablist" aria-label="Runs to show" onKeyDown={move}>
      {TABS.map((entry) => (
        <button
          key={entry.id}
          id={`tab-${entry.id}`}
          type="button"
          role="tab"
          className="tab"
          aria-selected={entry.id === tab}
          aria-controls="runs-panel"
          tabIndex={entry.id === tab ? 0 : -1}
          onClick={() => onChoose(entry.id)}
        >
          {entry.text}
          {counts[entry.id] !== null && <span className="count">{counts[entry.id]}</span>}
        </button>
      ))}
    </div>
  )
}

/** The "Needs a look" figures' places: two figure heads over the shapes of a cluster row and a ledger. */
function PanelSkeleton() {
  return (
    <div className="panel-skeleton" aria-hidden="true">
      <div className="figure">
        <span className="skel skel-head" />
        <span className="skel skel-lead" />
        <span className="skel skel-clusters" />
      </div>
      <div className="figure">
        <span className="skel skel-head" />
        <span className="skel skel-lead" />
        <span className="skel skel-ledger" />
      </div>
    </div>
  )
}

function EmptyState({ source }: { source: Source }) {
  return (
    <div className="state" role="status">
      <p className="state-title">Nothing to check</p>
      <p>
        {EMPTY_HINTS[source]}
        {source === 'LIVE' && <>{' '}<Link to="/live">Open the Live page</Link></>}
      </p>
    </div>
  )
}

/** A link to one lot, `/#lot-6`, scrolls to its rows in the out-of-range ledger once they are on the page. */
function useScrollToHash(shown: boolean) {
  const { hash } = useLocation()
  useEffect(() => {
    if (shown && hash.length > 1) {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView()
    }
  }, [shown, hash])
}

/**
 * The view in the URL. A link with a lot, like the run page's "Lot 6", opens the table on that lot. Links from before
 * the tabs keep working: `flagged=false` opens the runs in range and `flagged=true` opens the table.
 */
function readView(params: URLSearchParams): View {
  const lot = params.get('lot')
  const lotId = lot !== null && /^\d+$/.test(lot) ? Number(lot) : null
  const show = params.get('show')
  const flagged = params.get('flagged')
  const tab: Tab = show === 'all' || show === 'in'
    ? show
    : flagged === 'false' ? 'in' : lotId !== null || flagged === 'true' ? 'all' : 'attention'
  const order = params.get('order')
  return {
    source: readSource(params),
    tab,
    lotId,
    order: order === 'z' || order === 'lot' ? order : 'out',
  }
}
