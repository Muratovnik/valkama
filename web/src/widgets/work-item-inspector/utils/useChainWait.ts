import { computed } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { useFocusThroughWait } from '@/shared/lib/useFocusThroughWait.ts'
import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'

/**
 * The chain section's wait for its read, in `area`.
 *
 * The first read of the chain is shown as every wait is: nothing for a read that answers
 * quickly, and once shown, long enough to be read, with the chain held back meanwhile
 * (`held`). A read again with the chain on screen keeps it there and shows nothing.
 *
 * The section is a block of the card, so its wait is no announcement of its own: the card
 * has one status region for its waits, and the section says its wait by its busy mark and
 * its word on screen (`word`, the panel's, once the wait is shown, and nothing before).
 *
 * Retry is hidden with the failure it answers while its read waits, as the chain is held back,
 * which drops focus from it to the page. Focus comes back to it once the read has failed again
 * and the failure stands once more (`useFocusThroughWait`); a read that answered takes the
 * failure and its Retry away, and gives nothing.
 */
export function useChainWait(
  read: { readonly chain: WorkItemChain | null; readonly loading: boolean },
  area: Readonly<Ref<HTMLElement | null>>,
) {
  const { t } = useI18n()
  const { shown, held } = useLoadingPresence(() => !read.chain && read.loading)
  useFocusThroughWait(
    () => area.value,
    () => read.loading || held.value,
  )
  const word = computed(() => (shown.value ? t('platform.states.loading') : ''))
  return { held, word }
}
