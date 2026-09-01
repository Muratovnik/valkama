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

import { computed, ref, watch } from 'vue'
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
  workNodes,
} from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphScope, GraphSource } from '@/widgets/work-item-graph/utils/graphLayout.ts'

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
}

export type GraphProjection = {
  emptyOpen: ComputedRef<boolean>
  emptySpace: ComputedRef<boolean>
  focusSet: ComputedRef<ReturnType<typeof neighborhood> | null>
  hiddenDone: ComputedRef<number>
  openTotal: ComputedRef<number>
  placed: ComputedRef<ReturnType<typeof layout> | null>
  ready: ComputedRef<WorkItemBrief[]>
  showDone: Ref<boolean>
  applyFocus: (event: GraphFocusEvent) => void
}

export function useGraphProjection(input: ProjectionInput): GraphProjection {
  const showDone = ref(false)
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
    return { kind: now.scopeKind, epicId: now.epicId }
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
      ] as const,
    () => {
      focus.value = reduceGraphFocus(focus.value, { type: 'reset', context: focusContext.value })
    },
  )

  const placed = computed(() =>
    source.value ? layout(source.value, showDone.value, scope.value) : null,
  )
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
    const active = activeGraphFocus(focus.value)
    if (!placed.value || active === null) return null
    return neighborhood(placed.value.edges, active)
  })

  const emptySpace = computed(
    () => Boolean(source.value) && openTotal.value + hiddenDone.value === 0,
  )
  const emptyOpen = computed(
    () => Boolean(source.value) && !emptySpace.value && !showDone.value && openTotal.value === 0,
  )

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
    ready,
    showDone,
  }
}
