import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { requestIdentity, targetIdentity } from '@/features/input-requests/utils/requestIdentity.ts'

import { fetchInputRequests } from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry, InputRequestList } from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'

/**
 * The questions still waiting, and whether they are all of them: a source that
 * could not be read, or a list cut at its first page, makes `value` a floor.
 * `unknown` is a read that failed outright, which says nothing about the count.
 */
export type PendingCount = { incomplete: boolean; value: number } | 'unknown'

/**
 * Moves with every answer or decline confirmed in this window. The rail's count and a
 * card's discussion read separately and either can be the one written from, so each
 * reads again when the other wrote: a count left standing beside an answered question.
 */
const confirmedWrites = ref(0)

/** What to read: one card's questions, those waiting everywhere, or nothing at all. */
export function useInputRequests(source: () => PlanningTarget | 'all' | null) {
  const result = ref<InputRequestList | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  const resolved = ref<Record<string, InputRequestEntry>>({})
  let controller: AbortController | undefined
  let generation = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let seenWrites = confirmedWrites.value
  const partial = computed(
    () => result.value?.coverage.some((source) => source.status === 'unavailable') ?? false,
  )
  const entries = computed(() => {
    const combined = new Map<string, InputRequestEntry>()
    for (const entry of result.value?.items ?? []) combined.set(requestIdentity(entry), entry)
    for (const entry of Object.values(resolved.value)) {
      const key = requestIdentity(entry)
      if ((combined.get(key)?.request.revision ?? -1) <= entry.request.revision)
        combined.set(key, entry)
    }
    // Open questions first, newest first, as the server lists them. A question
    // answered here keeps its place among them: the read after the answer no
    // longer returns it, and it used to come back from the confirmed copy at the
    // end of the list, out from under the reader who had just answered it.
    const open = (entry: InputRequestEntry) =>
      entry.request.status === 'pending' || requestIdentity(entry) in resolved.value
    return [...combined.values()].sort(
      (a, b) =>
        Number(open(b)) - Number(open(a)) ||
        b.request.created_at.localeCompare(a.request.created_at) ||
        b.request.request_id.localeCompare(a.request.request_id),
    )
  })
  // A failed read says nothing about the count, so it is unknown — said as
  // such, since a count that vanished read as zero; an incomplete one still
  // knows how many it found. Null is only the wait for the first answer.
  const count = computed<PendingCount | null>(() => {
    if (failed.value) return 'unknown'
    if (!result.value) return null
    return {
      value: entries.value.filter((entry) => entry.request.status === 'pending').length,
      incomplete: partial.value || result.value.has_more,
    }
  })

  async function refresh() {
    if (loading.value || document.visibilityState === 'hidden') return
    const chosen = source()
    if (chosen === null) return
    const selected = chosen === 'all' ? undefined : chosen
    const current = ++generation
    controller = new AbortController()
    loading.value = true
    try {
      const response = await fetchInputRequests({
        target: selected,
        status: selected ? 'all' : 'pending',
        signal: controller.signal,
      })
      if (generation !== current) return
      // A read is cut at its limit, newest first, and a question still waiting belongs
      // under the form however old it is, so past the cut those are read on their own.
      const older =
        selected && response.has_more
          ? await fetchInputRequests({
              target: selected,
              status: 'pending',
              signal: controller.signal,
            })
          : null
      if (generation !== current) return
      const items = [...response.items, ...(older?.items ?? [])]
      result.value = {
        ...response,
        items: selected
          ? items.filter((entry) => targetIdentity(entry.target) === targetIdentity(selected))
          : items,
      }
      failed.value = false
    } catch {
      if (generation === current) failed.value = true
    } finally {
      if (generation === current) loading.value = false
    }
  }

  /** A response started before a write must not replace what the write confirmed. */
  function readAgain() {
    generation++
    controller?.abort()
    loading.value = false
    void refresh()
  }

  function changed(entry: InputRequestEntry) {
    resolved.value[requestIdentity(entry)] = entry
    seenWrites = ++confirmedWrites.value
    readAgain()
  }

  watch(confirmedWrites, (writes) => {
    if (writes === seenWrites) return
    seenWrites = writes
    readAgain()
  })
  watch(
    () => {
      const selected = source()
      return selected === null || selected === 'all'
        ? String(selected)
        : `${targetIdentity(selected)}:${selected.writable}`
    },
    () => {
      generation++
      controller?.abort()
      loading.value = false
      result.value = null
      resolved.value = {}
      void refresh()
    },
    { immediate: true },
  )
  onMounted(() => {
    timer = setInterval(() => {
      void refresh()
    }, 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
  })
  onUnmounted(() => {
    generation++
    controller?.abort()
    clearInterval(timer)
    window.removeEventListener('focus', refresh)
    document.removeEventListener('visibilitychange', refresh)
  })
  return { result, loading, failed, partial, entries, count, refresh, changed }
}
