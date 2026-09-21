import type { z } from 'zod'
import { problemSchema } from './schema'

/** A call that failed, carrying the server's own explanation when it sent one. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function getJson<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  return request(path, { signal }, schema)
}

export function putJson<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  return request(path, { method: 'PUT', headers, body: JSON.stringify(body) }, schema)
}

export function postJson<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  return request(path, { method: 'POST', headers, body: JSON.stringify(body) }, schema)
}

export function deleteJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return request(path, { method: 'DELETE' }, schema)
}

async function request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  const response = await fetch(path, { ...init, headers })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const problem = problemSchema.safeParse(body)
    const explanation = problem.success ? (problem.data.detail ?? problem.data.title) : undefined
    throw new ApiError(response.status, explanation ?? `${response.status} ${response.statusText}`)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ApiError(response.status, `Unexpected answer from ${path}: ${issue?.message ?? 'invalid JSON'}`)
  }
  return parsed.data
}
