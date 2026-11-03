/**
 * What a preview of a work item reference reads when the item is not on the
 * page: the brief record through the exact scope, remembered for a while.
 *
 * A data source and nothing else — no DOM, no timers, no words — so the
 * preview's card and the reference layers above it decide what to draw.
 *
 * - The candidates are where the reference may live, in the order a click on
 *   it would find it: the primary store's binding first. A 404 asks the next
 *   one; any other answer is the answer.
 * - One cache per window, at most `PREVIEW_CACHE_LIMIT` items, the least
 *   recently used leaving first. An entry younger than `PREVIEW_FRESH_MS` is
 *   answered without a request; an older one is still there to draw at once
 *   while a read replaces it.
 * - Only a record is remembered. A refusal or a failure is answered and drops
 *   whatever the cache held for that reference, so the next look asks again
 *   rather than draw what the server just said it cannot vouch for.
 * - Aborting a read rejects it with the signal's reason and writes nothing.
 */
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { fetchPlanningWorkItemBrief } from '@/shared/api/platformPlanningApi.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { typedFailure } from '@/shared/api/typedFailure.ts'

/** A project that maps a space with the reference's key, through one exact binding. */
export interface PreviewCandidate {
  project_id: string
  space_ref: PlanningSpaceRef
}

/** A record the server answered, with where it came from and when. */
interface PreviewRecord {
  candidate: PreviewCandidate
  item: WorkItemBrief
  /** When it was read, in the clock the reads were made with. */
  readAt: number
  status: 'ready'
}

/**
 * What a read answers: the record; no such item in any candidate (404); the
 * store or its binding went away (409); or the read failed — the network, a
 * timeout, an answer the schema refused.
 */
export type PreviewRead = PreviewRecord | { status: 'missing' | 'unavailable' | 'failed' }

export interface WorkItemPreviewReads {
  /** What the cache holds for the reference now, fresh or not. Never asks. */
  cached: (reference: string, candidates: readonly PreviewCandidate[]) => PreviewRecord | null
  /** The record, from the cache while it is fresh, else from the server. */
  read: (
    reference: string,
    candidates: readonly PreviewCandidate[],
    signal: AbortSignal,
  ) => Promise<PreviewRead>
}

export const PREVIEW_FRESH_MS = 10_000
export const PREVIEW_CACHE_LIMIT = 100

/**
 * The cache key. The same reference may name another item once the projects
 * change, so the places it was looked for are part of what was read.
 */
function keyOf(reference: string, candidates: readonly PreviewCandidate[]) {
  return JSON.stringify([
    reference,
    candidates.map(({ project_id, space_ref }) => [
      project_id,
      space_ref.data_scope_id,
      space_ref.space_key,
    ]),
  ])
}

/** A separate reader with its own cache; the window's one is `useWorkItemPreviewReads`. */
export function createWorkItemPreviewReads(
  options: { now?: () => number } = {},
): WorkItemPreviewReads {
  const now = options.now ?? Date.now
  /** Insertion order is use order: a hit moves its entry to the end. */
  const entries = new Map<string, PreviewRecord>()

  function cached(reference: string, candidates: readonly PreviewCandidate[]) {
    const key = keyOf(reference, candidates)
    const entry = entries.get(key)
    if (!entry) return null
    entries.delete(key)
    entries.set(key, entry)
    return entry
  }

  function remember(key: string, entry: PreviewRecord) {
    entries.delete(key)
    entries.set(key, entry)
    for (const oldest of entries.keys()) {
      if (entries.size <= PREVIEW_CACHE_LIMIT) break
      entries.delete(oldest)
    }
  }

  async function ask(
    reference: string,
    candidates: readonly PreviewCandidate[],
    signal: AbortSignal,
  ): Promise<PreviewRead> {
    for (const candidate of candidates) {
      try {
        const payload = await fetchPlanningWorkItemBrief(
          { kind: 'project', project_ref: { project_id: candidate.project_id } },
          { space_ref: candidate.space_ref, reference },
          signal,
        )
        signal.throwIfAborted()
        return payload.state.status === 'ready'
          ? { status: 'ready', item: payload.state.payload.work_item, candidate, readAt: now() }
          : { status: 'unavailable' }
      } catch (error) {
        signal.throwIfAborted()
        const { status } = typedFailure(error)
        if (status === 404) continue
        return { status: status === 409 ? 'unavailable' : 'failed' }
      }
    }
    return { status: 'missing' }
  }

  async function read(
    reference: string,
    candidates: readonly PreviewCandidate[],
    signal: AbortSignal,
  ): Promise<PreviewRead> {
    signal.throwIfAborted()
    const key = keyOf(reference, candidates)
    const known = cached(reference, candidates)
    if (known && now() - known.readAt < PREVIEW_FRESH_MS) return known
    const answer = await ask(reference, candidates, signal)
    if (answer.status === 'ready') remember(key, answer)
    else entries.delete(key)
    return answer
  }

  return { cached, read }
}

let windowReads: WorkItemPreviewReads | null = null

/** The window's one reader, so every preview on the page shares its cache. */
export function useWorkItemPreviewReads(): WorkItemPreviewReads {
  windowReads ??= createWorkItemPreviewReads()
  return windowReads
}
