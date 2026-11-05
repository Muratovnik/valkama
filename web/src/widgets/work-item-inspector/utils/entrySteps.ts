import { computed, inject, provide } from 'vue'
import type { InjectionKey } from 'vue'

import type { ThreadComment } from '@/widgets/work-item-inspector/utils/threadRows.ts'
import { injectThreadForms } from '@/widgets/work-item-inspector/utils/useThreadForms.ts'

import { listPoints } from '@/features/discussion-thread/utils/stepPoints.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'

/**
 * What an entry of a thread needs of its card to make steps of its list: the card as last
 * read, the way to its checklist, and a fresh read after a refused write. Overview owns all
 * three and hands them down, past the discussion and its threads to every entry, a reply
 * under a question included. A discussion with no Overview around it offers no steps.
 */
interface CardSteps {
  item: () => WorkItem
  refresh: () => void
  reveal: () => void
}

const CARD_STEPS: InjectionKey<CardSteps> = Symbol('card-steps')

export function provideCardSteps(steps: CardSteps) {
  provide(CARD_STEPS, steps)
}

/** What an entry says: a comment's body, or what a report says was done and comes next. */
const textsOf = (entry: ThreadComment) =>
  entry.report ? [entry.report.done, entry.report.next] : [entry.body]

/**
 * The steps an entry offers and its one form for them, which is a form of its thread: one
 * stands open on a card at a time. The icon is there only while the card is open and the
 * entry has a list, and the form goes with it the moment either stops being true.
 */
export function useEntrySteps(entry: () => ThreadComment, threadKey: () => string) {
  const card = inject(CARD_STEPS, null)
  const forms = injectThreadForms()
  const points = computed(() => listPoints(textsOf(entry())))
  const offered = computed(
    () => card !== null && !card.item().state.is_terminal && points.value.length > 0,
  )
  const open = computed(() => offered.value && forms.stepsOpen(threadKey(), entry().id))
  /** How many steps this entry's list gave in the last write, until something else opens. */
  const added = computed(() =>
    forms.added.value?.entry === entry().id ? forms.added.value.count : 0,
  )
  function press(event: Event) {
    if (open.value) forms.cancel()
    else forms.show(threadKey(), 'steps', event, entry().id)
  }
  function send(chosen: string[]) {
    if (card) forms.sendSteps(threadKey(), entry().id, card.item(), chosen)
  }
  return { added, card, forms, offered, open, points, press, send }
}
