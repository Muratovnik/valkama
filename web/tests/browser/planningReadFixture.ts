import {
  attachedDataScopeId,
  dataScopeId,
  planningReadModel,
  projectId,
  spaceRef,
} from './planningFixtures.ts'

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
