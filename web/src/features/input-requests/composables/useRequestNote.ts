import { computed, nextTick, ref, watch } from 'vue'
import type { Ref } from 'vue'

/**
 * Whether a comment stands open. Its press and its field stand apart, on a field and on the
 * whole question alike, so this is what they share.
 *
 * It opens on that press and closes on the same press while it is empty, and never over
 * something written. What was written keeps it open even once it is emptied, or it would close
 * under the person emptying it and leave focus nowhere; only the press closes it.
 */
export function useRequestNote(
  text: () => string,
  preview: Ref<boolean>,
  editor: () => { focus: () => void } | null,
) {
  const asked = ref(false)
  const written = computed(() => Boolean(text().trim()))
  const open = computed(() => asked.value || written.value)
  watch(
    written,
    (now) => {
      if (now) asked.value = true
    },
    { immediate: true },
  )
  async function press() {
    if (!written.value) asked.value = !asked.value
    if (!open.value) return
    preview.value = false
    await nextTick()
    editor()?.focus()
  }
  return { open, press, written }
}
