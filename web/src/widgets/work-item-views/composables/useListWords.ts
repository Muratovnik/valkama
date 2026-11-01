/**
 * What each list row spells out beyond its marks: when the item last changed,
 * and the holder's whole name for the hover of a column that cuts it short.
 *
 * Made once per change of the items or the language rather than once per
 * drawing: a keystroke that moves focus redraws rows, and formatting a date is
 * the dearest thing a row does. The two formats are made once for the language
 * too, from the same named formats a card's dates use, since asking for a named
 * format by name a thousand times cost more than the formatting. Who holds an
 * item is the facet registry's to say, so the hover reads the same words the
 * column prints.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useMarkWords } from '@/entities/work-item/composables/useMarkWords.ts'
import { facetMarks } from '@/entities/work-item/utils/facets.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

interface RowWords {
  holder: string
  updated: string
}

export function useListWords(items: () => readonly WorkItemBrief[]) {
  const i18n = useI18n()
  const { say } = useMarkWords()
  const thisYear = new Date().getFullYear()

  function holder(item: WorkItemBrief): string {
    const [mark] = facetMarks('holder', 'list', item)
    return mark ? say(mark.text) : ''
  }

  const words = computed(() => {
    const formats = i18n.getDateTimeFormat(i18n.locale.value) as Record<
      'activity' | 'day',
      Intl.DateTimeFormatOptions
    >
    const thisYearsDate = new Intl.DateTimeFormat(i18n.locale.value, formats.day)
    const anyDate = new Intl.DateTimeFormat(i18n.locale.value, formats.activity)
    /** When, to the minute; the year only when it is not this one, so nothing is left out. */
    const when = (value: string) => {
      const date = new Date(value)
      if (Number.isNaN(date.valueOf())) return value
      return (date.getFullYear() === thisYear ? thisYearsDate : anyDate).format(date)
    }
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
