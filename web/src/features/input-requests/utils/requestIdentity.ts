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
