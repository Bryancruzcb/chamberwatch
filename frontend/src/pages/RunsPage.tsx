import { type KeyboardEvent, useEffect, useMemo } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { type Baseline, lotsSchema, runsPageSchema, type Source } from '../api/schema'
import { readSource, withSource } from '../api/source'
import { useLotDrifts } from '../api/useLotDrifts'
import { useResource } from '../api/useResource'
import { Icon, type IconName } from '../components/Icon'
import { SourceSwitch } from '../components/SourceSwitch'
import { formatSource } from '../format'
import { headline, type RunsSummary, summarize, type TableOrder } from '../summary'
import { AttentionPanel } from './RunsAttention'
import { RunsTablePanel } from './RunsTable'

/** The three views of the page: the lots that need a look, every run, or the runs in range. */
type Tab = 'attention' | 'all' | 'in'

const TABS = [
  { id: 'attention', text: 'Needs a look', icon: 'alert' },
  { id: 'all', text: 'All runs', icon: 'layers' },
  { id: 'in', text: 'In range', icon: 'check' },
] as const satisfies ReadonlyArray<{ id: Tab; text: string; icon: IconName }>

const EMPTY_HINTS = {
  PUBLIC: 'The public wafers show up here once the ingest command has loaded them.',
  SYNTHETIC: 'The simulated wafers show up here once the simulate-lot command has stored them.',
  LIVE: 'A wafer recorded on the Live page shows up here when its run ends.',
} as const satisfies Record<Source, string>

interface View {
  readonly source: Source
  readonly tab: Tab
  readonly lotId: number | null
  readonly order: TableOrder
}

/**
 * The page the app opens to. It leads with the answer, in facts: how many runs are out of range and where, the lot
 * with the most of them, and which channel each one named first. Everything shown is derived from two answers of the
 * API, the source's runs and the lot list, plus each lot's drift; the view itself lives in the URL.
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

  return (
    <>
      <title>Runs · ChamberWatch</title>
      <section className="answer" aria-live="polite" aria-busy={!ready}>
        {page.kind === 'error'
          ? <AnswerText eyebrow={eyebrow(view.source, null)} lead="The runs did not load." />
          : summary === null || !ready
            ? <AnswerSkeleton />
            : <Answer source={view.source} baseline={page.kind === 'ready' ? page.data.baseline : null} summary={summary} />}
      </section>
      <div className="runs-bar">
        <Tabs tab={view.tab} summary={ready ? summary : null} onChoose={choose} />
        <SourceSwitch value={view.source} onChange={(next) => update({ source: next === 'PUBLIC' ? null : next, lot: null })} />
      </div>
      <div id="runs-panel" role="tabpanel" aria-labelledby={`tab-${view.tab}`} className="runs-panel">
        {page.kind === 'error'
          ? <ErrorState message={page.error.message} onRetry={reload} />
          : !ready || summary === null || page.kind !== 'ready'
            ? <PanelSkeleton />
            : summary.runs.length === 0
              ? <EmptyState source={view.source} />
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
  )
}

function eyebrow(source: Source, baseline: Baseline | null): string {
  const base = `Runs · ${formatSource(source)} wafers`
  return baseline === null ? base : `${base} · baseline #${baseline.id}, ${baseline.goodRuns} good runs`
}

function Answer({ source, baseline, summary }: { source: Source; baseline: Baseline | null; summary: RunsSummary }) {
  const said = headline(summary)
  const hasNext = said.startText !== '' || said.channelText !== null || said.detail !== null
  return (
    <>
      <p className="eyebrow">{eyebrow(source, baseline)}</p>
      <h1>{said.lead}</h1>
      {hasNext && (
        <p className="answer-next">
          {said.startStrong !== '' && <strong>{said.startStrong}</strong>}
          {said.startText}
          {said.channelText !== null && ` ${said.channelText}`}
          {said.detail}
        </p>
      )}
    </>
  )
}

function AnswerText({ eyebrow: line, lead }: { eyebrow: string; lead: string }) {
  return (
    <>
      <p className="eyebrow">{line}</p>
      <h1>{lead}</h1>
    </>
  )
}

function AnswerSkeleton() {
  return (
    <>
      <p className="eyebrow">Runs</p>
      <h1 className="visually-hidden">Runs</h1>
      <p className="visually-hidden" role="status">Loading runs</p>
      <span className="skel skel-title" aria-hidden="true" />
      <span className="skel skel-title short" aria-hidden="true" />
      <span className="skel skel-text" aria-hidden="true" />
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
          <Icon name={entry.icon} />
          {entry.text}
          {counts[entry.id] !== null && <span className="count">{counts[entry.id]}</span>}
        </button>
      ))}
    </div>
  )
}

function PanelSkeleton() {
  return (
    <div className="grid" aria-hidden="true">
      <span className="skel skel-card" />
      <span className="skel skel-card" />
      <span className="skel skel-card" />
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state-box" role="alert">
      <span className="chip out"><Icon name="alert" size={18} /></span>
      <div>
        <h2>Could not load the runs</h2>
        <p>{message}</p>
        <button type="button" className="button" onClick={onRetry}>
          <Icon name="refresh" />
          Try again
        </button>
      </div>
    </div>
  )
}

function EmptyState({ source }: { source: Source }) {
  return (
    <div className="state-box" role="status">
      <span className="chip ok"><Icon name="inbox" size={18} /></span>
      <div>
        <h2>Nothing to check</h2>
        <p>
          {EMPTY_HINTS[source]}
          {source === 'LIVE' && <>{' '}<Link to="/live">Open the Live page</Link></>}
        </p>
      </div>
    </div>
  )
}

/** A link to one lot's card, `/#lot-6`, scrolls to it once the cards are on the page. */
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
