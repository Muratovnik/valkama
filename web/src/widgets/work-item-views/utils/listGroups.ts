/**
 * The list grouped by project: a row per project of the space, then «Several
 * projects» and «No project», each with the cards it holds as a list under it, no
 * tree inside, as the board's lanes by project hold them (`projectGroupOf`).
 *
 * A group is a thing the tree of rows is given beside the cards and named as their
 * parent (`treeRows`), so it folds, is walked by the keys and is read as a level of
 * the tree like any row. It is no card: it has no reference, nothing opens it, and
 * Enter or a press folds it. Its id starts with `GROUP_ID` so nothing takes it for a
 * card's, and the record it stands as carries nothing but its name.
 */
import {
  projectGroupOf,
  projectGroups,
  projectHead,
} from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { SpaceProject } from '@/widgets/work-item-views/utils/boardLanes.ts'
import { laneTitle } from '@/widgets/work-item-views/utils/laneTitle.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import type { TreeSource } from '@/shared/lib/treeRows.ts'

type Translate = (key: string, params?: Record<string, unknown>) => string

/** What a group's id starts with: no card's id does, since a card's is a UUID. */
const GROUP_ID = 'group:'

export const isGroupRow = (item: Pick<WorkItemBrief, 'work_item_id'>) =>
  item.work_item_id.startsWith(GROUP_ID)

/** A group as a row of the tree: its name, and nothing a card says. */
function groupRow(id: string, title: string): WorkItemBrief {
  return {
    work_item_id: `${GROUP_ID}${id}`,
    planning_space_id: '',
    reference: '',
    number: 0,
    title,
    kind: 'goal',
    priority: 'medium',
    state: null,
    open: true,
    container_state: null,
    acceptance: null,
    started_at: null,
    waits_for: [],
    claim_ref: '',
    claim_state: null,
    parent_id: null,
    labels: [],
    projects: [],
    source: '',
    checklist: [],
    revision: 0,
    created_at: '',
    updated_at: '',
    workable: false,
    withheld: [],
    lapsed_claim: null,
    comment_count: 0,
  }
}

export interface ListGroups {
  /** How much open and closed work each group holds, by its row's id, as a lane counts it. */
  counts: ReadonlyMap<string, { closed: number; open: number }>
  /** The groups' rows and the scope's cards, the groups first, in their order. */
  items: WorkItemBrief[]
  /** How the tree reads them: a card under its group, a group at the top. */
  source: TreeSource<WorkItemBrief>
}

/** The scope by project, as the rows of a tree of one level. */
export function listProjectGroups(
  scope: readonly WorkItemBrief[],
  projects: readonly SpaceProject[] | null | undefined,
  t: Translate,
): ListGroups {
  const groupOf = projectGroupOf(projects)
  const counts = new Map<string, { closed: number; open: number }>()
  for (const item of scope) {
    const id = `${GROUP_ID}${groupOf(item)}`
    const counted = counts.get(id) ?? { open: 0, closed: 0 }
    if (item.open) counted.open += 1
    else counted.closed += 1
    counts.set(id, counted)
  }
  const held = new Set(scope.map((item) => groupOf(item)))
  // Every project of the space keeps its group, as on the board; the other two only with work.
  const own = new Set((projects ?? []).map((p) => `project:${p.project_id}`))
  const groups = projectGroups(projects)
    .filter((id) => own.has(id) || held.has(id))
    .map((id) => groupRow(id, laneTitle(projectHead(id, projects), t)))
  return {
    counts,
    items: [...groups, ...scope],
    source: {
      id: (item) => item.work_item_id,
      isContainer: isGroupRow,
      isOpen: (item) => item.open,
      parentId: (item) => (isGroupRow(item) ? null : `${GROUP_ID}${groupOf(item)}`),
    },
  }
}
