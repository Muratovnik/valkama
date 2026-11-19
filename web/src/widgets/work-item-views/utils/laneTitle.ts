/**
 * What a lane is called, which its heading shows and its region and fold button are
 * named by: a goal's title; by stage, the path «Goal › Stage»; or the word of a lane
 * no card heads — no goal, another space with its key and name, a project, several
 * projects, none.
 */
import type { LaneHead } from '@/widgets/work-item-views/utils/boardLanes.ts'

type Translate = (key: string, params?: Record<string, unknown>) => string

/** Between the containers of a path, as the lane's heading draws it. */
export const PATH_STEP = ' › '

export function laneTitle(head: LaneHead, t: Translate): string {
  switch (head.kind) {
    case 'container': {
      return [...head.path, head.item].map((item) => item.title).join(PATH_STEP)
    }
    case 'space': {
      return t('workItem.grouped.space', { key: head.key, name: head.name })
    }
    case 'project': {
      return head.name
    }
    case 'several-projects': {
      return t('workItem.grouped.severalProjects')
    }
    case 'no-project': {
      return t('workItem.grouped.noProject')
    }
    default: {
      return t('workItem.grouped.noGoal')
    }
  }
}
