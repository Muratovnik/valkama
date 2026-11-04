/**
 * The graph the field draws: what is laid out, and what is lit.
 *
 * The items and links arrive from the host rather than from a fetch of their
 * own. The Board era had this composable call the server, which meant the graph
 * and the board could disagree mid-refresh and two requests raced for one
 * screen; the neutral read model is fetched once above and all three views
 * project from that same answer.
 *
 * What remains here is the one race that is still real: every projection swap
 * resets the focus, because a hover id that survived one would light an
 * unrelated node.
 */

import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import {
  activeGraphFocus,
  createGraphFocus,
  reduceGraphFocus,
} from '@/widgets/work-item-graph/utils/graphFocus.ts'
import type {
  GraphFocusContext,
  GraphFocusEvent,
} from '@/widgets/work-item-graph/utils/graphFocus.ts'
import {
  doneCount,
  frontier,
  layout,
  neighborhood,
  unlinkedIds,
  workNodes,
} from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type {
  GraphLayout,
  GraphScope,
  GraphSource,
} from '@/widgets/work-item-graph/utils/graphLayout.ts'
import { createGraphLayoutRunner } from '@/widgets/work-item-graph/utils/graphLayoutRunner.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

/** What the host is showing, read fresh on every change. */
type ProjectionInput = () => {
  edges: GraphSource['edges']
  epicId: string | null
  nodes: GraphSource['nodes']
  open: boolean
  scopeKind: GraphScope['kind']
  space: string
  version: number
  /** The chain's member ids, in chain scope. */
  members?: readonly string[]
}

export type GraphProjection = {
  emptyOpen: ComputedRef<boolean>
  emptySpace: ComputedRef<boolean>
  failed: Ref<boolean>
  focusSet: ComputedRef<ReturnType<typeof neighborhood> | null>
  hiddenDone: ComputedRef<number>
  openTotal: ComputedRef<number>
  pending: Ref<boolean>
  placed: Ref<GraphLayout | null>
  ready: ComputedRef<WorkItemBrief[]>
  showDone: Ref<boolean>
  showUnlinked: Ref<boolean>
  /** Items with no drawn link, which the field leaves out unless asked. */
  unlinked: ComputedRef<number>
  applyFocus: (event: GraphFocusEvent) => void
  retry: () => void
}

export function useGraphProjection(
  input: ProjectionInput,
  selected: () => string | null = () => null,
  chainShowDone: Ref<boolean> = ref(false),
  branch: () => ReadonlySet<string> | null = () => null,
): GraphProjection {
  /**
   * Whether closed work is drawn, held once for the space and once for the
   * chain in view. A chain opens on its open part whatever the space was set to,
   * and leaving it gives the space back the filter it had: one flag for both made
   * the closed members asked for in a chain arrive in the whole space as "All".
   * The chain's flag is the host's — the address keeps it beside the chain, and
   * drops it when the chain is left or another named.
   */
  const spaceShowDone = ref(false)
  const inChain = () => input().scopeKind === 'chain'
  const showDone = computed({
    get: () => (inChain() ? chainShowDone.value : spaceShowDone.value),
    set: (value: boolean) => {
      if (inChain()) chainShowDone.value = value
      else spaceShowDone.value = value
    },
  })
  const showUnlinked = ref(false)
  const focus = ref<ReturnType<typeof createGraphFocus>>(
    createGraphFocus({ ...input(), showDone: false }),
  )

  const source = computed<GraphSource | null>(() => {
    const now = input()
    return now.open && now.space ? { nodes: now.nodes, edges: now.edges } : null
  })

  // The graph follows the epic rail: the selected scope decides what is drawn,
  // so the heading above and the field below never disagree.
  const scope = computed<GraphScope>(() => {
    const now = input()
    return now.scopeKind === 'chain'
      ? { kind: now.scopeKind, epicId: now.epicId, members: now.members ?? [] }
      : { kind: now.scopeKind, epicId: now.epicId }
  })

  // A chain is drawn whole, so it has nothing to leave out.
  const unlinkedSet = computed(() =>
    source.value && scope.value.kind !== 'chain'
      ? unlinkedIds(source.value, showDone.value, scope.value)
      : new Set<string>(),
  )
  /** What ELK is given: the source, less the unlinked items unless they were asked for. */
  const drawn = computed<GraphSource | null>(() => {
    const data = source.value
    if (!data || showUnlinked.value || unlinkedSet.value.size === 0) return data
    return {
      nodes: data.nodes.filter((node) => !unlinkedSet.value.has(node.work_item_id)),
      edges: data.edges,
    }
  })

  const focusContext = computed<GraphFocusContext>(() => ({
    ...input(),
    showDone: showDone.value,
  }))

  watch(
    () =>
      [
        focusContext.value.open,
        focusContext.value.space,
        focusContext.value.version,
        focusContext.value.scopeKind,
        focusContext.value.epicId,
        focusContext.value.showDone,
        showUnlinked.value,
      ] as const,
    () => {
      focus.value = reduceGraphFocus(focus.value, { type: 'reset', context: focusContext.value })
    },
  )

  const placed = shallowRef<GraphLayout | null>(null)
  const pending = ref(false)
  const failed = ref(false)
  const attempt = ref(0)
  let request = 0
  let context = ''
  // One worker for as long as the field is drawn, and a layout that never answers
  // is stopped, which ends that worker rather than leaving it running.
  const runner = createGraphLayoutRunner()
  let timeout: ReturnType<typeof setTimeout> | undefined
  onScopeDispose(() => {
    request += 1
    clearTimeout(timeout)
    runner.dispose()
  })

  watch(
    [drawn, scope, showDone, attempt],
    async () => {
      const current = ++request
      clearTimeout(timeout)
      runner.stop()
      const data = drawn.value
      const nextContext = JSON.stringify([
        input().space,
        scope.value,
        showDone.value,
        showUnlinked.value,
      ])
      if (!data || context !== nextContext) placed.value = null
      context = nextContext
      pending.value = Boolean(data)
      failed.value = false
      if (!data) return
      timeout = setTimeout(() => runner.stop(), 30_000)
      try {
        const result = await layout(data, runner, showDone.value, scope.value)
        if (request === current) placed.value = result
      } catch {
        if (request === current) failed.value = true
      } finally {
        if (request === current) {
          clearTimeout(timeout)
          pending.value = false
        }
      }
    },
    { immediate: true },
  )

  function retry() {
    attempt.value += 1
  }
  const scopedOpen = computed(() =>
    source.value ? workNodes(source.value, false, scope.value) : [],
  )
  const ready = computed(() => {
    if (!source.value) return []
    const workable = new Set(frontier(source.value).map((node) => node.work_item_id))
    return scopedOpen.value.filter((node) => workable.has(node.work_item_id))
  })
  const hiddenDone = computed(() => (source.value ? doneCount(source.value, scope.value) : 0))
  const openTotal = computed(() => scopedOpen.value.length)

  /**
   * Focus keeps the complete transitive lineage, including every branch and
   * cycle reachable through dependency/discovery edges. Unrelated work dims.
   *
   * A branch of the chain the card chose stays lit instead, with the links
   * inside it, until it is let go: the keyboard walking it keeps it lit, and
   * only a pointer resting on a node shows that node's lineage for a moment.
   */
  const focusSet = computed(() => {
    if (!placed.value) return null
    const pinned = branch()
    if (pinned && focus.value.active !== 'hover') {
      const edges = placed.value.edges.filter(
        (edge) => pinned.has(edge.source) && pinned.has(edge.target),
      )
      return { ids: new Set(pinned), edges: new Set(edges.map((edge) => edge.id)) }
    }
    const selection = selected()
    const selectedVisible = placed.value.nodes.some((node) => node.work_item_id === selection)
    const active = activeGraphFocus(focus.value) ?? (selectedVisible ? selection : null)
    return active === null ? null : neighborhood(placed.value.edges, active)
  })

  const emptySpace = computed(
    () => Boolean(source.value) && openTotal.value + hiddenDone.value === 0,
  )
  const emptyOpen = computed(
    () => Boolean(source.value) && !emptySpace.value && !showDone.value && openTotal.value === 0,
  )
  const unlinked = computed(() => unlinkedSet.value.size)

  function applyFocus(event: GraphFocusEvent) {
    focus.value = reduceGraphFocus(focus.value, event)
  }

  return {
    applyFocus,
    emptyOpen,
    emptySpace,
    focusSet,
    hiddenDone,
    openTotal,
    placed,
    pending,
    failed,
    retry,
    ready,
    showDone,
    showUnlinked,
    unlinked,
  }
}
