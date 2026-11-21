import { Link } from 'react-router'
import { ApiError } from '../api/client'
import { ErrorState } from '../components/States'

/**
 * An address the app has no page for, a run, lot or wafer link whose number is not a number, or one the API has no
 * record of: a headline that says so and the way back.
 */
export function NotFound({ headline = 'Nothing is at this address.', back = { to: '/', label: 'Back to the runs' } }: {
  headline?: string
  back?: { readonly to: string; readonly label: string }
}) {
  return (
    <section className="answer">
      <title>Not found · ChamberWatch</title>
      <h1>{headline}</h1>
      <p className="answer-next">
        The link may be old, or mistyped. <Link to={back.to}>{back.label}</Link>
      </p>
    </section>
  )
}

/**
 * A run, lot or wafer page whose own record did not load. When the API has no such record (it answered 404), the
 * not-found page says so with the way back, since asking again cannot help. Any other failure says what the API said,
 * with a way to ask again, under a heading a screen reader meets first.
 */
export function PageFailure({ error, onRetry, missing, back, name, failed, title }: {
  error: Error
  onRetry: () => void
  /** The headline when there is no such record: "There is no run 9999." */
  missing: string
  back: { readonly to: string; readonly label: string }
  /** The page's hidden heading: "Run 9999". */
  name: string
  /** What did not load, as the error says it: "This run did not load". */
  failed: string
  /** The document title for any other failure. */
  title: string
}) {
  if (error instanceof ApiError && error.status === 404) {
    return <NotFound headline={missing} back={back} />
  }
  return (
    <div className="sheet">
      <title>{title}</title>
      <h1 className="visually-hidden">{name}</h1>
      <ErrorState title={failed} message={error.message} onRetry={onRetry} />
    </div>
  )
}
