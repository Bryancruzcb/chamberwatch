import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { App, RouteError } from './App'
import './index.css'
import { LotPage } from './pages/LotPage'
import { LotsPage } from './pages/LotsPage'
import { NotFound } from './pages/NotFound'
import { RunPage } from './pages/RunPage'
import { RunsPage } from './pages/RunsPage'
import { WaferPage } from './pages/WaferPage'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <RunsPage /> },
      { path: 'runs/:runId', element: <RunPage /> },
      { path: 'runs/:runId/wafer', element: <WaferPage /> },
      { path: 'lots', element: <LotsPage /> },
      { path: 'lots/:lotId', element: <LotPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

const root = document.getElementById('root')
if (root === null) {
  throw new Error('index.html has no #root element')
}
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
