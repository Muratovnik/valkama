import { computed, watch } from 'vue'

import { until } from '@vueuse/core'

import { useInputRequests } from '@/features/input-requests/composables/useInputRequests.ts'
import { isCommentList } from '@/features/input-requests/utils/requestIdentity.ts'

import type { PlanningTarget } from '@/shared/api/planningTarget.ts'

/**
 * The questions on one card, for its discussion to stand among the comments.
 *
 * This is the one place that knows where they are read from. What leaves it is a list
 * of entries, so the discussion does not change with the store: today they come from
 * the questions' own read, on its half-minute and on the window coming back, and again
 * whenever the card's stream says something moved. A list under a comment comes with them,
 * and stands in its comment; nobody waits on it, so it never makes the card wait.
 */
export function useItemQuestions(target: () => PlanningTarget | undefined, stream: () => unknown) {
  const { entries, failed, loading, partial, refresh, result, changed } = useInputRequests(
    () => target() ?? null,
  )
  const waiting = computed(() =>
    entries.value.some((entry) => entry.request.status === 'pending' && !isCommentList(entry)),
  )
  /** Not knowing is not the same as there being none, so the discussion says it. */
  const unread = computed(() => failed.value || partial.value)
  /** More of them than one read brings: the newest are here and those waiting, not the rest. */
  const cut = computed(() => result.value?.has_more ?? false)
  watch(stream, () => void refresh())
  /**
   * Whether a question waits, as the read that answers next says. One already on its way
   * is that read; a window out of sight reads once it is back, as it does anyway.
   */
  async function readNow() {
    await refresh()
    await until(
      () => !loading.value && (target() === undefined || result.value !== null || failed.value),
    ).toBe(true)
    return waiting.value
  }
  return { changed, cut, entries, readNow, refresh, unread, waiting }
}
