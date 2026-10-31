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
import { createGraphLayoutEngine } from '@/widgets/work-item-graph/utils/graphLayoutEngine.ts'

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
): GraphProjection {
  const showDone = ref(false)
  const showUnlinked = ref(false)
  const focus = ref<ReturnType<typeof createGraphFocus>>(
    createGraphFocus({ ...input(), showDone: false }),
  )

  const source = computed<GraphSource | null>(() => {
    const now = input()
    if (!now.open || !now.space) return null
    return { nodes: now.nodes, edges: now.edges }
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
  let stopLayout: (() => void) | undefined
  onScopeDispose(() => {
    request += 1
    stopLayout?.()
  })

  watch(
    [drawn, scope, showDone, attempt],
    async () => {
      const current = ++request
      stopLayout?.()
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
      let engine: ReturnType<typeof createGraphLayoutEngine> | undefined
      let timeout: ReturnType<typeof setTimeout> | undefined
      const dispose = () => {
        clearTimeout(timeout)
        engine?.terminateWorker()
      }
      stopLayout = dispose
      try {
        engine = createGraphLayoutEngine()
        const expired = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Graph layout timed out')), 30_000)
        })
        const result = await Promise.race([
          layout(data, engine, showDone.value, scope.value),
          expired,
        ])
        if (request === current) placed.value = result
      } catch {
        if (request === current) failed.value = true
      } finally {
        dispose()
        if (request === current) pending.value = false
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
   */
  const focusSet = computed(() => {
    if (!placed.value) return null
    const selection = selected()
    const selectedVisible = placed.value.nodes.some((node) => node.work_item_id === selection)
    const active = activeGraphFocus(focus.value) ?? (selectedVisible ? selection : null)
    if (active === null) return null
    return neighborhood(placed.value.edges, active)
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
