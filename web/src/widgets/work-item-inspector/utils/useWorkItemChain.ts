import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import { fetchWorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { ChainScope, WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

type ChainRoot = Pick<WorkItemBrief, 'kind' | 'planning_space_id' | 'work_item_id'>

/** What the card says of itself: whether it reads the primary store, and its refreshes. */
interface ChainCard {
  readonly refreshToken: number
  readonly writable: boolean
}

/**
 * The chain an open item heads, read once per open and again on every refresh
 * the inspector itself takes (`refreshToken`), so the card's composition is never
 * older than the card.
 *
 * A refresh keeps the last answer on screen while it runs: the section is a
 * summary a reader is in the middle of, and blanking it on every live update of
 * the space would make it flicker.
 *
 * The chain is keyed by the item's own id, which only the loaded record carries,
 * so the root is empty until the card has its item, and stays empty for an item
 * of an attached store, whose chain the endpoint cannot read: a card that is not
 * `writable`. It is read once per root and once per refresh, never twice for one
 * answer.
 *
 * A goal or a stage is read first as its contents, the work under it, and a task as its
 * chain, what grew from it: a task holds no work, so its contents are always empty. The
 * reader's choice, or the one Back or an address brings, holds over that.
 */
export function useWorkItemChain(record: Readonly<Ref<ChainRoot | null>>, card: ChainCard) {
  const item = () => (card.writable ? record.value : null)
  const root = () => item()?.work_item_id ?? ''
  const chain = shallowRef<WorkItemChain | null>(null)
  const chosen = ref<ChainScope | null>(null)
  const scope = computed<ChainScope>({
    get: () => {
      const read = item()
      return chosen.value ?? (read && WORK_ITEM_TREE.isContainer(read) ? 'tree' : 'chain')
    },
    set: (next) => {
      chosen.value = next
    },
  })
  /** The space the root stands in, which the reader's folds of its contents are kept by. */
  const space = computed(() => item()?.planning_space_id ?? '')
  const loading = ref(false)
  const failed = ref(false)
  /** Nothing more is coming: the section stands as tall as it will. */
  const answered = computed(
    () => !loading.value && (root() === '' || chain.value !== null || failed.value),
  )
  /**
   * The read found work grown from the root; null until the first answer for it. A refresh
   * keeps the last answer, so the card's Chain tab does not leave and come back on each one.
   */
  const grown = computed(() => {
    if (chain.value) return chain.value.total > 0
    return answered.value ? false : null
  })
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
    () => `${root()}:${card.refreshToken}`,
    () => void load(root()),
    { immediate: true },
  )

  onBeforeUnmount(cancel)
  return { answered, chain, failed, grown, load, loading, scope, setScope, space }
}
