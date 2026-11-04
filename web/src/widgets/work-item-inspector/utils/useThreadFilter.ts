import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useStorage } from '@vueuse/core'

import { threadCounts } from '@/widgets/work-item-inspector/utils/threadRows.ts'
import type { ThreadFilter, ThreadRow } from '@/widgets/work-item-inspector/utils/threadRows.ts'

/**
 * How many threads are still open, and which of them to show.
 *
 * The choice lasts as long as the window: it says how this person is reading now, not what
 * any link points at, so it is neither in the address nor kept for the next visit. Storage
 * that refuses it keeps the choice for as long as the page. With no thread to filter there
 * is no filter, whatever was chosen on the last card.
 */
export function useThreadFilter(rows: () => readonly ThreadRow[]) {
  const { t } = useI18n()
  const counts = computed(() => threadCounts(rows()))
  const chosen = useStorage<ThreadFilter>(
    'valkama-thread-filter',
    'all',
    typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
    {
      onError() {
        // Storage that refuses a write keeps the choice for as long as the page.
      },
    },
  )
  const filter = computed<ThreadFilter>(() =>
    counts.value.markable > 0 && chosen.value === 'unresolved' ? 'unresolved' : 'all',
  )
  const options = computed(() => [
    { label: t('threads.filterAll'), value: 'all' as const },
    {
      label: t('threads.filterUnresolved', { n: counts.value.unresolved }),
      value: 'unresolved' as const,
    },
  ])
  return { chosen, counts, filter, options }
}
