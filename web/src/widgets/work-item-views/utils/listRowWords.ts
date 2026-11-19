/**
 * What a list row prints in each of its places, and the words that come to.
 *
 * The list's template (`WorkItemList.vue`) draws each run of a row from the
 * facets here, and the list's find (`useListFind.ts`) reads the row through
 * `rowWords`: each run is read with the words its drawing shows (`runWords`,
 * `cellWords`), so a row read and a row drawn say the same. The order of the
 * runs is the one thing kept by hand, here and in the template alike.
 */
import { isFolded, labelsUnder } from '@/widgets/work-item-views/utils/listColumns.ts'
import type { Fit, SortKey } from '@/widgets/work-item-views/utils/listColumns.ts'

import { cellWords, runWords } from '@/entities/work-item/components/drawMarks.ts'
import type { MarkWords } from '@/entities/work-item/composables/useMarkWords.ts'
import { holderRef, leadMarks, surfaceMarks } from '@/entities/work-item/utils/facets.ts'
import type { FacetContext, FacetId } from '@/entities/work-item/utils/facets.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

/** The facets of a row's runs, each in the place the row gives it. */
export const ROW_FACETS = {
  HOLDER: ['holder'],
  PRIORITY: ['priority'],
  STATE: ['state'],
  STEPS: ['steps'],
  /** An open blocker and the labels, under the title of a wide list. */
  UNDER: ['readiness', 'labels'],
} as const satisfies Record<string, readonly FacetId[]>

/** The state, where its column folded, and an open blocker, on the line of facts. */
export function factsOf(fit: Fit): readonly FacetId[] {
  return isFolded(fit, 'state') ? ['state', 'readiness'] : ['readiness']
}

/** How a row reads at the list's width and in its language. */
export interface RowReading {
  /** What the row's marks need beyond the item. */
  context: FacetContext
  fit: Fit
  /** When the row last moved, as the list says it. */
  updated: string
  words: MarkWords
  /**
   * What «Goal and stage» prints: in its column the path or a dash, folded the path
   * alone, first on the line of facts; absent where the list does not draw it, as
   * the tree by goal does not.
   */
  goal?: { cell: string; path: string }
  /**
   * What «Project» prints: in its column the project, «Several projects» or a dash,
   * folded the project alone, after the goal; absent where the list does not draw it.
   */
  project?: { cell: string; named: string }
  /**
   * What a tree prints after the title (`WorkItemListTreeWords.vue`): how much
   * under the row matched and the parent the indent no longer shows; none in a
   * flat list.
   */
  tree?: readonly string[]
}

const marksOf = (item: WorkItemBrief, facets: readonly FacetId[], asked: FacetContext = {}) =>
  surfaceMarks('list', item, asked, facets)

/**
 * The lines under the title (`listUnderTitle.ts`): a folded goal and stage and project
 * first; then on a wide list an open blocker and the labels, else the folded columns.
 */
function underTitle(item: WorkItemBrief, reading: RowReading): string[] {
  const { context, fit, goal, project, updated, words } = reading
  const said = goal?.path && isFolded(fit, 'goal') ? [goal.path] : []
  if (project?.named && isFolded(fit, 'project')) said.push(project.named)
  if (labelsUnder(fit))
    return [...said, ...runWords(marksOf(item, ROW_FACETS.UNDER, context), words)]
  said.push(...runWords(marksOf(item, factsOf(fit), context), words))
  // A dash says "nobody" under a heading; on a line of facts it says nothing.
  if (holderRef(item)) said.push(...runWords(marksOf(item, ROW_FACETS.HOLDER), words))
  if (isFolded(fit, 'checklist') && item.checklist.length)
    said.push(...runWords(marksOf(item, ROW_FACETS.STEPS), words))
  if (isFolded(fit, 'updated')) said.push(updated)
  return said
}

/**
 * The words a row prints, run by run and in the template's order: what the row
 * prints at this width and in this language, and nothing it keeps out of sight.
 */
export function rowWords(item: WorkItemBrief, reading: RowReading): string[] {
  const { fit, goal, project, tree = [], updated, words } = reading
  const shown = (key: SortKey) => !isFolded(fit, key)
  const cell = (facets: readonly FacetId[]) => cellWords(marksOf(item, facets), words)
  return [
    ...runWords(leadMarks('kind', 'list', item), words),
    item.reference,
    ...(shown('priority') ? [] : runWords(leadMarks('priority', 'list', item), words)),
    item.title,
    ...tree,
    ...underTitle(item, reading),
    ...(goal?.cell && shown('goal') ? [goal.cell] : []),
    ...(project && shown('project') ? [project.cell] : []),
    ...(shown('state') ? runWords(marksOf(item, ROW_FACETS.STATE), words) : []),
    ...(shown('priority') ? cell(ROW_FACETS.PRIORITY) : []),
    ...(shown('claim') ? cell(ROW_FACETS.HOLDER) : []),
    ...(shown('checklist') ? cell(ROW_FACETS.STEPS) : []),
    ...(shown('updated') ? [updated] : []),
  ]
}
