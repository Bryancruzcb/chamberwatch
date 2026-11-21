import { Link } from 'react-router'
import type { Source } from '../api/schema'
import { EMPTY_HINTS } from '../sources'
import { Icon } from './Icon'

/** What the API said when something did not load, in the place of the figure it would fill, with a way to ask again. */
export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="state" role="alert">
      <p className="state-title">{title}</p>
      <p>{message}</p>
      <button type="button" className="button" onClick={onRetry}>
        <Icon name="refresh" />
        Try again
      </button>
    </div>
  )
}

/**
 * What a page shows where its source has no wafers yet: how that source fills, and the way to the Live page when that
 * is where its wafers come from. No title, since the page's h1 above already says the source is empty.
 */
export function EmptySource({ source }: { source: Source }) {
  return (
    <div className="state" role="status">
      <p>
        {EMPTY_HINTS[source]}
        {source === 'LIVE' && <>{' '}<Link to="/live">Open the Live page</Link></>}
      </p>
    </div>
  )
}

/**
 * A page's answer while the data it states loads: two lines of headline and one of lead at their own heights, so the
 * page does not jump when the sentence arrives. `name` is the hidden heading a screen reader meets meanwhile.
 */
export function AnswerSkeleton({ name, lead = true }: { name: string; lead?: boolean }) {
  return (
    <>
      <h1 className="visually-hidden">{name}</h1>
      <p className="visually-hidden" role="status">{`Loading ${name.toLowerCase()}`}</p>
      <span className="skel skel-title" aria-hidden="true" />
      <span className="skel skel-title short" aria-hidden="true" />
      {lead && <span className="skel skel-lead" aria-hidden="true" />}
    </>
  )
}
