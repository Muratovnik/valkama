import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { requestIdentity, targetIdentity } from '@/features/input-requests/utils/requestIdentity.ts'

import { fetchInputRequests } from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry, InputRequestList } from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'

export function useInputRequests(target: () => PlanningTarget | undefined) {
  const result = ref<InputRequestList | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  const resolved = ref<Record<string, InputRequestEntry>>({})
  let controller: AbortController | undefined
  let generation = 0
  let timer: ReturnType<typeof setInterval> | undefined
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
  const count = computed(() =>
    !result.value || failed.value || partial.value || result.value.has_more
      ? null
      : entries.value.filter((entry) => entry.request.status === 'pending').length,
  )

  async function refresh() {
    if (loading.value || document.visibilityState === 'hidden') return
    const current = ++generation
    controller = new AbortController()
    loading.value = true
    const selected = target()
    try {
      const response = await fetchInputRequests({
        target: selected,
        status: selected ? 'all' : 'pending',
        signal: controller.signal,
      })
      if (generation !== current) return
      result.value = {
        ...response,
        items: selected
          ? response.items.filter(
              (entry) => targetIdentity(entry.target) === targetIdentity(selected),
            )
          : response.items,
      }
      failed.value = false
    } catch {
      if (generation === current) failed.value = true
    } finally {
      if (generation === current) loading.value = false
    }
  }

  function changed(entry: InputRequestEntry) {
    resolved.value[requestIdentity(entry)] = entry
    // A response started before the write must not replace the confirmed outcome.
    generation++
    controller?.abort()
    loading.value = false
    void refresh()
  }

  watch(
    () => {
      const selected = target()
      return selected ? `${targetIdentity(selected)}:${selected.writable}` : ''
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
