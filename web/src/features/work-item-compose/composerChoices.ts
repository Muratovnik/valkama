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
import { treeRows } from '@/shared/lib/treeRows.ts'
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

/** The order of the parents that share one: open work before closed, the newest first. */
const parentOrder = (left: WorkItemBrief, right: WorkItemBrief) =>
  Number(!left.open) - Number(!right.open) || right.number - left.number

/**
 * The items a new one may stand under: every goal and stage of this space, at any depth, laid
 * out by the tree's model (`treeRows`) as the list draws them, each under the one it stands in.
 * «No goal» leads. An option is found by its number, its title and its path, the references
 * of the goals and stages above it, so typing a goal's number finds every stage inside it, and
 * says its state as `stateName` names it. Another space's goal is not offered: it holds work
 * only in its own space. Only goals were offered, at the top level, so a stage five levels
 * down could not be chosen.
 */
export function parentChoices(
  items: readonly WorkItemBrief[],
  noGoal: string,
  stateName: (item: StandingItem) => string,
): ChoiceOption[] {
  const containers = items.filter((item) => !item.other_space && WORK_ITEM_TREE.isContainer(item))
  const { rows } = treeRows(WORK_ITEM_TREE, {
    items: containers,
    matches: null,
    folded: () => false,
    order: parentOrder,
  })
  const pathOf = new Map<string, string[]>()
  return [
    { value: '', label: noGoal },
    ...rows.map(({ id, item, parentId }) => {
      const above = parentId === null ? [] : (pathOf.get(parentId) ?? [])
      pathOf.set(id, [...above, item.reference])
      return {
        value: item.reference,
        label: `${item.reference} · ${item.title}`,
        description: [above.join(' › '), stateName(item)].filter(Boolean).join(' · '),
      }
    }),
  ]
}

/** The labels the space's work carries, the most used first, as the filter menu has them. */
export function labelChoices(items: readonly WorkItemBrief[]): ChoiceOption[] {
  return byUse(items.flatMap((item) => item.labels)).map((label) => ({ value: label, label }))
}
