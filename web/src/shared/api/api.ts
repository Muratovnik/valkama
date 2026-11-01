/**
 * The routes that belong to no module's own client: sessions, scopes, refs, search.
 *
 * Planning owns `planningApi.ts`, executions own `executionApi.ts` and the
 * Kernel owns `platformApi.ts`; what is left here is what a page needs that
 * belongs to none of them — the session monitor, federated search, ref
 * resolution and the live streams the shell subscribes to.
 */

import { secureFetch } from '@/shared/api/secureFetch.ts'
import type { RefKind, ResolvedRef } from '@/shared/types/reference.ts'

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await secureFetch(input, init)
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

/**
 * Read-only context for one ref, so a timeline row means something. `space` is
 * the exact identity of the card's planning space: a commit is then looked for
 * in the repository its project is registered at, as well as the document roots.
 */
export function resolveRef(kind: RefKind, value: string, space?: string): Promise<ResolvedRef> {
  const scope = space ? `&space=${encodeURIComponent(space)}` : ''
  return json<ResolvedRef>(
    `/api/ref?kind=${encodeURIComponent(kind)}&value=${encodeURIComponent(value)}${scope}`,
  )
}

export function fetchSessionContext(id: string): Promise<ResolvedRef> {
  return json<ResolvedRef>(`/api/session?id=${encodeURIComponent(id)}`)
}
