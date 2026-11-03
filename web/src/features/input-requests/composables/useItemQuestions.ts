import { computed, watch } from 'vue'

import { useInputRequests } from '@/features/input-requests/composables/useInputRequests.ts'

import type { PlanningTarget } from '@/shared/api/planningTarget.ts'

/**
 * The questions on one card, for its discussion to stand among the comments.
 *
 * This is the one place that knows where they are read from. What leaves it is a list
 * of entries, so the discussion does not change with the store: today they come from
 * the questions' own read, on its half-minute and on the window coming back, and again
 * whenever the card's stream says something moved.
 */
export function useItemQuestions(target: () => PlanningTarget | undefined, stream: () => unknown) {
  const { entries, failed, partial, refresh, result, changed } = useInputRequests(
    () => target() ?? null,
  )
  const waiting = computed(() => entries.value.some((entry) => entry.request.status === 'pending'))
  /** Not knowing is not the same as there being none, so the discussion says it. */
  const unread = computed(() => failed.value || partial.value)
  /** More of them than one read brings: the newest are here and those waiting, not the rest. */
  const cut = computed(() => result.value?.has_more ?? false)
  watch(stream, () => void refresh())
  return { changed, cut, entries, refresh, unread, waiting }
}
