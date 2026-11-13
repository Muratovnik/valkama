/**
 * Why the last change of the view asked for was not made, and where it was asked: under the
 * filters, or in a part of the report. It stands until the view moves, whatever moved it.
 */
import { computed, ref, watch } from 'vue'

import type { ReportPart } from '@/pages/analytics/utils/panelAnswer.ts'

export function useRefusal(view: () => unknown) {
  const refused = ref<{ part: ReportPart | 'filters'; words: string } | null>(null)
  watch(view, () => {
    refused.value = null
  })

  /** Says why a change asked in `part` was not made. */
  function refuse(part: ReportPart | 'filters', words: string) {
    refused.value = { part, words }
  }

  const filtersRefused = computed(() =>
    refused.value?.part === 'filters' ? refused.value.words : '',
  )
  const reportRefused = computed(() =>
    refused.value && refused.value.part !== 'filters'
      ? { part: refused.value.part, words: refused.value.words }
      : null,
  )

  return { filtersRefused, refuse, reportRefused }
}
