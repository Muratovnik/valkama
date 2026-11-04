/**
 * The field as one Tab stop, as the board is.
 *
 * The stop is the target the keyboard last stood on while it is still drawn —
 * a card, or a frame header's fold or open button — and when a fold took it
 * off the field, the fold button of the frame that hides it; else the target
 * the camera is placed around. The arrows, Home and End walk the rest
 * (`graphWalk`), and the camera follows the keyboard to whatever it reaches.
 * Enter and Space are the target's own button: a card opens as a click opens
 * it, and hands focus back to the target it was opened from.
 *
 * A target's button carries `data-walk-target` with the target's id; a card
 * drawn without it is still found by its node.
 *
 * Vue Flow's own keyboard handling stays off (`disable-keyboard-a11y`): it
 * selects and moves nodes, which this field never does, and it told a screen
 * reader that every node could be moved with the arrows.
 */

import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import type { Ref } from 'vue'

import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import {
  foldOf,
  foldTarget,
  frameTarget,
  graphWalk,
  isGraphWalkKey,
  walkTargets,
} from '@/widgets/work-item-graph/utils/graphWalk.ts'
import type { Box, WalkTarget } from '@/widgets/work-item-graph/utils/graphWalk.ts'

/** How long a closing card may keep focus before the field stops waiting for it. */
const HANDOVER_MS = 2000

interface KeyboardInput {
  /** The target the camera is placed around, which the keyboard enters on. */
  anchorId: Ref<string | null>
  /** The frame the field's nodes are drawn in. */
  canvas: Readonly<Ref<HTMLElement | null>>
  /** The camera has framed the field. */
  fitted: Ref<boolean>
  /** Zoomed out past reading, where a header's fold is hidden and is no target. */
  overview: Ref<boolean>
  placed: Ref<GraphLayout | null>
  /** Moves each time the host asks the field to take focus once it is framed. */
  focusRequest: () => number | undefined
  /** Bring a target into sight, `margin` clear of the flow's edges. */
  reveal: (box: Box, margin?: number) => void
}

/** The target a button in the field stands for, or null for anything else. */
function targetOf(element: HTMLElement): string | null {
  const marked = element.dataset.walkTarget
  if (marked !== undefined) return marked
  if (!element.classList.contains('flow-node-card')) return null
  return element.closest<HTMLElement>('.vue-flow__node')?.dataset.id ?? null
}

/** The frames round a target, innermost first: where it goes when a fold hides it. */
function lineage(graph: GraphLayout, target: WalkTarget): string[] {
  const parents = new Map(graph.frames.map((frame) => [frame.id, frame.parentId]))
  const chain: string[] = []
  for (
    let at: string | null | undefined = target.frameId;
    at && !chain.includes(at);
    at = parents.get(at)
  )
    chain.push(at)
  return chain
}

export function useGraphKeyboard(input: KeyboardInput) {
  const current = ref<string | null>(null)
  /** The frames round the target the keyboard last stood on, innermost first. */
  let currentFrames: string[] = []
  /** The target the field is putting focus on itself, rather than the operator walking to it. */
  let placing: string | null = null
  const targets = computed(() =>
    input.placed.value ? walkTargets(input.placed.value, { overview: input.overview.value }) : [],
  )
  const placedNode = (id: string | null) =>
    id === null ? undefined : targets.value.find((target) => target.id === id)

  /** The epic's button beside a header's fold, while the fold itself is not drawn. */
  function besideFold(id: string | null): string | null {
    const frameId = id === null ? null : foldOf(id)
    const epic = frameId === null ? null : frameTarget(frameId)
    return epic !== null && placedNode(epic) ? epic : null
  }

  /**
   * The stop: the target the keyboard stood on, while drawn; a header's fold the
   * overview hides gives way to the epic's button beside it, and comes back at
   * reading size; once a fold hid the target, the fold button of the innermost
   * frame round it still drawn; else the anchor.
   */
  const tabStop = computed(() => {
    if (placedNode(current.value)) return current.value
    const beside = besideFold(current.value)
    if (beside) return beside
    const fold = currentFrames.map((frameId) => foldTarget(frameId)).find((id) => placedNode(id))
    return fold ?? input.anchorId.value
  })

  /** The stop focus was handed to when its own target stopped being drawn. */
  let handed: string | null = null
  /**
   * Focus on a target the field stops drawing — a fold the zoom hides, by the
   * wheel, «Zoom out» or «Fit whole graph» alike — moves to the stop before the
   * field hides it, and so never drops to the page. It is the field's own move:
   * the keyboard still stands where it stood, and the camera stays.
   */
  watch(targets, () => {
    const id = current.value
    if (id === null || placedNode(id)) return
    const button = nodeButton(id)
    const stop = tabStop.value
    if (!button || document.activeElement !== button || stop === null || stop === id) return
    handed = stop
    nodeButton(stop)?.focus({ preventScroll: true })
  })

  /** Remember where the keyboard stands, and the frames round it. */
  function standOn(id: string) {
    current.value = id
    const target = placedNode(id)
    const graph = input.placed.value
    if (target && graph) currentFrames = lineage(graph, target)
  }

  function nodeButton(id: string): HTMLElement | null {
    const canvas = input.canvas.value
    return (
      canvas?.querySelector<HTMLElement>(`[data-walk-target="${CSS.escape(id)}"]`) ??
      canvas?.querySelector<HTMLElement>(
        `.vue-flow__node[data-id="${CSS.escape(id)}"] .flow-node-card`,
      ) ??
      null
    )
  }

  /**
   * Move the keyboard to one node: the camera brings it into sight, then it
   * takes focus. False when it could not: Vue Flow keeps a node hidden until it
   * has measured it, and a hidden node takes no focus.
   */
  async function focusNode(id: string): Promise<boolean> {
    standOn(id)
    const node = placedNode(id)
    if (node) input.reveal(node)
    await nextTick()
    const button = nodeButton(id)
    // The camera placed it; the browser must not scroll the flow's clipped box to it too.
    button?.focus({ preventScroll: true })
    return button !== null && document.activeElement === button
  }

  function onKeydown(event: KeyboardEvent) {
    if (!isGraphWalkKey(event.key) || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target instanceof HTMLElement ? event.target : null
    const from = target ? targetOf(target) : null
    if (from === null || !input.placed.value) return
    // The keys walk the field and never reach Vue Flow, which would pan or move.
    event.preventDefault()
    const next = graphWalk(targets.value, from, event.key)
    if (next !== null && next !== from) void focusNode(next)
  }

  /**
   * A node took focus, by whatever means. It becomes the stop, and focus that
   * came by keyboard from elsewhere — Tab, or back from the card — lands on a
   * node the operator can see. False when the field put focus there itself on
   * arrival: that is where the operator is, not a node they walked to, so it
   * lights no lineage over what they asked to see.
   */
  function onFocus(id: string): boolean {
    if (handed === id) {
      handed = null
      return false
    }
    standOn(id)
    const node = placedNode(id)
    if (node && nodeButton(id)?.matches(':focus-visible')) input.reveal(node, 0)
    const placed = placing === id
    placing = null
    return !placed
  }

  /**
   * The card asked for the graph and closes, and focus would fall to the page.
   * Once the camera has framed what was asked for, focus takes the node it
   * stands on — as soon as the closing card lets focus go, which may be after
   * the framing. Focus that lands anywhere else, by the operator's hand or the
   * card's own return, stays where it landed.
   */
  const asked = ref(false)
  let frame = 0
  onScopeDispose(() => cancelAnimationFrame(frame))
  watch(
    input.focusRequest,
    (request) => {
      asked.value = Boolean(request)
    },
    { immediate: true },
  )

  async function handOver(anchor: string, until: number) {
    const active = document.activeElement
    const lost = active === null || active === document.body
    // Focus landed somewhere of its own: it stays there.
    if (!lost && !active.closest('.overlay-host')) return
    placing = lost ? anchor : null
    if (lost && (await focusNode(anchor))) return
    placing = null
    // Still inside the card that is closing, or the node not yet shown: wait.
    if (performance.now() < until) frame = requestAnimationFrame(() => void handOver(anchor, until))
  }

  watch([asked, input.fitted, input.placed], async () => {
    const anchor = input.anchorId.value
    if (!asked.value || !input.fitted.value || anchor === null) return
    asked.value = false
    await nextTick()
    cancelAnimationFrame(frame)
    await handOver(anchor, performance.now() + HANDOVER_MS)
  })

  return {
    /** Whether the target with this id is the field's one Tab stop. */
    isTabStop: (id: string) => id === tabStop.value,
    onKeydown,
    onFocus,
  }
}
