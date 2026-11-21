import { useCallback, useEffect, useState } from 'react'
import type { z } from 'zod'
import { getJson } from './client'

export type Resource<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; data: T; refreshing: boolean }
  /** `last` is the newest answer this path had before it failed, for a view that would rather keep it than go blank. */
  | { kind: 'error'; error: Error; last: T | null }

/** The last answer that arrived, tagged with the request and the path it answered. */
type Settled<T> = { request: string; path: string } & ({ kind: 'ready'; data: T } | { kind: 'error'; error: Error; last: T | null })

/**
 * Loads a path and keeps it loaded. A new path or a reload keeps the previous answer on screen, marked refreshing,
 * until the next one arrives, so a page never flashes back to empty.
 */
export function useResource<T>(path: string, schema: z.ZodType<T>): [Resource<T>, () => void] {
  const [version, setVersion] = useState(0)
  const [settled, setSettled] = useState<Settled<T> | null>(null)
  const request = `${version} ${path}`

  useEffect(() => {
    const controller = new AbortController()
    getJson(path, schema, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          setSettled({ request, path, kind: 'ready', data })
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          const failure = error instanceof Error ? error : new Error(String(error))
          setSettled((previous) => ({ request, path, kind: 'error', error: failure, last: lastAnswer(previous, path) }))
        }
      },
    )
    return () => controller.abort()
  }, [request, path, schema])

  const reload = useCallback(() => setVersion((current) => current + 1), [])
  return [resourceFor(settled, request), reload]
}

/** The newest answer the same path had, carried through any failures since. */
function lastAnswer<T>(previous: Settled<T> | null, path: string): T | null {
  if (previous === null || previous.path !== path) {
    return null
  }
  return previous.kind === 'ready' ? previous.data : previous.last
}

function resourceFor<T>(settled: Settled<T> | null, request: string): Resource<T> {
  if (settled === null) {
    return { kind: 'loading' }
  }
  if (settled.kind === 'error') {
    return settled.request === request ? { kind: 'error', error: settled.error, last: settled.last } : { kind: 'loading' }
  }
  return { kind: 'ready', data: settled.data, refreshing: settled.request !== request }
}
