/**
 * What a goal's or a stage's row of the list spent, under its title: both numbers of the
 * Volumes page's row for it, without the cancelled and with them, in that page's words
 * (`useGoalSpendWords`), so a goal reads the same in both places. A figure the read has no data
 * for is «—», its hint saying why.
 *
 * The rows are read in one `goal-volumes` read for the goals and stages the list draws, never
 * one per row; a list that draws more as it scrolls asks for the new ones only, and the list's
 * work changing reads the drawn ones again (`useGoalVolumes`). A row without its numbers yet, or
 * whose read failed, prints no line: the list never waits on a figure.
 *
 * The line is drawn from the list's own render as plain elements, as the lines over it are
 * (`listUnderTitle.ts`), with `data-part="spend"`, and each number's `data-spend` is `spent` or
 * `spent-all`. Its words reach the list's find after those lines, as they are drawn.
 */
import { h, withDirectives } from 'vue'
import type { Ref, VNode } from 'vue'
import { useI18n } from 'vue-i18n'

import { useGoalSpendWords } from '@/entities/work-item/composables/useGoalSpendWords.ts'
import type { Figure } from '@/entities/work-item/composables/useGoalSpendWords.ts'
import { useGoalVolumes } from '@/entities/work-item/composables/useGoalVolumes.ts'
import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import type { ListEntry } from '@/shared/ui/useWindowRows.ts'

/** A number as its line says it: its label, then its figure. */
const said = (part: { figure: Figure; label: string }) => `${part.label} ${part.figure.text}`

export function useListGoalSpend(
  list: {
    /** What says the list's work changed. */
    readonly items: readonly WorkItemBrief[]
    /** Whether the list's work is in the store the read answers for. */
    readonly goalVolumes?: boolean
  },
  /** The entries the list draws. */
  entries: Readonly<Ref<readonly ListEntry<WorkItemBrief>[]>>,
  /** Tells a group's row from a card's. */
  tree: { isGroup: (item: WorkItemBrief) => boolean },
) {
  const { t } = useI18n()
  const words = useGoalSpendWords()

  const isGoal = (item: WorkItemBrief) => !tree.isGroup(item) && WORK_ITEM_TREE.isContainer(item)
  const { rows } = useGoalVolumes({
    enabled: () => list.goalVolumes ?? false,
    ids: () =>
      entries.value.flatMap((entry) =>
        entry.kind === 'row' && isGoal(entry.row) ? [entry.row.work_item_id] : [],
      ),
    news: () => list.items,
  })

  /** Both numbers of a goal's row, each with its label; none where the row has no read yet. */
  function figuresOf(item: WorkItemBrief): { figure: Figure; key: string; label: string }[] {
    const row = isGoal(item) ? rows.value.get(item.work_item_id) : undefined
    if (!row) return []
    return [
      { key: 'spent', label: t('volumes.goals.spent'), figure: words.spent(row.spent) },
      {
        key: 'spent-all',
        label: t('volumes.goals.spentAll'),
        figure: words.spent(row.spent_with_cancelled),
      },
    ]
  }

  /** The row's line of what it spent, or nothing. */
  function line(item: WorkItemBrief): VNode | null {
    const parts = figuresOf(item)
    if (!parts.length) return null
    return h(
      'span',
      { 'class': 'list-facts', 'data-part': 'spend' },
      parts.map((part) =>
        withDirectives(
          h(
            'span',
            {
              'class': 'list-fact',
              'data-spend': part.key,
              'aria-description': part.figure.hint || undefined,
            },
            said(part),
          ),
          [[vTooltip, part.figure.hint, undefined, { detail: true }]],
        ),
      ),
    )
  }

  /** The line's words, for the list's find. */
  const wordsOf = (item: WorkItemBrief): string[] => figuresOf(item).map((part) => said(part))

  /** What a row's line depends on, for its memo. */
  const memoOf = (item: WorkItemBrief) => (isGoal(item) ? rows.value.get(item.work_item_id) : null)

  return { line, memoOf, wordsOf }
}
