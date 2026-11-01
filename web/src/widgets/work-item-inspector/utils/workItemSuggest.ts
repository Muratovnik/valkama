import type { WorkItem } from '@/shared/api/planningModel.ts'
import { searchPlanningWorkItems } from '@/shared/api/planningSearchApi.ts'
import type { EditorSuggestion } from '@/shared/ui/MarkdownEditor.vue'

/**
 * What `#` offers in a card's editors: the tasks of the card's own space, found
 * by the same search the related-work picker uses, so a reference typed here
 * means the same item a link added there would. The card itself is left out:
 * a text that links to the item it is written on says nothing.
 */
export function workItemSuggest(item: () => WorkItem) {
  return async (query: string, signal: AbortSignal): Promise<EditorSuggestion[]> => {
    const current = item()
    const found = await searchPlanningWorkItems(query, current.planning_space_id, signal)
    return found
      .filter((entry) => entry.work_item_id !== current.work_item_id)
      .map((entry) => ({
        key: entry.work_item_id,
        reference: entry.reference,
        title: entry.title,
        detail: entry.state.name,
      }))
  }
}
