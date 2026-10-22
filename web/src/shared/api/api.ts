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

/** Read-only context for one ref, so a timeline row means something. */
export function resolveRef(kind: RefKind, value: string): Promise<ResolvedRef> {
  return json<ResolvedRef>(
    `/api/ref?kind=${encodeURIComponent(kind)}&value=${encodeURIComponent(value)}`,
  )
}

export function fetchSessionContext(id: string): Promise<ResolvedRef> {
  return json<ResolvedRef>(`/api/session?id=${encodeURIComponent(id)}`)
}
