import { ref } from 'vue'
import type { Ref } from 'vue'

import { useEventListener } from '@vueuse/core'

/**
 * Cancel and Escape for a thread's form, whose words exist nowhere else: an empty form goes
 * at once, and one with words in it asks first. A second Escape while the question stands
 * answers it the way the strip does: keep. The key stops at the form either way, so the
 * card around it never hears it and never asks about closing itself.
 *
 * The reply's field asked and the decision's line did not: each form had its own Escape, and
 * the decision's dropped what was typed without a word.
 */
export function useAskedCancel(
  form: Ref<HTMLElement | null>,
  empty: () => boolean,
  leave: () => void,
) {
  const asking = ref(false)
  function cancel() {
    if (empty()) leave()
    else asking.value = true
  }
  useEventListener(form, 'keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    if (asking.value) asking.value = false
    else cancel()
  })
  return { asking, cancel }
}
