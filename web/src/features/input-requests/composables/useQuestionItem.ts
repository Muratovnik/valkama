import { shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import { useElementVisibility } from '@vueuse/core'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { fetchWorkItem } from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'

/**
 * The card a question is about, for a kind whose content is the card itself: a review's outcome,
 * a goal's description and conditions, a task's description. The question carries none of them.
 *
 * It is read once, when the question first comes into view, so a list of a hundred questions
 * reads the cards of those the person reaches and not every one at its opening. A read that fails
 * says so in the content; the question can still be answered from its own words.
 */
export function useQuestionItem(
  entry: () => InputRequestEntry,
  wanted: () => boolean,
  element: Readonly<Ref<HTMLElement | null>>,
) {
  const item = shallowRef<WorkItem | null>(null)
  const failed = shallowRef(false)
  const seen = useElementVisibility(element)
  let read = ''
  watch(
    [seen, () => entry().request.reference, wanted],
    async ([visible, reference, want]) => {
      if (!visible || !want || read === reference) return
      read = reference
      failed.value = false
      try {
        const found = await fetchWorkItem(reference, entry().target.space_ref)
        if (read === reference) item.value = found
      } catch {
        if (read === reference) failed.value = true
      }
    },
    { immediate: true },
  )
  return { failed, item }
}
