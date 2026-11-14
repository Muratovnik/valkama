/**
 * The runs a list row prints, drawn from the facet registry as plain elements.
 *
 * A row holds seven of them, and a component for each came to eleven instances
 * a row, some fourteen thousand on a space of a thousand rows, for marks that
 * hold no state of their own. The marks that filter are drawn out of the Tab
 * order, so the row stays one stop, and a glyph filters only where it is not
 * read instead, which on a phone's list it is.
 *
 * What a row's marks need beyond the item is the item it waits on and the
 * width the marks read, which decides whether labels print: a row is drawn and
 * read for the find again where the list crosses such a width, not on every
 * pixel.
 */
import { computed } from 'vue'
import type { Ref } from 'vue'

import { ROW_FACETS } from '@/widgets/work-item-views/utils/listRowWords.ts'

import { drawMarks, drawWordCell } from '@/entities/work-item/components/drawMarks.ts'
import { useMarkWords } from '@/entities/work-item/composables/useMarkWords.ts'
import { leadMarks, markWidth, surfaceMarks } from '@/entities/work-item/utils/facets.ts'
import type { FacetContext, FacetId, FacetMark } from '@/entities/work-item/utils/facets.ts'
import { waitingOn } from '@/entities/work-item/utils/waiting.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

interface ListRuns {
  width: Readonly<Ref<number>>
  filter: () => WorkFilter
  /** The items the rows can stand for, which the links' waits are read among. */
  items: () => readonly WorkItemBrief[]
  links: () => readonly PlanningEdge[]
  narrow: () => boolean
  onFilter: (token: WorkFilterToken) => void
}

export function useListRuns({ filter, items, links, narrow, onFilter, width }: ListRuns) {
  const words = useMarkWords()
  const waiting = computed(() => waitingOn([...links()], [...items()]))
  const readWidth = computed(() => markWidth('list', width.value))
  function context(item: WorkItemBrief): FacetContext {
    return { waitingOn: waiting.value.get(item.work_item_id) ?? null, width: readWidth.value }
  }
  /** A glyph is a 14px mark; on a phone's list it is read, and the bar filters. */
  const glyphsFilter = computed(() => !narrow())

  /** How marks that filter are drawn. */
  const filterRun = (filterable = true) => ({
    filter: filter(),
    filterable,
    onFilter,
    surface: 'list' as const,
    tabbable: false,
    words,
  })
  /** A run that filters. */
  const filtering = (marks: readonly FacetMark[], filterable = true) =>
    drawMarks(marks, filterRun(filterable))

  return {
    context,
    /** Marks read as facts. */
    facts: (item: WorkItemBrief, facets: readonly FacetId[], asked: FacetContext = {}) =>
      drawMarks(surfaceMarks('list', item, asked, facets), { surface: 'list', words }),
    /** One mark in a cell of its own. */
    fact: (item: WorkItemBrief, facet: readonly FacetId[]) =>
      drawMarks(surfaceMarks('list', item, {}, facet), { solo: true, surface: 'list', words }),
    filtering,
    /** The glyph before a reference, in its fixed slot. */
    lead: (item: WorkItemBrief, facet: FacetId) =>
      filtering(leadMarks(facet, 'list', item), glyphsFilter.value),
    priorityWord: (item: WorkItemBrief) =>
      drawWordCell(surfaceMarks('list', item, {}, ROW_FACETS.PRIORITY), filterRun()),
    readWidth,
    waiting,
    /** A column's word, the mark and nothing round it. */
    word: (item: WorkItemBrief, facets: readonly FacetId[]) =>
      drawWordCell(surfaceMarks('list', item, {}, facets), { surface: 'list', words }),
    words,
  }
}
