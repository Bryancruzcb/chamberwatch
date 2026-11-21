import { Link } from 'react-router'

/** An address the app has no page for, or a run, lot or wafer link whose number is not a number. */
export function NotFound() {
  return (
    <section className="answer">
      <title>Not found · ChamberWatch</title>
      <h1>Nothing is at this address.</h1>
      <p className="answer-next">
        The link may be old, or mistyped. <Link to="/">Back to the runs</Link>
      </p>
    </section>
  )
}
