/**
 * The routes that belong to no module's own client: sessions, scopes, refs, search.
 *
 * Planning owns `planningApi.ts`, executions own `executionApi.ts` and the
 * Kernel owns `platformApi.ts`; what is left here is what a page needs that
 * belongs to none of them — the session monitor, federated search, ref
 * resolution and the live streams the shell subscribes to.
 */

import { validatePlatformActivityPayload } from '@/shared/api/platformActivity.ts'
import type { PlatformActivity } from '@/shared/api/platformActivity.ts'
import { secureFetch } from '@/shared/api/secureFetch.ts'
import { validateSessionFeed, validateSessionsPayload } from '@/shared/api/sessionContract.ts'
import { responseFailure, typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import type { ScopeListing } from '@/shared/types/launch.ts'
import type { RefKind, ResolvedRef, SearchPayload } from '@/shared/types/reference.ts'
import type { SessionFeed, SessionsPayload } from '@/shared/types/session.ts'

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await secureFetch(input, init)
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

/** The lifecycle feed the activity bell reads, newest first. */
export async function listActivity(): Promise<PlatformActivity[]> {
  const payload = await json<{ activity: unknown }>('/api/planning/activity')
  return validatePlatformActivityPayload(payload.activity)
}

/** One query across work items, comments, summaries and repository documents. */
export function searchEverything(query: string, space?: string): Promise<SearchPayload> {
  const scope = space ? `&space=${encodeURIComponent(space)}` : ''
  return json<SearchPayload>(`/api/search?q=${encodeURIComponent(query)}${scope}`)
}

/** Attached database files and the spaces they hold, each labelled by scope. */
export function listScopes(): Promise<ScopeListing> {
  return json<ScopeListing>('/api/scopes')
}

/** Read-only context for one ref, so a timeline row means something. */
export function resolveRef(kind: RefKind, value: string): Promise<ResolvedRef> {
  return json<ResolvedRef>(
    `/api/ref?kind=${encodeURIComponent(kind)}&value=${encodeURIComponent(value)}`,
  )
}

/** Follow lifecycle events across every space for the global activity bell. */
export function subscribeActivity(onActivity: (payload: PlatformActivity[]) => void) {
  const source = new EventSource('/api/events?view=activity')
  source.addEventListener('message', (event) =>
    onActivity(validatePlatformActivityPayload(JSON.parse(event.data) as unknown)),
  )
  return source
}

export async function listSessions(): Promise<SessionsPayload> {
  const response = await secureFetch('/api/sessions')
  if (!response.ok) throw responseFailure(response, 'sessions_request_failed')
  try {
    return validateSessionsPayload(await response.json())
  } catch (error) {
    throw typedFailure(error, 'contract_invalid')
  }
}

export async function fetchSessionFeed(id: string, limit = 50): Promise<SessionFeed> {
  const response = await secureFetch(`/api/session?id=${encodeURIComponent(id)}&limit=${limit}`)
  if (!response.ok) throw responseFailure(response, 'session_feed_failed')
  try {
    return validateSessionFeed(await response.json())
  } catch (error) {
    throw typedFailure(error, 'contract_invalid')
  }
}

/** Follow every observed agent session and the attention inbox with one stream. */
export function subscribeSessions(
  onSessions: (payload: SessionsPayload) => void,
  onFailure?: (failure: TypedFailure) => void,
) {
  const source = new EventSource('/api/events?view=sessions')
  source.addEventListener('message', (event) => {
    try {
      onSessions(validateSessionsPayload(JSON.parse(event.data) as unknown))
    } catch (error) {
      onFailure?.(typedFailure(error, 'contract_invalid'))
    }
  })
  source.addEventListener('error', () =>
    onFailure?.({ code: 'stream_disconnected', status: null, retryable: true }),
  )
  return source
}

/** Acknowledge one attention item so it stops ringing the inbox. */
export async function markSessionSeen(id: string): Promise<void> {
  const response = await secureFetch('/api/session-seen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  if (!response.ok) throw responseFailure(response, 'mutation_failed')
}
