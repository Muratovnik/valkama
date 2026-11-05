import { watch } from 'vue'
import type { Ref } from 'vue'

import type { InspectorSection } from '@/widgets/work-item-inspector/utils/useInspectorSections.ts'

interface QuestionReveal {
  overview: Ref<{ readQuestions(): Promise<boolean>; revealQuestion(): Promise<void> } | null>
  section: Ref<InspectorSection>
  /** An address asked this card to go to its waiting question. */
  asked: () => boolean
  /** The body is as tall as it will be. */
  settled: () => boolean
  /** The order has reached the card and is spent, whatever it finds. */
  taken: () => void
}

/**
 * Going to the question that waits on a card: from the mark in its facts, and from an
 * address, which is a click on a notification about that question.
 *
 * An address does not press the mark as soon as it can. A chain arriving above the question
 * would take it off the screen, so it waits for the body. What the card has read may be out
 * of date by the click, so it goes by a read from now, and a question that no longer waits
 * leaves the card as it stands, on whichever section it shows.
 */
export function useQuestionReveal(options: QuestionReveal) {
  function revealQuestion() {
    options.section.value = 'overview'
    void options.overview.value?.revealQuestion()
  }

  watch(
    () => options.asked() && options.settled() && options.overview.value !== null,
    async (ready) => {
      if (!ready) return
      options.taken()
      if (await options.overview.value?.readQuestions()) revealQuestion()
    },
    { flush: 'post', immediate: true },
  )

  return { revealQuestion }
}
