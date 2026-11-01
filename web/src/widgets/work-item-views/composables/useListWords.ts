/**
 * What each list row spells out in words: who holds the item, or whether it is
 * there to be taken, and when it last changed.
 *
 * Made once per change of the items or the language rather than once per
 * drawing: a keystroke that moves focus redraws rows, and formatting a date is
 * the dearest thing a row does.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { readyIds } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { holderName } from '@/shared/lib/actor.ts'

export interface RowWords {
  claim: string
  updated: string
}

export function useListWords(items: () => readonly WorkItemBrief[]) {
  const { t, d, locale } = useI18n()
  const ready = computed(() => readyIds([...items()]))
  const thisYear = new Date().getFullYear()

  function claimLabel(item: WorkItemBrief): string {
    if (item.claim_ref)
      return item.state.is_terminal
        ? t('workItem.previousHolder', { holder: holderName(item.claim_ref) })
        : holderName(item.claim_ref)
    return ready.value.has(item.work_item_id) ? t('workItem.ready') : '—'
  }

  /** When, to the minute; the year only when it is not this one, so nothing is left out. */
  function when(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.valueOf())) return value
    return d(date, date.getFullYear() === thisYear ? 'day' : 'activity')
  }

  const words = computed(() => {
    void locale.value
    return new Map(
      items().map((item) => [
        item.work_item_id,
        { claim: claimLabel(item), updated: when(item.updated_at) },
      ]),
    )
  })

  return {
    ready,
    wordsOf: (item: WorkItemBrief): RowWords =>
      words.value.get(item.work_item_id) ?? { claim: '', updated: '' },
  }
}
