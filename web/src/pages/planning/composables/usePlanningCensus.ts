import { computed } from 'vue'

import { boardLanes } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardGrouping } from '@/widgets/work-item-views/utils/boardLanes.ts'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { inWorkQueue } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief, WorkQueue } from '@/shared/api/planningModel.ts'

/** What the workspace is showing, read fresh on every change. */
type CensusInput = () => {
  chain: WorkItemChain | null
  grouping: BoardGrouping
  queue: WorkQueue
  /** The search, trimmed and lower-cased; empty for none. */
  search: string
  space: WorkItemBrief[]
  view: 'graph' | 'kanban' | 'list'
}

/** Items the view on the stage leaves out of its own counts, and why. */
export type CensusExclusion =
  { count: number; kind: 'graph-parents'; open: number } | { count: number; kind: 'lane-heads' }

/**
 * The one population every number above the stage counts, and what each view
 * leaves out of it.
 *
 * The population is the chain's root and its members while a chain is named,
 * otherwise the whole space — every kind of item, whichever view is on the
 * stage. The chain chip, the counts line and the match count used to read three
 * different sets: the chain without its root, the chain with it, and in the graph
 * the whole space under a chip naming one chain, so one screen said 306, 307 and
 * 1081 about the same work. A view that draws fewer items than this says what it
 * leaves out instead of counting a set of its own.
 */
export function usePlanningCensus(input: CensusInput) {
  const counted = computed(() => {
    const { chain, space } = input()
    if (!chain) return space
    const members = new Set([chain.root.work_item_id, ...chain.members.map((m) => m.work_item_id)])
    return space.filter((item) => members.has(item.work_item_id))
  })
  /**
   * What the board or the list works over: the counted population. The graph
   * scopes itself and always takes the whole space, because its frontier and its
   * blockers reach outside the chain.
   */
  const scope = computed(() => (input().view === 'graph' ? input().space : counted.value))
  const filtered = computed(() => Boolean(input().search) || input().queue !== 'all')

  function matches(item: WorkItemBrief): boolean {
    const { queue, search } = input()
    return (
      inWorkQueue(item, queue) &&
      (!search ||
        item.reference.toLocaleLowerCase().includes(search) ||
        item.title.toLocaleLowerCase().includes(search))
    )
  }
  const visible = computed(() => scope.value.filter((item) => matches(item)))
  /** The counted items the queue and the search let through. */
  const matched = computed(() =>
    scope.value === counted.value ? visible.value : counted.value.filter((item) => matches(item)),
  )

  const counts = computed(() => {
    const items = counted.value
    return {
      total: items.length,
      open: items.filter((item) => !item.state.is_terminal).length,
      held: items.filter((item) => item.claim_ref !== '' && !item.state.is_terminal).length,
    }
  })

  /**
   * The board grouped by epic heads each lane with its epic, so its columns count
   * every item but those. The whole-space graph draws a parent as the group chip
   * on its children rather than as a node, so its open and all filters count every
   * item but the parents. A chain's graph draws its parents and leaves none out.
   * Under a filter both describe what the filter let through, as the views do.
   */
  const exclusion = computed<CensusExclusion | null>(() => {
    const { chain, grouping, space, view } = input()
    const items = filtered.value ? matched.value : counted.value
    if (view === 'kanban' && grouping === 'epic') {
      const tiles = boardLanes({
        filtered: filtered.value,
        scope: counted.value,
        space,
        visible: items,
      }).reduce((sum, lane) => sum + lane.items.length, 0)
      const heads = items.length - tiles
      return heads ? { kind: 'lane-heads', count: heads } : null
    }
    if (view === 'graph' && !chain) {
      const parents = items.filter((item) => item.container)
      if (!parents.length) return null
      const open = parents.filter((item) => !item.state.is_terminal).length
      return { kind: 'graph-parents', count: parents.length, open }
    }
    return null
  })

  return { counted, counts, exclusion, filtered, matched, scope, visible }
}
