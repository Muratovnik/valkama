/** The board's component-test harness: a mounted board over one small space, and the reads the specs share. */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'

import WorkItemBoard from '@/widgets/work-item-views/components/WorkItemBoard.vue'

import type { WorkItemRow } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { boardGoal, boardItem, boardWorkflow } from '../fixtures/board.ts'

export const i18n = () => createI18n({ legacy: false, locale: 'en', messages })

export const goal = boardGoal(1)
export const closedGoal = boardGoal(2, 'done')
export const space: WorkItemRow[] = [
  boardItem(10, 'backlog', { parent_id: goal.work_item_id }),
  boardItem(11, 'backlog', { parent_id: goal.work_item_id }),
  boardItem(12, 'backlog'),
  boardItem(13, 'todo', { parent_id: goal.work_item_id }),
  goal,
  boardItem(20, 'done', { parent_id: closedGoal.work_item_id }),
  closedGoal,
]

export function board(props: Partial<InstanceType<typeof WorkItemBoard>['$props']> = {}) {
  return mount(WorkItemBoard, {
    attachTo: document.body,
    props: {
      items: space,
      links: [],
      workflow: boardWorkflow,
      spaceId: 'space-a',
      spaceItems: space,
      writable: true,
      ...props,
    },
    global: { plugins: [i18n()] },
  })
}

export function tile(wrapper: ReturnType<typeof board>, reference: string) {
  return wrapper.get<HTMLElement>(`[data-reference="${reference}"] .tile-open`)
}

export function live(wrapper: ReturnType<typeof board>) {
  return wrapper.get('[role="status"]').text()
}
