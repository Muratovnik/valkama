import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import type { PlanningViewMode } from '@/pages/planning/PlanningWorkspace.vue'

import { fetchWorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { ChainScope, WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'

type RouteState = Record<string, string | number | boolean>

/**
 * The route keys that belong to a chain: its root's reference, how far it
 * reaches, whether its closed members are drawn, and the branch of it the card
 * chose. Leaving the chain or naming another drops all four, so a chain always
 * opens on its open part.
 */
const CHAIN_KEYS = new Set(['chain', 'chain_scope', 'closed', 'branch'])

/**
 * How the address spells the branch of work filed under no epic. A branch is
 * named by the epic its work was filed under, and that one has none, so it
 * takes a word no reference can be.
 */
const NO_EPIC_BRANCH = 'none'

/** What the route asks every view of the space to be scoped to. */
export type ChainTarget =
  | { status: 'none' }
  | { reference: string; scope: ChainScope; status: 'chain' }
  | { reference: string; status: 'invalid' }

/**
 * Why a chain the route named will not be drawn: the link could never name one,
 * its root is in another space, or the space is an attached store the chain
 * endpoint does not read. A read that failed is not among them — it may succeed
 * when asked again, so it is held as a failure the route keeps.
 */
export type ChainRefusal = { kind: 'elsewhere' } | { kind: 'invalid' } | { kind: 'primary' }

/** A first read of the chain the route names that failed, and how. */
export interface ChainFailure {
  failure: TypedFailure
  reference: string
}

/**
 * Read the chain out of the module's route state.
 *
 * A chain scopes whichever view is open — the board, the list or the graph — so
 * the view does not decide it. A missing `chain_scope` is the endpoint's own
 * default. A value the endpoint could never answer — not a reference, or a scope
 * that is neither — is reported as invalid rather than sent, so the operator
 * hears which link was wrong instead of watching a request fail.
 */
export function chainTarget(state: RouteState | undefined): ChainTarget {
  const reference = state?.chain
  const scope = state?.chain_scope ?? 'chain'
  if (reference === undefined && state?.chain_scope === undefined) return { status: 'none' }
  if (typeof reference !== 'string' || !WORK_ITEM_REFERENCE.test(reference))
    return { status: 'invalid', reference: String(reference ?? '') }
  if (scope !== 'chain' && scope !== 'epic') return { status: 'invalid', reference }
  return { status: 'chain', reference, scope }
}

/** The view as the route state carries it; anything else is the board. */
export function viewOf(state: RouteState | undefined): PlanningViewMode {
  const value = state?.view
  return value === 'graph' || value === 'list' ? value : 'kanban'
}

/** The board's grouping as the route state carries it; anything else is none. */
export function groupingOf(state: RouteState | undefined): 'epic' | 'none' {
  return state?.group === 'epic' ? 'epic' : 'none'
}

/**
 * What of the route state goes with the operator to another scope: how they are looking,
 * which is theirs. What they are looking at, a filter or a chain, belongs to the space it
 * was set in. Defaults leave their key out, as everywhere in the state.
 */
export function lookAcrossScopes(state: RouteState | undefined): RouteState {
  const view = viewOf(state)
  return {
    ...(view === 'kanban' ? {} : { view }),
    ...withGrouping(undefined, groupingOf(state)),
  }
}

/** The same state grouping the board so; the default leaves the key out. */
export function withGrouping(state: RouteState | undefined, grouping: 'epic' | 'none'): RouteState {
  const rest = Object.fromEntries(Object.entries(state ?? {}).filter(([key]) => key !== 'group'))
  return grouping === 'epic' ? { ...rest, group: grouping } : rest
}

/** Whether the chain's closed members are drawn; absent, as in an older address, is no. */
export function closedOf(state: RouteState | undefined): boolean {
  return state?.closed === true
}

/** The same state drawing the chain's closed members or not; the default leaves the key out. */
export function withClosed(state: RouteState | undefined, closed: boolean): RouteState {
  const rest = Object.fromEntries(Object.entries(state ?? {}).filter(([key]) => key !== 'closed'))
  return closed ? { ...rest, closed } : rest
}

/**
 * The branch of the chain the address names: an epic's reference, `''` for the
 * work filed under no epic, null for none. A value that could name no branch is
 * `undefined`, so the surface can say the link was wrong and drop it.
 */
export function branchOf(state: RouteState | undefined): string | null | undefined {
  const value = state?.branch
  if (value === undefined) return null
  if (value === NO_EPIC_BRANCH) return ''
  return typeof value === 'string' && WORK_ITEM_REFERENCE.test(value) ? value : undefined
}

/** The same state naming this branch of its chain, or none when `branch` is null. */
export function withBranch(state: RouteState | undefined, branch: string | null): RouteState {
  const rest = Object.fromEntries(Object.entries(state ?? {}).filter(([key]) => key !== 'branch'))
  return branch === null ? rest : { ...rest, branch: branch === '' ? NO_EPIC_BRANCH : branch }
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
  /**
   * The bound space is the primary store. The chain endpoint reads that store
   * alone, so a chain named in an attached one is refused rather than asked for.
   */
  primary: () => boolean
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
 * The chain the workspace's views are scoped to, if any.
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
 * the views show the whole space, while the route still names the chain and the
 * failure is held, so the operator can ask for it again or a reload can.
 */
export function usePlanningChainScope(options: ChainScopeOptions) {
  const chain = shallowRef<WorkItemChain | null>(null)
  const pending = shallowRef(false)
  const failure = shallowRef<ChainFailure | null>(null)
  /** The target the held chain answers, so a matching route needs no read. */
  const held = shallowRef('')
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
    failure.value = null
    chain.value = next
    held.value = next === null ? '' : key
  }

  async function read(
    target: Extract<ChainTarget, { status: 'chain' }>,
    key: string,
    first: boolean,
  ) {
    settle(chain.value, held.value)
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
      failure.value = { reference: target.reference, failure: typedFailure(error) }
    }
  }

  function follow() {
    const target = options.target()
    if (target.status === 'none') {
      if (held.value || pending.value || failure.value) settle(null)
      return
    }
    if (target.status === 'invalid') {
      settle(null)
      options.refused(target.reference, { kind: 'invalid' })
      return
    }
    const key = keyOf(target)
    if (key === held.value) return
    settle(null)
    // A reference is only meaningful once the route's space is bound, and
    // reading before that answers once for no space and again for the real one.
    if (options.space() === '') pending.value = true
    else if (options.primary()) void read(target, key, true)
    else options.refused(target.reference, { kind: 'primary' })
  }

  watch(() => JSON.stringify([options.space(), options.primary(), options.target()]), follow, {
    immediate: true,
  })
  watch(options.version, () => {
    const target = options.target()
    if (target.status === 'chain' && held.value !== '' && held.value === keyOf(target))
      void read(target, held.value, false)
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
     * The held chain, while the route still names that chain. Entering holds the
     * card's answer a moment before the route moves; a move the router refused
     * leaves the route on the whole space, and so does this. A route that names
     * another chain gets nothing until its own answer arrives, even in the tick
     * before the held one is dropped.
     */
    scoped: computed(() => {
      const target = options.target()
      return target.status === 'chain' && keyOf(target) === held.value ? chain.value : null
    }),
    /** True while a chain the route names is read for the first time. */
    pending,
    /** The first read of the chain the route names failed; the route keeps naming it. */
    failure,
    /** Read the chain the route names again, after a failed first read. */
    retry: () => {
      if (failure.value !== null) follow()
    },
    /** Hold the card's answer for the target the route is about to name. */
    enter: (next: WorkItemChain) =>
      settle(next, keyOf({ status: 'chain', reference: next.root.reference, scope: next.scope })),
  }
}
