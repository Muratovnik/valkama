/**
 * What each list row spells out beyond its marks: when the item last changed,
 * and the holder's whole name for the hover of a column that cuts it short.
 *
 * Made once per change of the items or the language rather than once per
 * drawing: a keystroke that moves focus redraws rows, and formatting a date is
 * the dearest thing a row does. Who holds an item is the facet registry's to
 * say, so the hover reads the same words the column prints.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { facetMarks } from '@/entities/work-item/utils/facets.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

interface RowWords {
  holder: string
  updated: string
}

export function useListWords(items: () => readonly WorkItemBrief[]) {
  const { t, d, locale } = useI18n()
  const thisYear = new Date().getFullYear()

  /** When, to the minute; the year only when it is not this one, so nothing is left out. */
  function when(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.valueOf())) return value
    return d(date, date.getFullYear() === thisYear ? 'day' : 'activity')
  }

  function holder(item: WorkItemBrief): string {
    const [mark] = facetMarks('holder', 'list', item)
    if (!mark) return ''
    return 'literal' in mark.text ? mark.text.literal : t(mark.text.key, mark.text.params ?? {})
  }

  const words = computed(() => {
    void locale.value
    return new Map<string, RowWords>(
      items().map((item) => [
        item.work_item_id,
        { holder: holder(item), updated: when(item.updated_at) },
      ]),
    )
  })

  const wordsOf = (item: WorkItemBrief): RowWords =>
    words.value.get(item.work_item_id) ?? { holder: '', updated: '' }

  return {
    holderOf: (item: WorkItemBrief) => wordsOf(item).holder,
    updatedOf: (item: WorkItemBrief) => wordsOf(item).updated,
  }
}
