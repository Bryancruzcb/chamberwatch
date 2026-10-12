import type { ReactNode } from 'react'
import type { Resource } from '../api/useResource'

/** Renders a resource once it arrives, holds its place while it loads, says why it failed, and dims it while it refreshes. */
export function Loaded<T>({ resource, children }: { resource: Resource<T>; children: (data: T) => ReactNode }) {
  switch (resource.kind) {
    case 'loading':
      return (
        <div className="skeleton-block" role="status">
          <span className="visually-hidden">Loading…</span>
          <span className="skel skel-line" aria-hidden="true" />
          <span className="skel skel-line short" aria-hidden="true" />
          <span className="skel skel-panel" aria-hidden="true" />
        </div>
      )
    case 'error':
      return <p className="status-line" role="alert">{resource.error.message}</p>
    case 'ready':
      return (
        <div className={resource.refreshing ? 'resource refreshing' : 'resource'} aria-busy={resource.refreshing || undefined}>
          {children(resource.data)}
        </div>
      )
    default: {
      const exhaustive: never = resource
      return exhaustive
    }
  }
}
