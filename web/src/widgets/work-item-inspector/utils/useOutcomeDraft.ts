import { reactive } from 'vue'

import { useDraftSource } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'

import { chosenTasks } from '@/shared/lib/mentionSuggest.ts'

/**
 * The outcome a closing move asks for, while it is written: its two fields, and the tasks
 * chosen from their `@` lists. Saved, it is the item's summary, so the tasks it tells are
 * read from both fields as one text. Words in either are a draft the card asks about
 * before leaving; cleared, the outcome forgets what was chosen in it too.
 */
export function useOutcomeDraft() {
  const text = reactive({ done: '', next: '' })
  const tasks = chosenTasks()
  const written = () => Boolean(text.done || text.next)
  useDraftSource('outcome', written)
  return {
    text,
    chose: tasks.chose,
    written,
    clear() {
      Object.assign(text, { done: '', next: '' })
      tasks.forget()
    },
    /** The report write's own fields: the outcome, and the tasks it tells. */
    report: () => ({ report: { ...text }, ...tasks.told(`${text.done}\n\n${text.next}`) }),
  }
}
