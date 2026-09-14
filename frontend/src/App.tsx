import { isRouteErrorResponse, Link, NavLink, Outlet, useMatch, useRouteError } from 'react-router'

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
  const onRunPage = useMatch('/runs/*') !== null
  return (
    <header className="masthead">
      <Link className="wordmark" to="/">ChamberWatch</Link>
      <nav aria-label="Main">
        <NavLink to="/" end className={({ isActive }) => (isActive || onRunPage ? 'active' : undefined)}>Runs</NavLink>
        <NavLink to="/lots">Lots</NavLink>
      </nav>
    </header>
  )
}
