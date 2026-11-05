/**
 * What the new-task dialog offers for its epic and its labels, from the space the board
 * already holds: no read of its own, so the lists say what the board says.
 */
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { byUse } from '@/shared/lib/byUse.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'

/**
 * The items a new one may stand under: an epic, or an item already holding others, that
 * is not inside one itself, since the hierarchy is one level deep. "No epic" leads, then
 * open work before closed and the newest first. An option is found by its number and its
 * title, and says its state.
 */
export function epicChoices(items: readonly WorkItemBrief[], noEpic: string): ChoiceOption[] {
  const epics = items
    .filter((item) => (item.kind === 'epic' || item.container) && item.parent_id === null)
    .sort(
      (left, right) =>
        Number(left.state.is_terminal) - Number(right.state.is_terminal) ||
        right.number - left.number,
    )
  return [
    { value: '', label: noEpic },
    ...epics.map((item) => ({
      value: item.reference,
      label: `${item.reference} · ${item.title}`,
      description: item.state.name,
    })),
  ]
}

/** The labels the space's work carries, the most used first, as the filter menu has them. */
export function labelChoices(items: readonly WorkItemBrief[]): ChoiceOption[] {
  return byUse(items.flatMap((item) => item.labels)).map((label) => ({ value: label, label }))
}
