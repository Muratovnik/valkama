import { ref } from 'vue'

import { useTimeoutFn } from '@vueuse/core'

/** Long enough to read the longest note twice; then the place is what it said before. */
const NOTE_SHOWN_MS = 5000

/**
 * A copy to the clipboard and the note that says what came of it: the words for a copy made, or
 * for a clipboard that refused, for a few seconds. A card's identity line and the quota's
 * accounts copy through this, so every copy confirms itself alike.
 */
export function useCopyNote() {
  const note = ref('')
  const failed = ref(false)
  const { start: expire } = useTimeoutFn(
    () => {
      note.value = ''
    },
    NOTE_SHOWN_MS,
    { immediate: false },
  )

  /** Put `text` on the clipboard and say whether it got there, in the words given for each. */
  async function copy(text: string, done: string, refused: string) {
    try {
      await navigator.clipboard.writeText(text)
      failed.value = false
      note.value = done
    } catch {
      failed.value = true
      note.value = refused
    }
    expire()
  }

  /** The note taken away at once, as when what it was about is no longer on show. */
  function clear() {
    note.value = ''
  }

  return { clear, copy, failed, note }
}
