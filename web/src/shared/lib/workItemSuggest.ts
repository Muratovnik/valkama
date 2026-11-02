import { activePlanningWorkItems, searchPlanningWorkItems } from '@/shared/api/planningSearchApi.ts'
import type { EditorSuggestion } from '@/shared/ui/MarkdownEditor.vue'

/**
 * What `#` offers in an editor that writes about work: the tasks of one
 * planning space, found by the same search the related-work picker uses, so a
 * reference typed here means the same item a link added there would.
 *
 * `space` is the space's `planning_space_id`. `omit` leaves one item out — the
 * card being written on, since a text that links to its own item says nothing;
 * a task that does not exist yet has nothing to leave out. With nothing typed
 * yet it offers what is being worked on, so a `#` alone already has rows to take.
 */
export function workItemSuggest(space: () => string, omit: () => string | undefined = () => '') {
  return async (query: string, signal: AbortSignal): Promise<EditorSuggestion[]> => {
    const found = query
      ? await searchPlanningWorkItems(query, space(), signal)
      : await activePlanningWorkItems(space(), signal)
    const own = omit()
    return found
      .filter((entry) => !own || entry.work_item_id !== own)
      .map((entry) => ({
        key: entry.work_item_id,
        reference: entry.reference,
        title: entry.title,
        detail: entry.state.name,
      }))
  }
}
