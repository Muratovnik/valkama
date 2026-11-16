import {
  attachedDataScopeId,
  dataScopeId,
  planningReadModel,
  projectId,
  spaceRef,
} from './planningFixtures.ts'

/**
 * A wrong or omitted store identity must fail the browser oracle. A read names no project
 * for the whole space, or the space's own project when the scope narrows to it.
 */
export function planningReadFor(query: URLSearchParams, includeAttached = false) {
  const requestedScopeId = query.get('data_scope_id')
  const project = query.get('project')
  if (
    (project !== null && project !== projectId) ||
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
