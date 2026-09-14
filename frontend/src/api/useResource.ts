import { useCallback, useEffect, useState } from 'react'
import type { z } from 'zod'
import { getJson } from './client'

export type Resource<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; data: T; refreshing: boolean }
  | { kind: 'error'; error: Error }

/** The last answer that arrived, tagged with the request it answered. */
type Settled<T> = { request: string } & ({ kind: 'ready'; data: T } | { kind: 'error'; error: Error })

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
          setSettled({ request, kind: 'ready', data })
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setSettled({ request, kind: 'error', error: error instanceof Error ? error : new Error(String(error)) })
        }
      },
    )
    return () => controller.abort()
  }, [request, path, schema])

  const reload = useCallback(() => setVersion((current) => current + 1), [])
  return [resourceFor(settled, request), reload]
}

function resourceFor<T>(settled: Settled<T> | null, request: string): Resource<T> {
  if (settled === null) {
    return { kind: 'loading' }
  }
  if (settled.kind === 'error') {
    return settled.request === request ? { kind: 'error', error: settled.error } : { kind: 'loading' }
  }
  return { kind: 'ready', data: settled.data, refreshing: settled.request !== request }
}
