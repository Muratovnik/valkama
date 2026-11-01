/**
 * The field as one Tab stop, as the board is.
 *
 * The stop is the node the keyboard last stood on while it is still drawn,
 * else the node the camera is placed around. The arrows, Home and End walk the
 * rest (`graphWalk`), and the camera follows the keyboard to whatever it
 * reaches. Enter is the node's own button, so it opens the card as a click
 * does; the card hands focus back to the node it was opened from.
 *
 * Vue Flow's own keyboard handling stays off (`disable-keyboard-a11y`): it
 * selects and moves nodes, which this field never does, and it told a screen
 * reader that every node could be moved with the arrows.
 */

import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import type { Ref } from 'vue'

import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import { graphWalk, isGraphWalkKey } from '@/widgets/work-item-graph/utils/graphWalk.ts'

/** How long a closing card may keep focus before the field stops waiting for it. */
const HANDOVER_MS = 2000

interface KeyboardInput {
  /** The node the camera is placed around, which the keyboard enters on. */
  anchorId: Ref<string | null>
  /** The frame the field's nodes are drawn in. */
  canvas: Readonly<Ref<HTMLElement | null>>
  /** The camera has framed the field. */
  fitted: Ref<boolean>
  placed: Ref<GraphLayout | null>
  /** Moves each time the host asks the field to take focus once it is framed. */
  focusRequest: () => number | undefined
  /** Bring a node into sight, `margin` clear of the flow's edges. */
  reveal: (node: PlacedNode, margin?: number) => void
}

export function useGraphKeyboard(input: KeyboardInput) {
  const current = ref<string | null>(null)
  /** The node the field is putting focus on itself, rather than the operator walking to it. */
  let placing: string | null = null
  const placedNode = (id: string | null) =>
    id === null ? undefined : input.placed.value?.nodes.find((node) => node.work_item_id === id)

  const tabStop = computed(() => (placedNode(current.value) ? current.value : input.anchorId.value))

  function nodeButton(id: string): HTMLElement | null {
    return (
      input.canvas.value?.querySelector<HTMLElement>(
        `.vue-flow__node[data-id="${CSS.escape(id)}"] .flow-node-card`,
      ) ?? null
    )
  }

  /**
   * Move the keyboard to one node: the camera brings it into sight, then it
   * takes focus. False when it could not: Vue Flow keeps a node hidden until it
   * has measured it, and a hidden node takes no focus.
   */
  async function focusNode(id: string): Promise<boolean> {
    current.value = id
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
    if (!target?.classList.contains('flow-node-card') || !input.placed.value) return
    const wrapper = target.closest<HTMLElement>('.vue-flow__node')
    const from = wrapper?.dataset.id
    if (from === undefined) return
    // The keys walk the field and never reach Vue Flow, which would pan or move.
    event.preventDefault()
    const next = graphWalk(input.placed.value.nodes, from, event.key)
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
    current.value = id
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
    isTabStop: (node: PlacedNode) => node.work_item_id === tabStop.value,
    onKeydown,
    onFocus,
  }
}
