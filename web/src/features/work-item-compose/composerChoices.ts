/**
 * What the new-task dialog offers for its parent and its labels, from the space the board
 * already holds: no read of its own, so the lists say what the board says.
 */
import { FACET_ORDER } from '@/entities/work-item/utils/facets.ts'
import type { FacetId } from '@/entities/work-item/utils/facets.ts'
import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { byUse } from '@/shared/lib/byUse.ts'
import type { StandingItem } from '@/shared/lib/standing.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'

/** The facets a new item is given in the dialog; the state is the workflow's to choose. */
const ASKED: ReadonlySet<FacetId> = new Set(['kind', 'priority', 'labels', 'parent'])

/**
 * The dialog's fields after the title, two to a row, in the order every surface reads an
 * item's facets (`FACET_ORDER`): the kind and the priority, then the labels and the parent.
 * The description follows them, last, as it follows the facts on the card. The dialog
 * asked for the description between the two rows, so the form read in another order than
 * the card it makes.
 */
export const COMPOSER_ROWS: readonly (readonly FacetId[])[] = (() => {
  const asked = FACET_ORDER.filter((facet) => ASKED.has(facet))
  return [asked.slice(0, 2), asked.slice(2)]
})()

/**
 * The items a new one may stand under: a goal, that
 * is not inside one itself, since the hierarchy is one level deep. "No parent" leads, then
 * open work before closed and the newest first. An option is found by its number and its
 * title, and says its state as `stateName` names it.
 */
export function parentChoices(
  items: readonly WorkItemBrief[],
  noParent: string,
  stateName: (item: StandingItem) => string,
): ChoiceOption[] {
  const parents = items
    .filter((item) => WORK_ITEM_TREE.isContainer(item) && item.parent_id === null)
    .sort((left, right) => Number(!left.open) - Number(!right.open) || right.number - left.number)
  return [
    { value: '', label: noParent },
    ...parents.map((item) => ({
      value: item.reference,
      label: `${item.reference} · ${item.title}`,
      description: stateName(item),
    })),
  ]
}

/** The labels the space's work carries, the most used first, as the filter menu has them. */
export function labelChoices(items: readonly WorkItemBrief[]): ChoiceOption[] {
  return byUse(items.flatMap((item) => item.labels)).map((label) => ({ value: label, label }))
}
