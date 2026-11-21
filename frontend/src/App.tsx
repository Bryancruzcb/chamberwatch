import { isRouteErrorResponse, Link, NavLink, Outlet, useMatch, useRouteError } from 'react-router'
import { ThemeToggle } from './components/ThemeToggle'

export function App() {
  return (
    <>
      <Masthead />
      <main className="page">
        <Outlet />
      </main>
    </>
  )
}

/** Shown when a page throws while rendering, in place of a blank screen. */
export function RouteError() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error ? error.message : 'The page failed to render.'
  return (
    <>
      <Masthead />
      <main className="page">
        <header className="page-head">
          <h1>Something went wrong</h1>
        </header>
        <p role="alert">{message}</p>
      </main>
    </>
  )
}

function Masthead() {
  // A run's page belongs under Runs, so the tab stays marked there too.
  const onRunsPage = useMatch({ path: '/', end: true }) !== null
  const onRunPage = useMatch('/runs/*') !== null
  const onRuns = onRunsPage || onRunPage
  return (
    <header className="masthead">
      <div className="masthead-in">
        <Link className="wordmark" to="/">
          <WaferGlyph />
          ChamberWatch
        </Link>
        <nav aria-label="Main">
          <Link to="/" className={onRuns ? 'active' : undefined} aria-current={onRuns ? 'page' : undefined}>Runs</Link>
          <NavLink to="/lots">Lots</NavLink>
          <NavLink to="/live">Live</NavLink>
        </nav>
        <ThemeToggle />
      </div>
    </header>
  )
}

/** The app's mark, also its favicon: a wafer, a ring with its flat, and a red dot for the one out of range. */
function WaferGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M5.3 18 A9 9 0 1 1 16.7 18 Z" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle className="glyph-dot" cx="11" cy="10.5" r="3.2" />
    </svg>
  )
}
