import type { GlobalPlanningSearch } from '@/shared/api/planningGlobalSearchApi.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'

export function finderTarget(): PlanningTarget {
  return {
    project_id: 'attached-project',
    space_ref: { data_scope_id: '11111111-1111-4111-8111-111111111111', space_key: 'TASK' },
    reference: 'TASK-7',
    writable: false,
  }
}

export function finderResponse(query = 'needle'): GlobalPlanningSearch {
  const target = finderTarget()
  return {
    interface_version: 'valkama-planning-search',
    query,
    limit: 50,
    has_more: false,
    items: [
      {
        target,
        item: {
          work_item_id: '22222222-2222-4222-8222-222222222222',
          planning_space_id: '33333333-3333-4333-8333-333333333333',
          reference: 'TASK-7',
          title: 'Needle from the attached project',
          kind: 'bug',
          priority: 'urgent',
          state: { name: 'In progress', category: 'active', is_terminal: false },
          claim_ref: '',
        },
      },
    ],
    coverage: [
      {
        project_id: target.project_id,
        space_ref: target.space_ref,
        status: 'searched',
        reason: null,
      },
    ],
  }
}
