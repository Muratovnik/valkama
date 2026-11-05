import { computed, onBeforeUnmount, ref, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { fetchWorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { ChainScope, WorkItemChain } from '@/shared/api/planningChainApi.ts'

/**
 * The chain an open item heads, read once per open and again on every refresh
 * the inspector itself takes, so the card's composition is never older than the
 * card.
 *
 * A refresh keeps the last answer on screen while it runs: the section is a
 * summary a reader is in the middle of, and blanking it on every live update of
 * the space would make it flicker.
 *
 * The chain is keyed by the item's own id, which only the loaded record carries,
 * so `root` is empty until the card has its item, and stays empty for an item
 * of an attached store, whose chain the endpoint cannot read. It is read once
 * per root and once per `refresh` change, never twice for one answer.
 */
export function useWorkItemChain(
  root: MaybeRefOrGetter<string>,
  refresh: MaybeRefOrGetter<number>,
) {
  const chain = shallowRef<WorkItemChain | null>(null)
  const scope = ref<ChainScope>('chain')
  const loading = ref(false)
  const failed = ref(false)
  /** Nothing more is coming: the section stands as tall as it will. */
  const answered = computed(
    () => !loading.value && (toValue(root) === '' || chain.value !== null || failed.value),
  )
  let identity = ''
  let generation = 0
  let controller: AbortController | undefined

  function cancel() {
    generation += 1
    controller?.abort()
    controller = undefined
  }

  async function load(id = identity) {
    if (id !== identity) {
      identity = id
      chain.value = null
    }
    cancel()
    if (!id) {
      loading.value = false
      return
    }
    const current = generation
    controller = new AbortController()
    loading.value = true
    try {
      const next = await fetchWorkItemChain(id, scope.value, controller.signal)
      if (current !== generation) return
      chain.value = next
      failed.value = false
    } catch {
      if (current === generation) failed.value = true
    } finally {
      if (current === generation) loading.value = false
    }
  }

  /** Another reading of the same root, which is a different question to the server. */
  function setScope(next: ChainScope) {
    if (next === scope.value) return
    scope.value = next
    void load()
  }

  watch(
    () => `${toValue(root)}:${toValue(refresh)}`,
    () => void load(toValue(root)),
    { immediate: true },
  )

  onBeforeUnmount(cancel)
  return { answered, chain, failed, load, loading, scope, setScope }
}
