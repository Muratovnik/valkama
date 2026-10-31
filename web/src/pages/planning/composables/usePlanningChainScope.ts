import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { fetchWorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { ChainScope, WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'

type RouteState = Record<string, string | number | boolean>

/** The route keys that name a chain: its root's reference, and how far it reaches. */
const CHAIN_KEYS = new Set(['chain', 'chain_scope'])

/** What the route asks the graph to be scoped to. */
export type ChainTarget =
  | { status: 'none' }
  | { reference: string; scope: ChainScope; status: 'chain' }
  | { reference: string; status: 'invalid' }

/**
 * Why a chain the route named is not drawn: the link could never name one, its
 * root is in another space, or the read failed with the server's own words.
 */
export type ChainRefusal =
  { kind: 'elsewhere' } | { kind: 'failed'; message: string } | { kind: 'invalid' }

/**
 * Read the chain out of the module's route state.
 *
 * A chain scopes the graph only, so another view names none whatever the keys
 * say. A missing `chain_scope` is the endpoint's own default. A value the
 * endpoint could never answer — not a reference, or a scope that is neither — is
 * reported as invalid rather than sent, so the operator hears which link was
 * wrong instead of watching a request fail.
 */
export function chainTarget(state: RouteState | undefined): ChainTarget {
  if (state?.view !== 'graph') return { status: 'none' }
  const reference = state.chain
  const scope = state.chain_scope ?? 'chain'
  if (reference === undefined && state.chain_scope === undefined) return { status: 'none' }
  if (typeof reference !== 'string' || !WORK_ITEM_REFERENCE.test(reference))
    return { status: 'invalid', reference: String(reference ?? '') }
  if (scope !== 'chain' && scope !== 'epic') return { status: 'invalid', reference }
  return { status: 'chain', reference, scope }
}

/** The same state naming this chain, or naming none when `chain` is null. */
export function withChain(
  state: RouteState | undefined,
  chain: { reference: string; scope: ChainScope } | null,
): RouteState {
  const rest = Object.fromEntries(
    Object.entries(state ?? {}).filter(([key]) => !CHAIN_KEYS.has(key)),
  )
  return chain === null ? rest : { ...rest, chain: chain.reference, chain_scope: chain.scope }
}

interface ChainScopeOptions {
  /** The route named a chain this space cannot show. */
  refused: (reference: string, why: ChainRefusal) => void
  /** Which space the chain is read for, empty until one is bound; a change reads it again. */
  space: () => string
  /** The ids of the space's items, or null while the space is unread. */
  spaceItems: () => readonly { work_item_id: string }[] | null
  /** The chain the route names. */
  target: () => ChainTarget
  /** Moves whenever the space's read model does. */
  version: () => number
}

/**
 * The chain the workspace's graph is scoped to, if any.
 *
 * Which chain is the route's to say, in the `chain` and `chain_scope` keys the
 * module's manifest admits, so a reload, a bookmark or Back comes back to the
 * same field; this holds only the answer for it. Entering from the card seeds
 * that answer with the one the card already read, so switching to the graph
 * costs no request, while a link opened cold reads it.
 *
 * It is re-read whenever the space's read model moves — the same signal every
 * view of the space refreshes on — so a member closed while the graph is open is
 * drawn closed. A failed re-read keeps the last chain: the field stays the chain
 * the owner asked for rather than falling back to the whole space without being
 * asked. A failed first read is different, because there is nothing to keep:
 * the route is told, and it shows the whole space.
 */
export function usePlanningChainScope(options: ChainScopeOptions) {
  const chain = shallowRef<WorkItemChain | null>(null)
  const pending = shallowRef(false)
  /** The target the held chain answers, so a matching route needs no read. */
  let held = ''
  let generation = 0
  let controller: AbortController | undefined

  function keyOf(target: ChainTarget): string {
    return target.status === 'chain'
      ? JSON.stringify([options.space(), target.reference, target.scope])
      : ''
  }

  function settle(next: WorkItemChain | null, key = '') {
    generation += 1
    controller?.abort()
    controller = undefined
    pending.value = false
    chain.value = next
    held = next === null ? '' : key
  }

  async function read(
    target: Extract<ChainTarget, { status: 'chain' }>,
    key: string,
    first: boolean,
  ) {
    settle(chain.value, held)
    const request = generation
    controller = new AbortController()
    pending.value = first
    try {
      const next = await fetchWorkItemChain(target.reference, target.scope, controller.signal)
      if (request === generation) settle(next, key)
    } catch (error) {
      if (request !== generation) return
      pending.value = false
      // A re-read that failed keeps the chain drawn; the next movement retries.
      if (!first) return
      const message = error instanceof Error ? error.message : String(error)
      options.refused(target.reference, { kind: 'failed', message })
    }
  }

  function follow() {
    const target = options.target()
    if (target.status === 'none') {
      if (held || pending.value) settle(null)
      return
    }
    if (target.status === 'invalid') {
      settle(null)
      options.refused(target.reference, { kind: 'invalid' })
      return
    }
    const key = keyOf(target)
    if (key === held) return
    settle(null)
    // A reference is only meaningful once the route's space is bound, and
    // reading before that answers once for no space and again for the real one.
    if (options.space() === '') pending.value = true
    else void read(target, key, true)
  }

  watch(() => JSON.stringify([options.space(), options.target()]), follow, { immediate: true })
  watch(options.version, () => {
    const target = options.target()
    if (target.status === 'chain' && held !== '' && held === keyOf(target))
      void read(target, held, false)
  })

  // A reference names an item in whichever space owns its key, so a link can
  // name a chain from another space, and a root can be deleted while its graph
  // is open. Either way the root is not among this space's items, and the
  // graph, which draws only those, would be empty; the notice says just that.
  watch([chain, options.spaceItems], ([current, items]) => {
    if (current === null || items === null) return
    if (items.some((item) => item.work_item_id === current.root.work_item_id)) return
    settle(null)
    options.refused(current.root.reference, { kind: 'elsewhere' })
  })
  onScopeDispose(() => settle(null))

  return {
    /**
     * The held chain, while the route still names it. Entering holds the card's
     * answer a moment before the route moves; a move the router refused leaves
     * the route on the whole space, and so does this.
     */
    scoped: computed(() => (options.target().status === 'chain' ? chain.value : null)),
    /** True while a chain the route names is read for the first time. */
    pending,
    /** Hold the card's answer for the target the route is about to name. */
    enter: (next: WorkItemChain) =>
      settle(next, keyOf({ status: 'chain', reference: next.root.reference, scope: next.scope })),
  }
}
