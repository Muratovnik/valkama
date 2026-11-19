/**
 * What each list row spells out beyond its marks: when the item last changed,
 * the holder's whole name for the hover of a column that cuts it short, and the
 * goal and stages it stands under, «Goal › Stage», read from the whole space,
 * since a filter or a chain can leave a row's goal out of the rows.
 *
 * Made once per change of the items or the language rather than once per
 * drawing: a keystroke that moves focus redraws rows, and formatting a date is
 * the dearest thing a row does. The two formats are made once for the language
 * too, from the same named formats a card's dates use, since asking for a named
 * format by name a thousand times cost more than the formatting. Who holds an
 * item is the facet registry's to say, so the hover reads the same words the
 * column prints.
 *
 * The first word each column prints, in the font it prints in, is what the
 * widest row of a column is found by (`widestRows.ts`). In a tree the
 * reference stands after its row's indent, which is its column's `inset`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { PATH_STEP } from '@/widgets/work-item-views/utils/laneTitle.ts'

import { useMarkWords } from '@/entities/work-item/composables/useMarkWords.ts'
import { facetMarks } from '@/entities/work-item/utils/facets.ts'
import type { FacetId } from '@/entities/work-item/utils/facets.ts'
import { goalPath } from '@/entities/work-item/utils/workTree.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import type { WidthColumn } from '@/shared/ui/widestRows.ts'

interface RowWords {
  /** «Goal › Stage»; empty for work under no goal and for another space's card. */
  goal: string
  holder: string
  updated: string
}

/** What «Goal and stage» says of work under no goal: none, as a dash says nobody. */
const NO_GOAL = '—'

export function useListWords(
  items: () => readonly WorkItemBrief[],
  indent?: (item: WorkItemBrief) => number,
  space: () => readonly WorkItemBrief[] = items,
) {
  const i18n = useI18n()
  const { say } = useMarkWords()
  const thisYear = new Date().getFullYear()

  /** The first word a row's facet prints. */
  function facetWord(item: WorkItemBrief, facet: FacetId): string {
    const [mark] = facetMarks(facet, 'list', item)
    return mark ? say(mark.text) : ''
  }
  const holder = (item: WorkItemBrief) => facetWord(item, 'holder')

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
    const byId = new Map(space().map((item) => [item.work_item_id, item]))
    return new Map<string, RowWords>(
      items().map((item) => [
        item.work_item_id,
        {
          goal: goalPath(item, byId).join(PATH_STEP),
          holder: holder(item),
          updated: when(item.updated_at),
        },
      ]),
    )
  })

  const wordsOf = (item: WorkItemBrief): RowWords =>
    words.value.get(item.work_item_id) ?? { goal: '', holder: '', updated: '' }

  const goalOf = (item: WorkItemBrief) => wordsOf(item).goal
  const holderOf = (item: WorkItemBrief) => wordsOf(item).holder
  const updatedOf = (item: WorkItemBrief) => wordsOf(item).updated
  /**
   * What the column prints: the path, or a dash for work under no goal. Another
   * space's card has its goal in its own space, which the read does not name, so
   * the column says nothing of it rather than that it has none.
   */
  const goalCellOf = (item: WorkItemBrief) => goalOf(item) || (item.other_space ? '' : NO_GOAL)
  const widths: WidthColumn<WorkItemBrief>[] = [
    { font: '--font-line', inset: indent, word: (item) => item.reference },
    { font: '--font-line', word: (item) => item.title },
    { font: '--font-detail', word: goalCellOf },
    { font: '--font-field-label', word: (item) => facetWord(item, 'state') },
    { font: '--font-detail', word: (item) => facetWord(item, 'priority') },
    { font: '--font-detail', word: holderOf },
    { font: '--font-detail', word: (item) => facetWord(item, 'steps') },
    { font: '--font-line', word: updatedOf },
  ]

  return { goalCellOf, goalOf, holderOf, updatedOf, widths }
}
