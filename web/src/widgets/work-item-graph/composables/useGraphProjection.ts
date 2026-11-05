/**
 * The graph the field draws: what is laid out, and what is lit.
 *
 * The items and links arrive from the host rather than from a fetch of their
 * own. The Board era had this composable call the server, which meant the graph
 * and the board could disagree mid-refresh and two requests raced for one
 * screen; the neutral read model is fetched once above and all three views
 * project from that same answer.
 *
 * A layout runs only when the field's structure changes — what is drawn, in
 * which frame, folded or not, and which lines join it (`graphFrames`). Every
 * agent's turn arrives as a new frame of the stream, and laying the field out
 * for each one moved nothing and cost a layout; so a state, a holder, live work
 * or a title is laid on the placed field by id instead (`drawn`), and `placed`
 * keeps the geometry the last layout gave.
 *
 * Focus is kept while what it lights is drawn: a hover that survived a change
 * of scope would light an unrelated node, so a new scope clears it, and a new
 * layout clears it only when its node is gone.
 */

import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { useGraphFrames } from '@/widgets/work-item-graph/composables/useGraphFrames.ts'
import {
  activeGraphFocus,
  createGraphFocus,
  reduceGraphFocus,
} from '@/widgets/work-item-graph/utils/graphFocus.ts'
import type {
  GraphFocusContext,
  GraphFocusEvent,
} from '@/widgets/work-item-graph/utils/graphFocus.ts'
import { frameProjection } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import type { FrameProjection } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import type { LiveWork, PlacedFrame } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import {
  doneCount,
  frontier,
  layout,
  neighborhood,
  workNodes,
} from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type {
  GraphLayout,
  GraphScope,
  GraphSource,
} from '@/widgets/work-item-graph/utils/graphLayout.ts'
import { createGraphLayoutRunner } from '@/widgets/work-item-graph/utils/graphLayoutRunner.ts'
import { layoutFrames } from '@/widgets/work-item-graph/utils/graphLayoutTree.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

/** What the host is showing, read fresh on every change. */
type ProjectionInput = () => {
  edges: GraphSource['edges']
  epicId: string | null
  /** What the field draws from: the whole space, or what a queue or search let through. */
  nodes: GraphSource['nodes']
  open: boolean
  scopeKind: GraphScope['kind']
  space: string
  version: number
  /** The server's `live_work`: the items an agent's session is working on now. */
  live?: Readonly<Record<string, LiveWork>>
  /** The chain's member ids, in chain scope. */
  members?: readonly string[]
  /**
   * The whole space, when `nodes` is what a filter let through: a frame counts
   * its epic's work, not the filter's.
   */
  spaceItems?: GraphSource['nodes']
}

export type GraphProjection = {
  /** The placed field with today's items, frames and links laid on it by id. */
  drawn: ComputedRef<GraphLayout | null>
  emptyOpen: ComputedRef<boolean>
  emptySpace: ComputedRef<boolean>
  failed: Ref<boolean>
  focusSet: ComputedRef<ReturnType<typeof neighborhood> | null>
  /** The drawn frames, with today's counts. */
  frames: ComputedRef<PlacedFrame[]>
  hiddenDone: ComputedRef<number>
  /** The card a pointer's hover holds, lit or behind the keyboard's focus. */
  hovered: ComputedRef<string | null>
  live: ComputedRef<Readonly<Record<string, LiveWork>>>
  openTotal: ComputedRef<number>
  pending: Ref<boolean>
  /** The geometry of the last layout; it changes only when a layout lands. */
  placed: Ref<GraphLayout | null>
  ready: ComputedRef<WorkItemBrief[]>
  showDone: Ref<boolean>
  applyFocus: (event: GraphFocusEvent) => void
  /** Whether a drawn frame is folded now. */
  folded: (frameId: string) => boolean
  retry: () => void
  /** Fold a drawn frame or open it; the choice is kept for the space. */
  toggle: (frameId: string) => void
}

/** Today's items, frames and links laid on a placed field by id; its geometry stays. */
function decorate(
  geometry: GraphLayout,
  items: ReadonlyMap<string, WorkItemBrief>,
  projection: FrameProjection | null,
): GraphLayout {
  const frames = new Map(projection?.frames.map((frame) => [frame.id, frame]))
  const lines = new Map(projection?.edges.map((edge) => [edge.id, edge]))
  return {
    ...geometry,
    nodes: geometry.nodes.map((node) => {
      const item = items.get(node.work_item_id)
      if (!item) return node
      const { x, y, width, height, frameId } = node
      return { ...item, x, y, width, height, frameId }
    }),
    frames: geometry.frames.map((frame) => {
      const now = frames.get(frame.id)
      return now
        ? { ...frame, epic: now.epic, progress: now.progress, members: now.members }
        : frame
    }),
    edges: geometry.edges.map((edge) => ({
      ...edge,
      links: lines.get(edge.id)?.links ?? edge.links,
    })),
  }
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
  const focus = ref<ReturnType<typeof createGraphFocus>>(
    createGraphFocus({ ...input(), showDone: false }),
  )
  const frameChoices = useGraphFrames(() => input().space)

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

  /**
   * What the filter let through, when the host named the whole space beside it.
   * The host hands a fresh array either way, so a filter is known by what it
   * left out; one that left nothing out narrows nothing.
   */
  const shown = computed(() => {
    const { nodes, spaceItems } = input()
    return spaceItems && spaceItems.length !== nodes.length
      ? new Set(nodes.map((node) => node.work_item_id))
      : null
  })
  const itemsById = computed(
    () => new Map((input().spaceItems ?? input().nodes).map((item) => [item.work_item_id, item])),
  )

  /** The whole space as frames; none in a chain, which keeps its flat drawing. */
  const projection = computed<FrameProjection | null>(() => {
    if (!source.value || scope.value.kind !== 'all') return null
    return frameProjection({
      items: input().spaceItems ?? source.value.nodes,
      links: source.value.edges,
      showDone: showDone.value,
      shown: shown.value,
      choices: frameChoices.choices.value,
    })
  })

  /** What a flat drawing depends on: its cards and the lines among them. */
  const flatKey = computed(() => {
    if (!source.value || projection.value) return ''
    const cards = workNodes(source.value, showDone.value, scope.value).map((n) => n.work_item_id)
    const present = new Set(cards)
    const lines = source.value.edges
      .filter((edge) => edge.kind !== 'parent' && present.has(edge.from) && present.has(edge.to))
      .map((edge) => `${edge.from}>${edge.to}:${edge.kind}`)
    return JSON.stringify([cards.sort(), lines.sort()])
  })

  /** The scope a layout belongs to: a new one leaves nothing of the last drawn. */
  const context = computed(() => JSON.stringify([input().space, scope.value, showDone.value]))
  /** Everything the geometry depends on; a layout runs when, and only when, it changes. */
  const structure = computed(() =>
    source.value ? `${context.value}|${projection.value?.key ?? flatKey.value}` : '',
  )

  const placed = shallowRef<GraphLayout | null>(null)
  const pending = ref(false)
  const failed = ref(false)
  const attempt = ref(0)
  let request = 0
  let placedContext = ''
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
    [structure, attempt],
    async () => {
      const current = ++request
      clearTimeout(timeout)
      runner.stop()
      const data = source.value
      if (!data || placedContext !== context.value) placed.value = null
      placedContext = context.value
      pending.value = Boolean(data)
      failed.value = false
      if (!data) return
      timeout = setTimeout(() => runner.stop(), 30_000)
      const frames = projection.value
      try {
        const result = frames
          ? await layoutFrames(frames, runner)
          : await layout(data, runner, showDone.value, scope.value)
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

  const drawn = computed(() =>
    placed.value ? decorate(placed.value, itemsById.value, projection.value) : null,
  )
  const frames = computed(() => drawn.value?.frames ?? [])

  const focusContext = computed<GraphFocusContext>(() => ({
    ...input(),
    showDone: showDone.value,
  }))
  const resetFocus = () => {
    focus.value = reduceGraphFocus(focus.value, { type: 'reset', context: focusContext.value })
  }
  // A different field: whatever was lit belongs to the last one. Each part is
  // a source of its own: one getter returning a fresh array would count every
  // new frame of the stream as a change.
  watch(
    [() => input().open, () => input().space, () => input().scopeKind, () => input().epicId],
    resetFocus,
  )
  // A new layout of the same field keeps what is lit while it is still drawn.
  watch(placed, (geometry) => {
    const lit = [focus.value.hovered, focus.value.focused].filter((id) => id !== null)
    const ids = new Set([
      ...(geometry?.nodes.map((node) => node.work_item_id) ?? []),
      ...(geometry?.frames.map((frame) => frame.id) ?? []),
    ])
    if (lit.some((id) => !ids.has(id))) resetFocus()
  })

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

  function applyFocus(event: GraphFocusEvent) {
    focus.value = reduceGraphFocus(focus.value, event)
  }

  const frameNow = (frameId: string) =>
    projection.value?.frames.find((frame) => frame.id === frameId)

  return {
    applyFocus,
    drawn,
    emptyOpen,
    emptySpace,
    failed,
    focusSet,
    folded: (frameId) => frameNow(frameId)?.folded ?? false,
    frames,
    hiddenDone,
    hovered: computed(() => focus.value.hovered),
    live: computed(() => input().live ?? {}),
    openTotal,
    pending,
    placed,
    ready,
    retry,
    showDone,
    toggle: (frameId) => {
      const frame = frameNow(frameId)
      if (frame?.foldable) frameChoices.toggle(frame, shown.value !== null)
    },
  }
}
