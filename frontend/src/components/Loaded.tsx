import type { ReactNode } from 'react'
import type { Resource } from '../api/useResource'

/** Renders a resource once it arrives, says so while it loads or when it fails, and dims it while it refreshes. */
export function Loaded<T>({ resource, children }: { resource: Resource<T>; children: (data: T) => ReactNode }) {
  switch (resource.kind) {
    case 'loading':
      return <p className="status-line" role="status">Loading…</p>
    case 'error':
      return <p className="status-line" role="alert">{resource.error.message}</p>
    case 'ready':
      return <div className={resource.refreshing ? 'resource refreshing' : 'resource'}>{children(resource.data)}</div>
    default: {
      const exhaustive: never = resource
      return exhaustive
    }
  }
}
