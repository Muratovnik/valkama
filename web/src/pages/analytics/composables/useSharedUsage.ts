/**
 * One request for each usage read the Analytics page asks more than once for the view on show.
 *
 * The page, the overview's cards and the rail's tiles each ask for what they show, and several
 * of them ask the same thing: the period by task, by account, by model. Here every one of those
 * reads is asked once. A read asked again while the first is in flight follows it, and one asked
 * again once it was answered takes that answer, so long as the view is the one it was asked for.
 *
 * The view an answer belongs to is its period, its filters and its scope: a change of any of them,
 * or a refresh (`renew`), forgets every answer, so nothing asked after it is served from before
 * it. A section or a measure is no new view. A preset period runs to «now», and every read of a
 * view takes the same moment for it (`now`), the one its first read took: otherwise each would
 * name a different millisecond, and none would be the same read as another.
 *
 * A reader that stops waiting stops only itself; the request goes on while anyone else waits for
 * it, and is dropped once nobody does. A read that fails is forgotten, so asking again asks again.
 */
import { inject, provide } from 'vue'
import type { InjectionKey } from 'vue'

import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import { fetchUsage, usageParameters } from '@/shared/api/analyticsApi.ts'
import type { Usage, UsageQuery } from '@/shared/api/analyticsApi.ts'

export interface SharedUsage {
  /** The moment the view on show is read as of: the one its first read took. */
  now: () => Date
  read: (query: UsageQuery, signal?: AbortSignal) => Promise<Usage>
  /** Forget every answer and the moment, as a refresh does: what is asked next is asked anew. */
  renew: () => void
}

/** A request and how many readers wait for it; `settled` once it was answered or failed. */
interface Request {
  answer: Promise<Usage>
  controller: AbortController
  settled: boolean
  waiting: number
}

/** The answer of `request` for one reader, who may stop waiting without stopping the others. */
function follow(request: Request, forget: () => void, signal?: AbortSignal): Promise<Usage> {
  if (signal?.aborted) return Promise.reject(signal.reason as Error)
  request.waiting += 1
  return new Promise<Usage>((resolve, reject) => {
    let waits = true
    /** This reader is done: it waits no more, whichever came first, its answer or its abort. */
    const done = () => {
      if (!waits) return false
      waits = false
      request.waiting -= 1
      signal?.removeEventListener('abort', leave)
      return true
    }
    function leave() {
      if (!done()) return
      reject(signal?.reason as Error)
      if (request.waiting > 0 || request.settled) return
      request.controller.abort()
      forget()
    }
    signal?.addEventListener('abort', leave, { once: true })
    request.answer.then(
      (usage) => {
        if (done()) resolve(usage)
      },
      (error: unknown) => {
        if (done()) reject(error as Error)
      },
    )
  })
}

/**
 * The page's shared reads for the view `viewKey` names: a new key, like `renew`, forgets every
 * answer and the moment. `clock` is the time a new view is read as of.
 */
export function createSharedUsage(viewKey: () => string, clock = () => new Date()): SharedUsage {
  let requests = new Map<string, Request>()
  let moment: Date | null = null
  let view: string | null = null

  const renew = () => {
    requests = new Map()
    moment = null
  }

  /** Forgets what was asked for another view than the one on show. */
  function sync() {
    const current = viewKey()
    if (current === view) return
    view = current
    renew()
  }

  function now() {
    sync()
    moment ??= clock()
    return moment
  }

  function read(query: UsageQuery, signal?: AbortSignal) {
    sync()
    const key = usageParameters(query).toString()
    const held = requests.get(key)
    const kept = requests
    const forget = (request: Request) => () => {
      if (kept.get(key) === request) kept.delete(key)
    }
    if (held) return follow(held, forget(held), signal)
    const controller = new AbortController()
    const request: Request = {
      controller,
      settled: false,
      waiting: 0,
      answer: fetchUsage(query, controller.signal),
    }
    requests.set(key, request)
    request.answer.then(
      () => {
        request.settled = true
      },
      () => {
        request.settled = true
        forget(request)()
      },
    )
    return follow(request, forget(request), signal)
  }

  return { now, read, renew }
}

const SHARED: InjectionKey<SharedUsage> = Symbol('analytics-shared-usage')

/** Every read asked on its own, as of the moment it is asked: for a part shown outside the page. */
const unshared: SharedUsage = {
  now: () => new Date(),
  read: (query, signal) => fetchUsage(query, signal),
  renew: () => {},
}

/** The Analytics page's shared reads, for the page itself and every part inside it. */
export function provideSharedUsage(options: {
  projectId: () => string | null
  view: () => AnalyticsView
}): SharedUsage {
  const shared = createSharedUsage(() => {
    const { period, from, to, filters } = options.view()
    return JSON.stringify({ period, from, to, filters, project: options.projectId() })
  })
  provide(SHARED, shared)
  return shared
}

/** The shared reads of the page a part stands in; each read its own outside one. */
export const useSharedUsage = () => inject(SHARED, unshared)
