import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { App, RouteError } from './App'
import './index.css'
import { NotFound } from './pages/NotFound'
import { RunPage } from './pages/RunPage'
import { RunsPage } from './pages/RunsPage'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <RunsPage /> },
      { path: 'runs/:runId', element: <RunPage /> },
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
