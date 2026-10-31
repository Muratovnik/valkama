import { onScopeDispose, shallowRef, watch } from 'vue'

import { fetchWorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'

/**
 * The chain the workspace's graph is scoped to, if any.
 *
 * It starts from the answer the card already read, so switching to the graph
 * costs no request, and it is re-read whenever the space's read model moves —
 * the same signal every view of the space refreshes on — so a member closed
 * while the graph is open is drawn closed. A failed re-read keeps the last
 * chain: the field stays the chain the owner asked for rather than falling back
 * to the whole space without being asked.
 *
 * Held here, not in the route: the module's route state admits only the keys
 * the server's manifest declares, and a chain is not one of them yet.
 */
export function usePlanningChainScope(version: () => number) {
  const chain = shallowRef<WorkItemChain | null>(null)
  let generation = 0
  let controller: AbortController | undefined

  function settle(next: WorkItemChain | null) {
    generation += 1
    controller?.abort()
    controller = undefined
    chain.value = next
  }

  async function refresh() {
    const current = chain.value
    if (current === null) return
    settle(current)
    const request = generation
    controller = new AbortController()
    try {
      const next = await fetchWorkItemChain(
        current.root.work_item_id,
        current.scope,
        controller.signal,
      )
      if (request === generation) chain.value = next
    } catch {
      // The last chain stays drawn; the next movement of the space retries.
    }
  }

  watch(version, () => void refresh())
  onScopeDispose(() => settle(null))

  return {
    chain,
    enter: (next: WorkItemChain) => settle(next),
    exit: () => settle(null),
  }
}
