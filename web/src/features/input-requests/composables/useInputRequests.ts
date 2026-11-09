import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { requestIdentity, targetIdentity } from '@/features/input-requests/utils/requestIdentity.ts'

import { fetchInputRequest, fetchInputRequests } from '@/shared/api/inputRequestApi.ts'
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

/**
 * What to read: one card's questions, those waiting everywhere, or nothing at all.
 *
 * `keep` names a question the host holds something in — words, a choice, the keyboard.
 * A read that no longer brings such a question, because it was answered or closed
 * somewhere else, does not take it off the screen: it stays where it was, is read on its
 * own to say how it ended, and leaves only through `dismiss`. A read of what waits
 * everywhere drops every question that stopped waiting, and it used to drop the one being
 * written in with the draft and the focus inside it.
 *
 * `settles` lets a host put the questions that stopped waiting here aside (`settled`), at
 * the first read after which the host says one can leave its place: until then it stands
 * where it was answered. The read a write here starts is never that read, whatever stands
 * where: it comes a moment after the press, while focus is still on its way to the next
 * question. A host that gives none keeps them where they stand.
 */
export function useInputRequests(
  source: () => PlanningTarget | 'all' | null,
  keep: (entry: InputRequestEntry) => boolean = () => false,
  settles: (entry: InputRequestEntry) => boolean = () => false,
) {
  const result = ref<InputRequestList | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  const resolved = ref<Record<string, InputRequestEntry>>({})
  const settled = ref<Record<string, true>>({})
  /** Written here, with no read finished since: not to be put aside by the read the write began. */
  const fresh = new Set<string>()
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
    // end of the list, out from under the reader who had just answered it. Once put aside it
    // goes after them.
    const open = (entry: InputRequestEntry) => {
      const key = requestIdentity(entry)
      return (
        (entry.request.status === 'pending' || key in resolved.value) && !(key in settled.value)
      )
    }
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
      value: entries.value.filter((entry) => waits(entry)).length,
      incomplete: partial.value || result.value.has_more,
    }
  })

  /**
   * Whether a question still waits, as the last read said. One held here after a read no
   * longer brought it does not, whatever the copy kept of it says while it is asked again.
   */
  function waits(entry: InputRequestEntry) {
    return entry.request.status === 'pending' && !(requestIdentity(entry) in resolved.value)
  }

  /** Puts aside what stopped waiting, where the host says nothing moves from under the reader. */
  function settle() {
    for (const entry of Object.values(resolved.value)) {
      const key = requestIdentity(entry)
      if (entry.request.status === 'pending' || key in settled.value || fresh.delete(key)) continue
      if (settles(entry)) settled.value[key] = true
    }
  }

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
      hold(items)
      result.value = {
        ...response,
        items: selected
          ? items.filter((entry) => targetIdentity(entry.target) === targetIdentity(selected))
          : items,
      }
      failed.value = false
      settle()
    } catch {
      if (generation === current) failed.value = true
    } finally {
      if (generation === current) loading.value = false
    }
  }

  /**
   * Keeps what the host holds of the questions this read no longer brings, as they last
   * stood, and asks each how it stands now. Should that fail, the last copy stays: a
   * question that cannot be read is no reason to take away what was written in it.
   */
  function hold(items: InputRequestEntry[]) {
    const read = new Set(items.map((entry) => requestIdentity(entry)))
    const gone = entries.value.filter(
      (entry) =>
        entry.request.status === 'pending' &&
        !(requestIdentity(entry) in resolved.value) &&
        !read.has(requestIdentity(entry)) &&
        keep(entry),
    )
    for (const entry of gone) {
      const key = requestIdentity(entry)
      resolved.value[key] = entry
      fetchInputRequest(entry.target, entry.request.request_id)
        .then((now) => {
          const held = resolved.value[key]
          if (held && requestIdentity(now) === key && now.request.revision >= held.request.revision)
            resolved.value[key] = now
        })
        .catch(() => {})
    }
  }

  /** The person is done with a question that no longer waits: it leaves the list. */
  function dismiss(entry: InputRequestEntry) {
    delete resolved.value[requestIdentity(entry)]
    delete settled.value[requestIdentity(entry)]
    fresh.delete(requestIdentity(entry))
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
    fresh.add(requestIdentity(entry))
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
      settled.value = {}
      fresh.clear()
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
  return {
    result,
    loading,
    failed,
    partial,
    entries,
    count,
    settled,
    waits,
    refresh,
    changed,
    dismiss,
  }
}
