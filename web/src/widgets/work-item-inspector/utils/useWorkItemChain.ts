import { onBeforeUnmount, ref, shallowRef } from 'vue'

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
 */
export function useWorkItemChain() {
  const chain = shallowRef<WorkItemChain | null>(null)
  const scope = ref<ChainScope>('chain')
  const loading = ref(false)
  const failed = ref(false)
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

  onBeforeUnmount(cancel)
  return { chain, failed, load, loading, scope, setScope }
}
