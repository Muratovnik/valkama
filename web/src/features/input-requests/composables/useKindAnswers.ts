import { computed, nextTick, ref } from 'vue'
import type { Ref } from 'vue'

import type { Outcome } from '@/features/input-requests/composables/useRequestWrites.ts'
import { useStepAttention } from '@/features/input-requests/composables/useStepAttention.ts'
import { kindAnswerDraft } from '@/features/input-requests/utils/questionRecord.ts'
import type { QuestionRecord } from '@/features/input-requests/utils/questionRecord.ts'
import { editField } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { CancelList } from '@/shared/api/inputRequestAction.ts'
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'

/** What of one question's writes its kind's answers press on. */
interface Writes {
  busy: Readonly<Ref<boolean>>
  declining: Readonly<Ref<boolean>>
  /** What the last answer would cancel, as the server's refusal listed it to be confirmed. */
  listed: Readonly<Ref<CancelList | null>>
  requiresRefresh: Readonly<Ref<boolean>>
  sendDisabled: Readonly<Ref<boolean>>
  writable: Readonly<Ref<boolean>>
  resolve: (action: 'answer', given: { draft: RequestDraft }) => Promise<Outcome>
  stepBack: () => void
}

/**
 * The answers of a question's kind, where its kind is not a choice: which one asks first and
 * whether its asking stands, the day a put-off goes to, and the press of each.
 *
 * Each answer writes through the question's own write (`writes.resolve`), with its values over
 * what the form holds (`kindAnswerDraft`). The first press of one that cannot be taken back writes
 * nothing and asks; its asking stands only while the question can be written, and ends as the
 * step of declining does (`useStepAttention`), which is one step with it. The answer that puts the
 * question off opens the choice of a day or of a card whose close brings it back, which is part of
 * what the form holds, and opens again on a form that holds either.
 *
 * An answer that cancels work the question did not ask about is refused with the list of that
 * work (`writes.listed`): its asking stands again over that list, and its confirmed retry sends
 * the list's token, the refusal's and never the one the question was asked with, which listed
 * work the answer itself cancels first.
 */
export function useKindAnswers(host: {
  /** The id of the choice of a day, which the answer that opens it controls. */
  laterId: string
  question: Readonly<Ref<HTMLElement | null>>
  waiting: Readonly<Ref<boolean>>
  writes: Writes
  answers: () => QuestionRecord['answers']
  draft: () => RequestDraft
  /** The question, whose space the cards a put-off can wait on are searched in. */
  entry: () => InputRequestEntry
  /** Focus goes to the day once its choice opens. */
  focusDay: () => void
  kind: () => QuestionRecord['kind']
  /** What the form holds is replaced. */
  write: (draft: RequestDraft) => void
}) {
  const { writes } = host
  /** It waits for one of its kind's answers rather than for its form. */
  const byAnswers = computed(
    () => host.kind() !== 'choice' && host.answers().length > 0 && host.waiting.value,
  )
  /** The answer whose first press asked, by its place. */
  const asked = ref<number | null>(null)
  const asking = computed(() =>
    byAnswers.value && writes.writable.value && !writes.requiresRefresh.value ? asked.value : null,
  )
  /** A step of asking stands, of declining or of a kind's answer. */
  const stepStands = computed(() => writes.declining.value || asking.value !== null)
  function back() {
    asked.value = null
  }
  useStepAttention(host.question, stepStands, () => {
    writes.stepBack()
    back()
  })

  const laterAnswer = computed(() => host.answers().findIndex((answer) => answer.later))
  const laterField = computed(() => host.answers()[laterAnswer.value]?.later?.field ?? '')
  const dayIn = (draft: RequestDraft) => {
    const day = draft.answers[laterField.value]
    return typeof day === 'string' ? day : ''
  }
  const laterDay = computed(() => dayIn(host.draft()))
  const laterOpen = ref(dayIn(host.draft()) !== '')
  /** The choice of a day: its id, whether it stands open, and the day it holds. */
  const laterControl = computed(() =>
    byAnswers.value && laterAnswer.value >= 0
      ? {
          controls: host.laterId,
          entry: host.entry(),
          open: laterOpen.value,
          value: laterDay.value,
        }
      : null,
  )
  function chooseDay(day: string) {
    host.write(editField(host.draft(), laterField.value, { value: day === '' ? null : day }))
  }
  const writeAnswer = (index: number) => {
    const token = writes.listed.value?.list_token
    return writes.resolve('answer', {
      draft: kindAnswerDraft(host.answers(), index, host.draft(), token),
    })
  }
  async function press(index: number, confirmed: boolean) {
    const answer = host.answers()[index]
    if (!answer || writes.busy.value) return
    if (answer.later) {
      laterOpen.value = !laterOpen.value
      if (!laterOpen.value) return
      await nextTick()
      host.focusDay()
      return
    }
    // The first press of an answer that cannot be taken back writes nothing: it asks.
    if (answer.twoStep && !confirmed) {
      if (!writes.sendDisabled.value) asked.value = index
      return
    }
    back()
    const outcome = await writeAnswer(index)
    if (outcome === 'failed' && writes.listed.value) asked.value = index
  }
  const putOff = () => void writeAnswer(laterAnswer.value)
  /** The answers the foot offers: a kind's while it waits for them, none otherwise. */
  const offered = computed(() => (byAnswers.value ? host.answers() : []))
  return {
    asking,
    back,
    byAnswers,
    chooseDay,
    laterControl,
    offered,
    press,
    putOff,
    stepStands,
  }
}
