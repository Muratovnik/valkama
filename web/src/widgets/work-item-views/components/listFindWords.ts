/**
 * A list row's words for the list's find, as the list's template draws them: a group's
 * title and what matched under it; a card's cells, the lines under its title, what a goal's
 * row spent and, in a tree, the parent the tree does not show (`listRowWords.ts` says them in
 * order).
 */
import type { Ref } from 'vue'

import type { useListGoalSpend } from '@/widgets/work-item-views/composables/useListGoalSpend.ts'
import type { useListRuns } from '@/widgets/work-item-views/composables/useListRuns.ts'
import type { useListTreeRows } from '@/widgets/work-item-views/composables/useListTreeRows.ts'
import type { useListWords } from '@/widgets/work-item-views/composables/useListWords.ts'
import type { Fit } from '@/widgets/work-item-views/utils/listColumns.ts'
import { rowWords } from '@/widgets/work-item-views/utils/listRowWords.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

type ListWords = ReturnType<typeof useListWords>

interface FindList {
  /** Whether the list draws «Goal and stage». */
  drawsGoal: boolean
  /** Whether the list draws «Project». */
  drawsProject: boolean
  fit: Readonly<Ref<Fit>>
  runs: Pick<ReturnType<typeof useListRuns>, 'context' | 'words'>
  /** What a goal's row spent, under its title. */
  spend: Pick<ReturnType<typeof useListGoalSpend>, 'wordsOf'>
  tree: Pick<ReturnType<typeof useListTreeRows>, 'isGroup' | 'matchingOf' | 'underOf'>
  words: Pick<ListWords, 'goalCellOf' | 'goalOf' | 'projectCellOf' | 'projectOf' | 'updatedOf'>
}

/** Says a row's words for the find of a list drawn as these say. */
export function listFindWords({
  drawsGoal,
  drawsProject,
  fit,
  runs,
  spend,
  tree,
  words,
}: FindList) {
  return (item: WorkItemBrief): string[] =>
    tree.isGroup(item)
      ? [item.title, tree.matchingOf(item)].filter(Boolean)
      : rowWords(item, {
          context: runs.context(item),
          fit: fit.value,
          goal: drawsGoal ? { cell: words.goalCellOf(item), path: words.goalOf(item) } : undefined,
          project: drawsProject
            ? { cell: words.projectCellOf(item), named: words.projectOf(item) }
            : undefined,
          spend: spend.wordsOf(item),
          tree: [tree.matchingOf(item), tree.underOf(item)].filter(Boolean),
          updated: words.updatedOf(item),
          words: runs.words,
        })
}
