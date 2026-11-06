import { inject, nextTick, provide, ref, watch } from 'vue'
import type { InjectionKey } from 'vue'

import { useDraftSource } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'
import { useInspectorMutation } from '@/widgets/work-item-inspector/utils/useInspectorMutation.ts'

import { useThreadWrites } from '@/features/discussion-thread/composables/useThreadWrites.ts'
import type { ThreadParent } from '@/features/discussion-thread/composables/useThreadWrites.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { grantFocus } from '@/shared/lib/focusRight.ts'
import type { FocusRight } from '@/shared/lib/focusRight.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'

export type ThreadForm = 'reply' | 'resolve' | 'steps'

type ThreadForms = ReturnType<typeof useThreadForms>

const THREAD_FORMS: InjectionKey<ThreadForms> = Symbol('thread-forms')

/** The ids a thread's controls answer to, for focus to come back to them. */
export const replyAnchor = (key: string) => `thread-reply-${key}`
export const resolveAnchor = (key: string) => `thread-resolve-${key}`
export const entryAnchor = (rootId: number) => `work-report-${rootId}`
export const writtenAnchor = (commentId: number) => `thread-comment-${commentId}`

export const anchored = (id: string) => document.querySelector<HTMLElement>(`#${id}`)

/**
 * The forms of a card's threads: one stands open at a time and every thread keeps what was
 * written in its own, so opening another form sets a draft aside rather than losing it.
 * Those drafts are text nobody has anywhere else, so the card asks before leaving them.
 *
 * Focus follows a write. A new reply exists only after the card is read again, so focus
 * waits on the reply button until then; a mark's thread stays one element as it folds, so
 * focus can go straight to it. Each move asks the right its action was given as it began
 * (`grantFocus`): a person who has gone on into another field while the write was out stays
 * there, and loses neither the field nor the letters they type into it.
 *
 * A thread has as many ways into its reply as it has entries and only one form. So a form
 * left comes back to the icon that opened it, and an icon pressed while its thread's form
 * stands open takes focus to that form instead of leaving it on the icon.
 *
 * Making steps of a list is a form of the thread too, under the entry whose list it is,
 * root or reply; once the steps are written it gives way to a line saying how many.
 */
export function useThreadForms(identity: () => string, changed: () => void) {
  const { pending, error, submit } = useInspectorMutation(identity, changed)
  const writes = useThreadWrites(identity, submit)
  const open = ref<{ form: ThreadForm; key: string } | null>(null)
  const replies = ref<Record<string, string>>({})
  const decisions = ref<Record<string, string>>({})
  const marks = ref<Record<string, boolean>>({})
  /** The entry whose list the open steps form is for, and the one the last steps went from. */
  const stepsOf = ref<number | null>(null)
  const added = ref<{ count: number; entry: number } | null>(null)
  /** The thread the last failed write belongs to, and which of its controls made it. */
  const failedAt = ref<{ form: ThreadForm | 'reopen'; key: string } | null>(null)
  /** Threads marked while the unresolved view stands: they stay until the view changes. */
  const held = ref(new Set<string>())
  /** Threads opened out of their folded line. */
  const expanded = ref(new Set<string>())
  /** Counts the presses that found their form already open, for the form to take focus. */
  const reachedAgain = ref(0)
  let owedReply: { id: number; right: FocusRight } | null = null
  let opener: HTMLElement | null = null

  useDraftSource('reply', () => Object.values(replies.value).some((text) => text.trim()))
  useDraftSource('resolution', () => Object.values(decisions.value).some((text) => text.trim()))

  watch(identity, () => {
    open.value = null
    replies.value = {}
    decisions.value = {}
    marks.value = {}
    stepsOf.value = null
    added.value = null
    failedAt.value = null
    held.value = new Set()
    expanded.value = new Set()
    owedReply = null
    opener = null
  })

  const errorAt = (key: string, form: ThreadForm | 'reopen') =>
    failedAt.value?.key === key && failedAt.value.form === form ? error.value : ''
  const hasDraft = (key: string) =>
    Boolean(replies.value[key]?.trim() || decisions.value[key]?.trim())
  const isOpen = (key: string, form?: ThreadForm) =>
    open.value?.key === key && (form === undefined || open.value.form === form)

  const stepsOpen = (key: string, entry: number) => isOpen(key, 'steps') && stepsOf.value === entry

  /** `entry` is the comment whose list a steps form takes its points from. */
  function show(key: string, form: ThreadForm, press?: Event, entry: number | null = null) {
    failedAt.value = null
    added.value = null
    opener = press?.currentTarget instanceof HTMLElement ? press.currentTarget : null
    if (open.value?.key === key && open.value.form === form && stepsOf.value === entry)
      reachedAgain.value += 1
    else open.value = { form, key }
    stepsOf.value = entry
  }
  async function hide(back: ThreadForm, right: FocusRight) {
    const key = open.value?.key
    open.value = null
    failedAt.value = null
    if (!key) return
    await nextTick()
    const first = anchored(back === 'resolve' ? resolveAnchor(key) : replyAnchor(key))
    const to = opener?.isConnected ? opener : first
    opener = null
    right.take(() => to?.focus())
  }
  /** Escape, or Cancel: the words go with it, since asking first is the form's. */
  function cancel() {
    const current = open.value
    if (!current) return
    if (current.form === 'reply') {
      replies.value[current.key] = ''
      marks.value[current.key] = false
    } else if (current.form === 'resolve') decisions.value[current.key] = ''
    void hide(current.form, grantFocus())
  }

  /** Focus on a reply that has just arrived, when one is owed. */
  function settleFocus() {
    if (owedReply === null) return
    const target = anchored(writtenAnchor(owedReply.id))
    if (!target) return
    const { right } = owedReply
    owedReply = null
    right.take(() => moveFocus(target))
  }

  /** The root's id goes with the parent when the reply is to mark the thread as well. */
  function sendReply(key: string, parent: ThreadParent, root: number | null) {
    const marking = root !== null && marks.value[key] === true
    failedAt.value = { form: 'reply', key }
    if (marking) held.value.add(key)
    const right = grantFocus()
    void writes.reply(parent, replies.value[key] ?? '', marking ? root : null, (written) => {
      replies.value[key] = ''
      marks.value[key] = false
      void hide('reply', right).then(() => {
        if (marking && !writes.unmarked.value.has(root)) {
          right.take(() => moveFocus(anchored(entryAnchor(root))))
        } else {
          owedReply = { id: written, right }
          settleFocus()
        }
      })
    })
  }
  function sendResolve(key: string, root: number) {
    failedAt.value = { form: 'resolve', key }
    const right = grantFocus()
    void writes.resolve(root, decisions.value[key] ?? '', () => {
      decisions.value[key] = ''
      held.value.add(key)
      expanded.value.delete(key)
      open.value = null
      failedAt.value = null
      void nextTick(() => right.take(() => moveFocus(anchored(entryAnchor(root)))))
    })
  }
  function sendReopen(key: string, root: number) {
    failedAt.value = { form: 'reopen', key }
    // The write disables the button that was pressed, which drops focus on the page: it comes
    // back there unless the person has taken it somewhere since.
    const right = grantFocus()
    void writes.reopen(root).then(async () => {
      await nextTick()
      right.take(() => anchored(resolveAnchor(key))?.focus())
    })
  }
  function markAgain(key: string, root: number) {
    held.value.add(key)
    const right = grantFocus()
    void writes.markAgain(root, () => {
      if (!writes.unmarked.value.has(root)) right.take(() => moveFocus(anchored(entryAnchor(root))))
    })
  }
  function sendSteps(
    key: string,
    entry: number,
    card: Pick<WorkItem, 'checklist' | 'revision'>,
    points: string[],
  ) {
    failedAt.value = { form: 'steps', key }
    const right = grantFocus()
    void writes.addSteps(card, points, () => {
      void hide('steps', right)
      added.value = { count: points.length, entry }
    })
  }
  function toggle(key: string) {
    if (!expanded.value.delete(key)) expanded.value.add(key)
  }

  return {
    added,
    cancel,
    decisions,
    errorAt,
    expanded,
    hasDraft,
    held,
    isOpen,
    markAgain,
    marks,
    pending,
    reachedAgain,
    replies,
    sendReopen,
    sendReply,
    sendResolve,
    sendSteps,
    settleFocus,
    show,
    stepsOpen,
    toggle,
    unmarked: writes.unmarked,
  }
}

/** The card's forms, for the threads under `InspectorThread`, which owns them. */
export function provideThreadForms(forms: ThreadForms) {
  provide(THREAD_FORMS, forms)
}

export function injectThreadForms() {
  const forms = inject(THREAD_FORMS)
  if (!forms) throw new Error('A thread stands inside InspectorThread')
  return forms
}
