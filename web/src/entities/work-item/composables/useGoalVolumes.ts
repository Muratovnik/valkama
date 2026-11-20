/**
 * The volume rows of the goals and stages a place shows, read together: one read of
 * `goal-volumes` for every id the place shows that it has no row for yet, never one per goal.
 * A list that draws more rows as it scrolls asks only for the new ones; news that the place's
 * work changed reads the rows shown again, keeping the old ones on screen until the answer
 * lands. A read that fails takes nothing away and asks again with the next change: a figure is
 * never what a place waits on.
 *
 * A row is kept under the id it was asked by, a reference or a work item id. The read answers
 * for the store this service writes, so a place showing an attached store's
 * work turns it off with `enabled`.
 */
import { onBeforeUnmount, shallowRef, watch } from 'vue'

import { readGoalVolumes } from '@/shared/api/goalVolumesReadApi.ts'
import type { GoalVolumesRow } from '@/shared/api/goalVolumesReadApi.ts'

export function useGoalVolumes(options: {
  /** Whether the read reaches the work shown. */
  enabled: () => boolean
  /** The goals and stages shown, by reference or work item id. */
  ids: () => readonly string[]
  /** What says the work shown changed, so its rows are read again. */
  news: () => unknown
}) {
  const rows = shallowRef<ReadonlyMap<string, GoalVolumesRow>>(new Map())
  /** Ids whose rows are on screen from before the last news, to read again. */
  let stale = new Set<string>()
  let controller: AbortController | undefined

  const shown = () =>
    options.enabled() ? [...new Set(options.ids())].sort((a, b) => a.localeCompare(b)) : []

  async function read() {
    const asked = shown().filter((id) => !rows.value.has(id) || stale.has(id))
    if (!asked.length) return
    controller?.abort()
    const own = new AbortController()
    controller = own
    try {
      const answer = await readGoalVolumes(asked, own.signal)
      if (own.signal.aborted) return
      const next = new Map(rows.value)
      // The answer is in the order asked, so each row is kept under the id it was asked by.
      for (const [index, id] of asked.entries()) {
        const row = answer[index]
        if (row) next.set(id, row)
      }
      for (const id of asked) stale.delete(id)
      rows.value = next
    } catch {
      // The rows shown stay as they were; the next change asks again.
    }
  }

  watch(() => shown().join(' '), read, { immediate: true })
  watch(options.news, () => {
    stale = new Set(rows.value.keys())
    void read()
  })
  onBeforeUnmount(() => controller?.abort())

  return { rows }
}
