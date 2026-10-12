import { useEffect, useState } from 'react'
import type { LotDriftAnswer } from '../summary'
import { ApiError, getJson } from './client'
import { lotDriftSchema } from './schema'

const NONE: ReadonlyMap<number, LotDriftAnswer> = new Map()

/** Every answer so far, tagged with the set of lots it answers, so a new set never shows an old set's drift. */
type Settled = { readonly request: string; readonly answers: ReadonlyMap<number, LotDriftAnswer> }

/**
 * The SF6 drift of each lot against the good runs of every lot, the lot page's default view, one call per lot. A lot
 * the API has no drift for answers missing, any other failure answers failed, and a lot not answered yet is absent.
 */
export function useLotDrifts(lotIds: readonly number[]): ReadonlyMap<number, LotDriftAnswer> {
  const request = lotIds.join(',')
  const [settled, setSettled] = useState<Settled>({ request: '', answers: NONE })

  useEffect(() => {
    if (request === '') {
      return undefined
    }
    const controller = new AbortController()
    const settle = (lotId: number, answer: LotDriftAnswer) => {
      if (controller.signal.aborted) {
        return
      }
      setSettled((current) => {
        const answers = new Map(current.request === request ? current.answers : NONE)
        answers.set(lotId, answer)
        return { request, answers }
      })
    }
    for (const lotId of request.split(',').map(Number)) {
      getJson(`/api/lots/${lotId}/drift?phase=SF6`, lotDriftSchema, controller.signal).then(
        (drift) => settle(lotId, { kind: 'ready', drift }),
        (error: unknown) => settle(lotId, error instanceof ApiError && error.status === 404 ? { kind: 'missing' } : { kind: 'failed' }),
      )
    }
    return () => controller.abort()
  }, [request])

  return settled.request === request ? settled.answers : NONE
}
