/**
 * The chain the Planning surface narrows its views to, as the route names it,
 * and what the surface does with it: enter it from the card, leave it, draw its
 * closed members, and tell the operator when it cannot be drawn.
 *
 * `usePlanningChainScope` answers which chain the route names and reads it; this
 * is the surface's half — every write here goes back through the route, so a
 * reload, a link and Back land on what the operator saw.
 */

import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  chainTarget,
  closedOf,
  usePlanningChainScope,
  withChain,
  withClosed,
} from '@/pages/planning/composables/usePlanningChainScope.ts'
import type {
  ChainFailure,
  ChainRefusal,
} from '@/pages/planning/composables/usePlanningChainScope.ts'

import type { ChainScope, WorkItemChain } from '@/shared/api/planningChainApi.ts'

type RouteState = Record<string, string | number | boolean>

interface ChainViewOptions {
  /** Close the open card the way the surface always does. */
  close: () => void
  /** Tell the operator something once. */
  notice: (message: string) => void
  /** The reference of the card the route has open, if any. */
  open: () => string | null
  primary: () => boolean
  space: () => string
  spaceItems: () => readonly { work_item_id: string }[] | null
  /** The module state the route holds. */
  state: () => RouteState | undefined
  version: () => number
  /** Replace the module state the route holds. */
  write: (state: RouteState) => void
}

/** Why a first read failed, in the words the operator gets; never the server's own. */
function failureCause(failure: ChainFailure['failure']): 'missing' | 'server' | 'unreachable' {
  // The server names a reference no item answers to by its code; its message is
  // for logs, and an operator is never told the server's own words.
  if (failure.code === 'not_found') return 'missing'
  const silent = failure.code === 'request_failed' || failure.code === 'request_timeout'
  return silent && failure.status === null ? 'unreachable' : 'server'
}

export function usePlanningChainView(options: ChainViewOptions) {
  const { t } = useI18n()

  /** What the operator is told about a chain the route named and this space will not show. */
  function refusalNotice(reference: string, why: ChainRefusal): string {
    if (why.kind === 'invalid') return t('graph.chainInvalid')
    // The card's own words, so the store a chain is missing from reads the same.
    if (why.kind === 'primary') return t('workItem.chain.primaryOnly')
    return t('graph.chainNotHere', { reference })
  }

  /**
   * The route named a chain this space will never show. It says so once and
   * drops the keys, so the field is the whole space and the address says the same.
   */
  function refuse(reference: string, why: ChainRefusal) {
    options.notice(refusalNotice(reference, why))
    options.write(withChain(options.state(), null))
  }

  const scope = usePlanningChainScope({
    target: () => chainTarget(options.state()),
    space: options.space,
    primary: options.primary,
    spaceItems: options.spaceItems,
    version: options.version,
    refused: refuse,
  })

  /**
   * A first read that failed, as the views show it: one sentence, and whether
   * asking again could help. The address keeps the chain meanwhile.
   */
  const failure = computed(() => {
    const held = scope.failure.value
    if (held === null) return null
    const cause = failureCause(held.failure)
    return {
      message: t(`graph.chainFailed.${cause}`, { reference: held.reference }),
      retryable: cause !== 'missing',
    }
  })

  /**
   * The chain the card asked to see, whose arrival in the route closes the
   * card. The route moves only once the router agrees, so closing in the same
   * tick would write the old state back over the chain.
   */
  let closeOnArrival = ''
  watch(options.state, (state) => {
    const reference = closeOnArrival
    closeOnArrival = ''
    const target = chainTarget(state)
    const arrived = target.status === 'chain' && target.reference === reference
    if (arrived && state?.view === 'graph' && options.open() !== null) options.close()
  })

  /** The card asked to see its chain: the graph, scoped to exactly that chain, with the card closed. */
  function show(chain: WorkItemChain) {
    scope.enter(chain)
    closeOnArrival = chain.root.reference
    options.write({
      ...withChain(options.state(), { reference: chain.root.reference, scope: chain.scope }),
      view: 'graph',
    })
  }

  return {
    chain: scope.scoped,
    pending: scope.pending,
    failure,
    retry: scope.retry,
    show,
    /** Narrow the views to a chain, or widen them back to the whole space. */
    narrow: (chain: { reference: string; scope: ChainScope } | null) =>
      options.write(withChain(options.state(), chain)),
    closed: computed(() => closedOf(options.state())),
    setClosed: (closed: boolean) => options.write(withClosed(options.state(), closed)),
  }
}
