import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useTimeoutFn } from '@vueuse/core'

import { workItemLinkAddress } from '@/shared/api/platformRoute.ts'

/** Long enough to read the longest note twice; then the line is the item's again. */
const NOTE_SHOWN_MS = 5000

/**
 * Copying a work item's number or its short address, `/open/<number>` on this origin, which
 * opens the card wherever it is followed: the desktop app has no address bar to take it from.
 * Each says what happened in a note, and a clipboard that refuses is said as refused. A card's
 * head and the card a reference shows both copy through this, with the same words.
 */
export function useWorkItemCopy(reference: () => string) {
  const { t } = useI18n()
  const note = ref('')
  const failed = ref(false)
  const { start: expire } = useTimeoutFn(
    () => {
      note.value = ''
    },
    NOTE_SHOWN_MS,
    { immediate: false },
  )

  /** Put `text` on the clipboard and say whether it got there. */
  async function copy(text: string, done: string, refused: string) {
    const words = { reference: reference() }
    try {
      await navigator.clipboard.writeText(text)
      failed.value = false
      note.value = t(done, words)
    } catch {
      failed.value = true
      note.value = t(refused, words)
    }
    expire()
  }

  // One card shows at a time and moves from reference to reference: a note is about the last one.
  watch(reference, () => {
    note.value = ''
  })

  return {
    failed,
    note,
    copyReference: () =>
      copy(reference(), 'workItem.head.referenceCopied', 'workItem.head.referenceCopyFailed'),
    copyLink: () =>
      copy(
        workItemLinkAddress(location.origin, reference()),
        'workItem.head.linkCopied',
        'workItem.head.linkCopyFailed',
      ),
  }
}
