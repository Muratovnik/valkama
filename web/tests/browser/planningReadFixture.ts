import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import type { WorkItemRef } from '@/shared/api/platformPlanningRefs.ts'

import {
  attachedDataScopeId,
  dataScopeId,
  existingRelation,
  planningReadModel,
  projectId,
  spaceRef,
} from './planningFixtures.ts'

export function planningRelationsFor(relations: (typeof existingRelation)[], ref: WorkItemRef) {
  if (ref.space_ref.data_scope_id !== attachedDataScopeId) return relations
  return relations.map((relation) => ({
    ...relation,
    source: planningWorkItemEntity(ref),
    presentation: { ...relation.presentation, label: `Attached: ${relation.presentation.label}` },
  }))
}

/** A wrong or omitted store identity must fail the browser oracle. */
export function planningReadFor(query: URLSearchParams, includeAttached = false) {
  const requestedScopeId = query.get('data_scope_id')
  if (
    query.get('project') !== projectId ||
    query.get('space_key') !== spaceRef.space_key ||
    ![dataScopeId, ...(includeAttached ? [attachedDataScopeId] : [])].includes(
      requestedScopeId ?? '',
    )
  ) {
    return {
      status: 409,
      body: { error: { code: 'unavailable', message: 'Exact Planning binding is required' } },
    }
  }
  const model = structuredClone(planningReadModel)
  if (requestedScopeId === attachedDataScopeId) {
    model.work_items = model.work_items.map((item) => ({
      ...item,
      title: `Attached: ${item.title}`,
    }))
  }
  return { status: 200, body: model }
}
