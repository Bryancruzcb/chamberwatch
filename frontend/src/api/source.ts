import { type Source, sourceSchema } from './schema'

/** The source a page shows. The public one is the default, so public links keep their old spelling. */
export function readSource(params: URLSearchParams): Source {
  const parsed = sourceSchema.safeParse(params.get('source'))
  return parsed.success ? parsed.data : 'PUBLIC'
}

/** The query that keeps a link on the source, empty for the public one. */
export function sourceQuery(source: Source): string {
  return source === 'PUBLIC' ? '' : `source=${source}`
}

/** A path with the source query added when it is not the public one. */
export function withSource(path: string, source: Source): string {
  const query = sourceQuery(source)
  return query === '' ? path : `${path}${path.includes('?') ? '&' : '?'}${query}`
}
