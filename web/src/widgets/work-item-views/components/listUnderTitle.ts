/**
 * What a list row prints under its title. A wide list prints an open blocker and
 * the labels there; a narrower one prints what its folded columns say instead,
 * as one line of facts: the state where its column folded and an open blocker,
 * the holder, the steps and the date. «Goal and stage», wherever its column
 * folded, leads with a line of its own on a wide list and leads the facts on a
 * narrower one. The row's words for the list's find say them in this order too
 * (`listRowWords.ts`).
 *
 * It is drawn from the list's own render as plain elements, as the row's first
 * cell is (`listRefCell.ts`), not as a component, which would be another
 * instance in every row; its look stays the list's.
 */
import { Fragment, h } from 'vue'
import type { VNode } from 'vue'

import type { useListRuns } from '@/widgets/work-item-views/composables/useListRuns.ts'
import { labelsUnder } from '@/widgets/work-item-views/utils/listColumns.ts'
import type { Fit, SortKey } from '@/widgets/work-item-views/utils/listColumns.ts'
import { factsOf, ROW_FACETS } from '@/widgets/work-item-views/utils/listRowWords.ts'

import { holderRef, surfaceMarks } from '@/entities/work-item/utils/facets.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

const fact = (words: string) => h('span', { class: 'list-fact' }, words)

interface UnderTitleList {
  runs: Pick<ReturnType<typeof useListRuns>, 'context' | 'facts' | 'filtering'>
  fit: () => Fit
  /** Whether a column has folded under the title. */
  folded: (key: SortKey) => boolean
  /** «Goal › Stage», where that column folded; empty where it stands or is not drawn. */
  goal: (item: WorkItemBrief) => string
  /** When the row last moved, as the list says it. */
  updated: (item: WorkItemBrief) => string
}

/** Draws what a row prints under its title, for a list whose columns fold as these say. */
export function listUnderTitle({ fit, folded, goal, runs, updated }: UnderTitleList) {
  const { HOLDER, STEPS, UNDER } = ROW_FACETS

  function facts(item: WorkItemBrief, path: string): VNode {
    return h('span', { class: 'list-facts' }, [
      path ? fact(path) : null,
      runs.facts(item, factsOf(fit()), runs.context(item)),
      // A dash says "nobody" under a heading; on a line of facts it says nothing.
      holderRef(item) ? runs.facts(item, HOLDER) : null,
      folded('checklist') && item.checklist.length > 0 ? runs.facts(item, STEPS) : null,
      folded('updated') ? fact(updated(item)) : null,
    ])
  }

  return (item: WorkItemBrief): VNode => {
    const path = goal(item)
    if (!labelsUnder(fit())) return facts(item, path)
    const under = runs.filtering(surfaceMarks('list', item, runs.context(item), UNDER))
    return h(Fragment, [
      path ? h('span', { class: 'list-facts' }, [fact(path)]) : null,
      h('span', { class: 'list-under' }, [under]),
    ])
  }
}
