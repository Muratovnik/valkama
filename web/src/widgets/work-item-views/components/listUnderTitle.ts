/**
 * What a list row prints under its title. A wide list prints an open blocker and
 * the labels there; a narrower one prints what its folded columns say instead,
 * as one line of facts: the state where its column folded and an open blocker,
 * the holder, the steps and the date. «Goal and stage» and «Project», wherever
 * their columns folded, lead with a line of their own on a wide list and lead the
 * facts on a narrower one. The row's words for the list's find say them in this order too
 * (`listRowWords.ts`).
 *
 * It is drawn from the list's own render as plain elements, as the row's first
 * cell is (`listRefCell.ts`), not as a component, which would be another
 * instance in every row; its look stays the list's.
 */
import { Fragment, h, withDirectives } from 'vue'
import type { VNode } from 'vue'

import type { useListRuns } from '@/widgets/work-item-views/composables/useListRuns.ts'
import { labelsUnder } from '@/widgets/work-item-views/utils/listColumns.ts'
import type { Fit, SortKey } from '@/widgets/work-item-views/utils/listColumns.ts'
import { factsOf, ROW_FACETS } from '@/widgets/work-item-views/utils/listRowWords.ts'

import { holderRef, surfaceMarks } from '@/entities/work-item/utils/facets.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const fact = (words: string) => h('span', { class: 'list-fact' }, words)
/** The path on one line, cut at the row's edge and whole on hover while it is cut. */
const pathFact = (path: string) =>
  withDirectives(h('span', { class: 'list-fact one-line' }, path), [
    [vTooltip, path, undefined, { clipped: true }],
  ])

interface UnderTitleList {
  runs: Pick<ReturnType<typeof useListRuns>, 'context' | 'facts' | 'filtering'>
  fit: () => Fit
  /** Whether a column has folded under the title. */
  folded: (key: SortKey) => boolean
  /** «Goal › Stage», where that column folded; empty where it stands or is not drawn. */
  goal: (item: WorkItemBrief) => string
  /** The row's project, where that column folded; empty where it stands, is not drawn or names none. */
  project: (item: WorkItemBrief) => string
  /** When the row last moved, as the list says it. */
  updated: (item: WorkItemBrief) => string
}

/** Draws what a row prints under its title, for a list whose columns fold as these say. */
export function listUnderTitle({ fit, folded, goal, project, runs, updated }: UnderTitleList) {
  const { HOLDER, STEPS, UNDER } = ROW_FACETS
  /** Where a row stands and what it changes, first under its title wherever they folded. */
  const lead = (item: WorkItemBrief) => {
    const [path, named] = [goal(item), project(item)]
    return [path ? pathFact(path) : null, named ? fact(named) : null]
  }

  function facts(item: WorkItemBrief): VNode {
    return h('span', { class: 'list-facts' }, [
      ...lead(item),
      runs.facts(item, factsOf(fit()), runs.context(item)),
      // A dash says "nobody" under a heading; on a line of facts it says nothing.
      holderRef(item) ? runs.facts(item, HOLDER) : null,
      folded('checklist') && item.checklist.length > 0 ? runs.facts(item, STEPS) : null,
      folded('updated') ? fact(updated(item)) : null,
    ])
  }

  return (item: WorkItemBrief): VNode => {
    if (!labelsUnder(fit())) return facts(item)
    const under = runs.filtering(surfaceMarks('list', item, runs.context(item), UNDER))
    const led = lead(item)
    return h(Fragment, [
      led.some(Boolean) ? h('span', { class: 'list-facts' }, led) : null,
      h('span', { class: 'list-under' }, [under]),
    ])
  }
}
