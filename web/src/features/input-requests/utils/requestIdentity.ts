import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'

export function targetIdentity(target: PlanningTarget): string {
  return JSON.stringify([
    target.project_id,
    target.space_ref.data_scope_id,
    target.space_ref.space_key,
    target.reference,
  ])
}

export function requestIdentity(entry: InputRequestEntry): string {
  return JSON.stringify([
    targetIdentity(entry.target),
    entry.request.work_item_id,
    entry.request.request_id,
  ])
}

/**
 * A list an agent put under its comment rather than a question: it stands in that comment and
 * nobody waits on it, so it is no question waiting for an answer anywhere it is counted.
 */
export const isCommentList = (entry: InputRequestEntry) =>
  entry.request.comment_id !== null && entry.request.comment_id !== undefined
