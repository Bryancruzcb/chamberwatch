import { Link } from 'react-router'

export function NotFound() {
  return (
    <>
      <title>Not found · ChamberWatch</title>
      <header className="page-head">
        <h1>Nothing here</h1>
      </header>
      <p>
        <Link to="/">Back to the runs</Link>
      </p>
    </>
  )
}
