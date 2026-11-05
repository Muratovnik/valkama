import { PLANNING_READ_MODEL } from '@/shared/api/planningModel.ts'
import type { PlanningReadModel } from '@/shared/api/planningModel.ts'

/**
 * A space with nothing in it, which the views read while the space they were given is
 * read: the bar stands over them, and nothing of a space left behind is drawn.
 */
export const readingModel: PlanningReadModel = Object.freeze({
  interface_version: PLANNING_READ_MODEL,
  planning_spaces: [],
  planning_space: null,
  workflow: null,
  work_items: [],
  links: [],
  stale_claims: [],
})
