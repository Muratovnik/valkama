import { computed, inject, provide, shallowRef } from 'vue'
import type { ComputedRef, InjectionKey, Ref } from 'vue'

import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { PlanningWorkflow, WorkItem } from '@/shared/api/planningModel.ts'
import type { NamedState } from '@/shared/lib/stateNames.ts'

/** What a card's state menu or its facts start: put off, cancel, or confirm the close. */
export type ClosingAction = 'cancel' | 'confirm' | 'defer'
/** The window one of them opens; a task's cancel asks in place instead. */
type ClosingWindow = 'cancel-goal' | 'confirm' | 'defer'
/**
 * What a card's «…» menu starts that changes what the item is part of: splitting a part off,
 * which opens its window, and converting, converting back to a task and moving out of the goal,
 * each asked in place.
 */
export type DividingAction = 'convert' | 'move-out' | 'split' | 'to-task'
type StateCategory = PlanningWorkflow['states'][number]['category']
/** A state a closing write moves to: its key, and what `useStateName` names it by. */
type ClosingState = NamedState & { key: string }

interface ClosingHost {
  item: Ref<WorkItem | null>
  /** What the card read of the work under the item, whose root says whether anything is. */
  chain?: Readonly<Ref<WorkItemChain | null>>
  changed: () => unknown
  workflow: () => PlanningWorkflow | null | undefined
}

export interface InspectorClosing {
  /** The cancelled state a task's cancel in place moves to, while its reason is asked. */
  asking: Ref<ClosingState | null>
  /** The dividing action started, its window or its question, if any. */
  dividing: Ref<DividingAction | null>
  /** The state the open window's write moves to. */
  goal: Ref<ClosingState | null>
  host: ClosingHost
  /** Whether a question stands in the band under the bar: a cancel's or a dividing one's. */
  inPlace: ComputedRef<boolean>
  /** The reason a cancel asked in place carried into the window its list opened. */
  reason: Ref<string>
  /** The window open now, if any. */
  shown: Ref<ClosingWindow | null>
  dismiss: () => void
  divide: (action: DividingAction) => void
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
 *
 * The «…» menu's dividing writes start here too (`divide`), so a split's window or a question
 * about converting or moving out never stands over a closing one, nor one of those over it.
 */
export function provideInspectorClosing(host: ClosingHost): InspectorClosing {
  const shown = shallowRef<ClosingWindow | null>(null)
  const asking = shallowRef<ClosingState | null>(null)
  const goal = shallowRef<ClosingState | null>(null)
  const reason = shallowRef('')
  const dividing = shallowRef<DividingAction | null>(null)

  const stateOf = (category: StateCategory, key?: string) =>
    host
      .workflow()
      ?.states.find((state) => (key ? state.key === key : state.category === category)) ?? null

  function start(action: ClosingAction, key?: string) {
    const item = host.item.value
    if (!item) return
    asking.value = null
    shown.value = null
    dividing.value = null
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
    dividing.value = null
  }

  function divide(action: DividingAction) {
    if (!host.item.value) return
    dismiss()
    dividing.value = action
  }

  const closing: InspectorClosing = {
    asking,
    dividing,
    inPlace: computed(
      () => Boolean(asking.value) || (dividing.value !== null && dividing.value !== 'split'),
    ),
    goal,
    host,
    reason,
    shown,
    dismiss,
    divide,
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
