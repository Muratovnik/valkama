import { watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { workItemLinkAddress } from '@/shared/api/platformRoute.ts'
import { useCopyNote } from '@/shared/lib/copyNote.ts'

/**
 * Copying a work item's number or its short address, `/open/<number>` on this origin, which
 * opens the card wherever it is followed: the desktop app has no address bar to take it from.
 * Each says what happened in a note, and a clipboard that refuses is said as refused
 * (`useCopyNote`). A card's head and the card a reference shows both copy through this, with the
 * same words.
 */
export function useWorkItemCopy(reference: () => string) {
  const { t } = useI18n()
  const { clear, copy, failed, note } = useCopyNote()

  /** Put `text` on the clipboard and say whether it got there. */
  const copyAs = (text: string, done: string, refused: string) => {
    const words = { reference: reference() }
    return copy(text, t(done, words), t(refused, words))
  }

  // One card shows at a time and moves from reference to reference: a note is about the last one.
  watch(reference, clear)

  return {
    failed,
    note,
    copyReference: () =>
      copyAs(reference(), 'workItem.head.referenceCopied', 'workItem.head.referenceCopyFailed'),
    copyLink: () =>
      copyAs(
        workItemLinkAddress(location.origin, reference()),
        'workItem.head.linkCopied',
        'workItem.head.linkCopyFailed',
      ),
  }
}
