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
  validateWorkItemRecord,
} from '@/shared/api/planningModel.ts'
import type { PlanningReadModel, WorkItem } from '@/shared/api/planningModel.ts'
import { fetchPlanningWorkItem } from '@/shared/api/platformPlanningApi.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'
import { WEB_AUTHOR } from '@/shared/api/webAuthor.ts'

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

/** What a refused write said, in the server's own words, and which guards refused it. */
export interface PlanningRefusal {
  code: string
  /** The guards a workflow refusal names, in order: `[summary] …; [checklist] …`. */
  guards: string[]
  /** The server's reason, worded for whoever has to act on it. */
  message: string
  status: number
}

const GUARD_NAME = /\[([a-z][a-z0-9_-]{0,31})\]/gu

/**
 * The refusal a write ended in, or null for anything else.
 *
 * A guard refusal is an answer, not a crash, and its message is the part that
 * says what to do next. Reading it through the generic failure path kept only
 * the code, which is how "has no closing summary; record what was done" became
 * "the request failed (workflow_guard)".
 */
export function planningRefusal(error: unknown): PlanningRefusal | null {
  if (!(error instanceof PlanningRefusedError)) return null
  return {
    code: error.code,
    message: error.message,
    status: error.status,
    guards: [...error.message.matchAll(GUARD_NAME)].map((match) => match[1]),
  }
}

async function request(input: string, init?: RequestInit): Promise<unknown> {
  const { response, payload } = await readJsonResponse(input, init)
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
  // No envelope to read, so the status is the whole answer. It is not a refusal:
  // the failure path names the cause from the status, and never a raw code.
  throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
}

function query(parameters: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(parameters))
    if (value !== undefined && value !== '') search.set(name, String(value))
  const text = search.toString()
  return text ? `?${text}` : ''
}

/** Every write names the client's author unless the caller names another one. */
async function write(path: string, body: Record<string, unknown>): Promise<unknown> {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author: WEB_AUTHOR, ...body }),
  })
}

// -- reads -------------------------------------------------------------------

/**
 * One space's whole read model, resolved through its exact project binding.
 */
export async function fetchPlanning(
  target: { project: string } & PlanningSpaceRef,
): Promise<PlanningReadModel> {
  return validateReadModel(await request(`/api/planning${query({ ...target })}`))
}

export type PlanningConnectionState = 'connecting' | 'live' | 'reconnecting'

export function subscribePlanning(
  target: { project: string } & PlanningSpaceRef,
  callbacks: {
    /** Something was recorded about an agent, which no frame of the model says. */
    agents?: () => void
    connection: (state: PlanningConnectionState) => void
    invalid?: (error: unknown) => void
    snapshot: (model: PlanningReadModel) => void
  },
): () => void {
  callbacks.connection('connecting')
  const source = new EventSource(`/api/events${query({ view: 'planning', ...target })}`)
  let closed = false
  const firstSnapshotDeadline = setTimeout(() => {
    if (!closed) callbacks.connection('reconnecting')
  }, 15_000)
  function close() {
    if (closed) return
    closed = true
    clearTimeout(firstSnapshotDeadline)
    source.removeEventListener('message', onMessage)
    source.removeEventListener('agents', onAgents)
    source.removeEventListener('error', onError)
    source.close()
  }
  function onMessage(event: MessageEvent<string>) {
    if (closed) return
    try {
      const model = validateReadModel(JSON.parse(event.data) as unknown)
      if (model.planning_space?.key !== target.space_key)
        throw new Error('Planning stream returned a different space')
      clearTimeout(firstSnapshotDeadline)
      callbacks.snapshot(model)
      callbacks.connection('live')
    } catch (error) {
      close()
      callbacks.connection('reconnecting')
      callbacks.invalid?.(error)
    }
  }
  function onAgents() {
    if (!closed) callbacks.agents?.()
  }
  function onError() {
    clearTimeout(firstSnapshotDeadline)
    if (!closed) callbacks.connection('reconnecting')
  }
  source.addEventListener('message', onMessage)
  source.addEventListener('agents', onAgents)
  source.addEventListener('error', onError)
  return close
}

export async function fetchWorkItem(
  reference: string,
  target: { project: string; space: PlanningSpaceRef },
): Promise<WorkItem> {
  const payload = await fetchPlanningWorkItem(
    { kind: 'project', project_ref: { project_id: target.project } },
    { reference, space_ref: target.space },
  )
  if (payload.state.status !== 'ready')
    throw new PlanningRefusedError('unavailable', 'Exact work item is unavailable', 409)
  return payload.state.payload.work_item
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

/**
 * Move an item to a state. It goes last there unless `rank` names its place:
 * `first`, `last`, `before:<reference>` or `after:<reference>` of an item
 * already in that state.
 */
export async function transitionWorkItem(input: {
  id: string
  state: string
  author?: string
  expected_revision?: number
  force?: boolean
  rank?: string
  reason?: string
}): Promise<WorkItem> {
  return validateWorkItemRecord(await write('/api/planning/work-item/transition', { ...input }))
}

/** Place an item among the items of its own state, in the spelling `transitionWorkItem` takes. */
export async function rankWorkItem(input: {
  id: string
  rank: string
  author?: string
  expected_revision?: number
}): Promise<WorkItem> {
  return validateWorkItemRecord(await write('/api/planning/work-item/update', { ...input }))
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
  checklist_item_id?: string
}): Promise<void> {
  await write('/api/planning/work-item/comment', { ...input })
}

export async function updateWorkItemDescription(input: {
  description: string
  expected_revision: number
  id: string
  author?: string
}): Promise<WorkItem> {
  return validateWorkItemRecord(await write('/api/planning/work-item/update', { ...input }))
}

export async function publishWorkItemReport(input: {
  id: string
  make_current: boolean
  report: { done: string; next: string; why?: string }
  author?: string
  expected_revision?: number
}): Promise<WorkItem> {
  return validateWorkItemRecord(await write('/api/planning/work-item/report', { ...input }))
}

export async function selectWorkItemSummary(input: {
  comment_id: number
  expected_revision: number
  id: string
  author?: string
}): Promise<WorkItem> {
  return validateWorkItemRecord(await write('/api/planning/work-item/summary/select', { ...input }))
}
