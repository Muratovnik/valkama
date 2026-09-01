/**
 * HTTP ownership for the neutral Planning boundary.
 *
 * One function per operation, each validating what came back before a view sees
 * it. Two answers are not failures and are typed as such: a store whose cutover
 * has not run yet reports that, and a refused write carries the guard that
 * refused it, so a view can say which rather than showing a stack.
 */

import {
  readPending,
  readRefusal,
  validateReadModel,
  validateWorkItem,
  validateWorkItemRecord,
} from '@/shared/api/planningModel.ts'
import type { PlanningReadModel, WorkItem } from '@/shared/api/planningModel.ts'
import { secureFetch } from '@/shared/api/secureFetch.ts'

/** The cutover has not run, so the Board domain is still the live one. */
export class CutoverPendingError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'CutoverPendingError'
  }
}

/** A guard said no, and named itself. */
class PlanningRefusedError extends Error {
  readonly code: string
  readonly status: number
  readonly expected?: number
  readonly actual?: number

  constructor(
    code: string,
    message: string,
    status: number,
    revisions?: { actual?: number; expected?: number },
  ) {
    super(message)
    this.name = 'PlanningRefusedError'
    this.code = code
    this.status = status
    this.expected = revisions?.expected
    this.actual = revisions?.actual
  }
}

async function request(input: string, init?: RequestInit): Promise<unknown> {
  const response = await secureFetch(input, init)
  const payload: unknown = await response.json().catch(() => null)
  if (response.ok) return payload
  const pending = readPending(payload)
  if (pending !== null) throw new CutoverPendingError(pending.state.reason)
  const refusal = readRefusal(payload)
  if (refusal !== null) {
    if (refusal.error.code === 'cutover_pending')
      throw new CutoverPendingError(refusal.error.message)
    throw new PlanningRefusedError(
      refusal.error.code,
      refusal.error.message,
      response.status,
      refusal.error,
    )
  }
  throw new PlanningRefusedError('unavailable', `HTTP ${response.status}`, response.status)
}

function query(parameters: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(parameters))
    if (value !== undefined && value !== '') search.set(name, String(value))
  const text = search.toString()
  return text ? `?${text}` : ''
}

async function write(path: string, body: Record<string, unknown>): Promise<unknown> {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// -- reads -------------------------------------------------------------------

/**
 * One space's whole read model, named either outright or by the project that
 * binds it. A browser knows its project before it knows a space id, so the
 * translation stays on the server rather than in every caller.
 */
export async function fetchPlanning(
  target: { project: string } | { space: string },
): Promise<PlanningReadModel> {
  return validateReadModel(await request(`/api/planning${query({ ...target })}`))
}

export async function fetchWorkItem(reference: string): Promise<WorkItem> {
  return validateWorkItem(await request(`/api/planning/work-item${query({ id: reference })}`))
}

// -- writes ------------------------------------------------------------------

export type CreateWorkItem = {
  space: string
  title: string
  author?: string
  description?: string
  kind?: string
  labels?: string[]
  parent?: string
  priority?: string
  source?: string
  state?: string
}

export async function createWorkItem(input: CreateWorkItem): Promise<WorkItem> {
  return validateWorkItemRecord(await write('/api/planning/work-items', { ...input }))
}

export async function transitionWorkItem(input: {
  id: string
  state: string
  author?: string
  expected_revision?: number
  force?: boolean
  reason?: string
}): Promise<WorkItem> {
  return validateWorkItemRecord(await write('/api/planning/work-item/transition', { ...input }))
}

export async function claimWorkItem(input: {
  id: string
  author?: string
  expected_revision?: number
  force?: boolean
  release?: boolean
}): Promise<WorkItem> {
  return validateWorkItemRecord(await write('/api/planning/work-item/claim', { ...input }))
}

export async function tickChecklistStep(input: {
  id: string
  item_id: string
  author?: string
  done?: boolean
  expected_revision?: number
  force?: boolean
}): Promise<WorkItem> {
  return validateWorkItemRecord(await write('/api/planning/work-item/checklist/tick', { ...input }))
}

export async function linkWorkItems(input: {
  id: string
  kind: string
  other: string
  author?: string
  remove?: boolean
}): Promise<void> {
  await write('/api/planning/work-item/link', { ...input })
}

export async function setWorkItemSummary(input: {
  id: string
  summary: { done: string; next: string; why?: string }
  author?: string
  expected_revision?: number
}): Promise<WorkItem> {
  return validateWorkItemRecord(await write('/api/planning/work-item/summary', { ...input }))
}

/**
 * Point this item at something outside Planning: a commit, a session, a memory
 * record, a URL. The pointer is Valkama's own act — the provider is not asked
 * to store anything, which is why a read-only knowledge source can still be
 * attached to a work item.
 */
export async function attachWorkItemRef(input: {
  id: string
  kind: 'commit' | 'memory' | 'session' | 'url'
  value: string
  author?: string
  label?: string
}): Promise<void> {
  await write('/api/planning/work-item/ref', { ...input })
}

export async function commentWorkItem(input: {
  body: string
  id: string
  author?: string
}): Promise<void> {
  await write('/api/planning/work-item/comment', { ...input })
}
