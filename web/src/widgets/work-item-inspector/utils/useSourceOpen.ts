import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { openSourceReference, sourceFeedback } from '@/shared/lib/sourceReference.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'

/**
 * Opening an item's plan anchor, and what to say when the shell could not.
 *
 * The desktop shell opens a validated local reference; a browser has no
 * local-file authority, so it copies the path and says so. Both are useful and
 * only one of them is silent, which is why the note exists at all. The card's
 * head offers the anchor as an icon and its Relations name the path, and each
 * says what happened where it was pressed.
 */
export function useSourceOpen(source: () => string, resourceRef: () => PlanningSpaceEntityRef) {
  const { t } = useI18n()
  const note = ref('')

  async function open() {
    const result = await openSourceReference({ source: source(), resource_ref: resourceRef() })
    const outcome = sourceFeedback(result)
    if (outcome === 'copied') note.value = t('source.copied')
    else if (outcome === 'failed') note.value = t('source.failed', { message: result.error ?? '' })
    else note.value = ''
  }

  return { note, open }
}
