import { nextTick, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { draftFromAnswer } from '@/features/input-requests/utils/answerChange.ts'
import { EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'

/**
 * The way into a change of an answer and the way back out of it.
 *
 * In, the form opens on the answer in force and focus goes to it. Out, nothing changed closes
 * at once and anything changed is asked about first, with focus on going on, so a reflexive
 * Enter or Escape keeps the work. Whether it is open lives in the draft (`changing`), which
 * outlives this; only the asking is held here, since a dialog closing answers it anyway.
 */
export function useAnswerChange(host: {
  busy: Ref<boolean>
  request: ComputedRef<InputRequestEntry['request']>
  unchanged: ComputedRef<boolean>
  unsent: ComputedRef<string>
  /** Puts focus back on Cancel, where the asking could not. */
  focusCancel: () => void
  /** Puts focus back on the way in, once the form has closed. */
  focusChange: () => void
  forget: () => void
  /** Takes focus to the form that just opened. */
  reveal: () => void
  write: (draft: RequestDraft) => void
}) {
  const asking = ref(false)

  async function start() {
    host.write(draftFromAnswer(host.request.value, host.unsent.value))
    await nextTick()
    host.reveal()
  }
  async function end() {
    asking.value = false
    host.forget()
    host.write(EMPTY_DRAFT)
    await nextTick()
    host.focusChange()
  }
  function cancel() {
    if (host.busy.value) return
    if (host.unchanged.value) void end()
    else asking.value = true
  }
  /** The asking gives focus back to what asked it, or to Cancel if that could not take it yet. */
  async function keep() {
    asking.value = false
    await nextTick()
    if (document.activeElement === document.body) host.focusCancel()
  }
  return { asking, cancel, end, keep, start }
}
