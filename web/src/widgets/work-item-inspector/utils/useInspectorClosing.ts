import { inject, provide, shallowRef } from 'vue'
import type { InjectionKey, Ref } from 'vue'

import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { PlanningWorkflow, WorkItem } from '@/shared/api/planningModel.ts'
import type { NamedState } from '@/shared/lib/stateNames.ts'

/** What a card's state menu or its facts start: put off, cancel, or confirm the close. */
export type ClosingAction = 'cancel' | 'confirm' | 'defer'
/** The window one of them opens; a task's cancel asks in place instead. */
type ClosingWindow = 'cancel-goal' | 'confirm' | 'defer'
type StateCategory = PlanningWorkflow['states'][number]['category']
/** A state a closing write moves to: its key, and what `useStateName` names it by. */
type ClosingState = NamedState & { key: string }

interface ClosingHost {
  item: Ref<WorkItem | null>
  changed: () => unknown
  workflow: () => PlanningWorkflow | null | undefined
}

export interface InspectorClosing {
  /** The cancelled state a task's cancel in place moves to, while its reason is asked. */
  asking: Ref<ClosingState | null>
  /** The state the open window's write moves to. */
  goal: Ref<ClosingState | null>
  host: ClosingHost
  /** The reason a cancel asked in place carried into the window its list opened. */
  reason: Ref<string>
  /** The window open now, if any. */
  shown: Ref<ClosingWindow | null>
  dismiss: () => void
  /** The close the open window or the question was for is done: the card reads its item again. */
  done: () => void
  /** A cancel asked in place was refused with a list: the window shows it, the reason kept. */
  list: (reason: string) => void
  start: (action: ClosingAction, state?: string) => void
}

const CLOSING: InjectionKey<InspectorClosing> = Symbol('inspector-closing')

/**
 * Where a card's closing writes start and what each opens. The state menu, the facts and the
 * band under the bar each start or show one; the card owns which is open, so a second does not
 * open over the first.
 *
 * A cancel of a goal or a stage at work opens the window that lists what closes with it. Any
 * other is asked in place with its reason, as a task's is: one awaiting confirmation or with
 * nothing under it has nothing open to list, and one standing in a state does not say whether it
 * has. The server does: a cancel refused with a list opens the window, the reason kept, so no
 * goal closes its work unseen and none closes alone without its reason. Confirming a close opens
 * its window, and so does putting work off. Each moves to the first state of its kind the
 * workflow names, unless the state menu chose one.
 */
export function provideInspectorClosing(host: ClosingHost): InspectorClosing {
  const shown = shallowRef<ClosingWindow | null>(null)
  const asking = shallowRef<ClosingState | null>(null)
  const goal = shallowRef<ClosingState | null>(null)
  const reason = shallowRef('')

  const stateOf = (category: StateCategory, key?: string) =>
    host
      .workflow()
      ?.states.find((state) => (key ? state.key === key : state.category === category)) ?? null

  function start(action: ClosingAction, key?: string) {
    const item = host.item.value
    if (!item) return
    asking.value = null
    shown.value = null
    reason.value = ''
    if (action === 'defer') {
      shown.value = 'defer'
      return
    }
    const state = stateOf(action === 'confirm' ? 'completed' : 'cancelled', key)
    if (!state) return
    const { key: at, name, category } = state
    goal.value = { key: at, name, category }
    const listed = WORK_ITEM_TREE.isContainer(item) && item.container_state === 'in_progress'
    if (action === 'confirm') shown.value = 'confirm'
    else if (listed) shown.value = 'cancel-goal'
    else asking.value = goal.value
  }

  function dismiss() {
    shown.value = null
    asking.value = null
  }

  const closing: InspectorClosing = {
    asking,
    goal,
    host,
    reason,
    shown,
    dismiss,
    start,
    list: (said) => {
      asking.value = null
      reason.value = said
      shown.value = 'cancel-goal'
    },
    done: () => {
      dismiss()
      void host.changed()
    },
  }
  provide(CLOSING, closing)
  return closing
}

/** The card's closing writes; none in a part drawn outside a card. */
export function injectInspectorClosing(): InspectorClosing | null {
  return inject(CLOSING, null)
}
