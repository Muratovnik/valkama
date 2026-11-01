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

import { computed, nextTick, ref } from 'vue'
import type { Ref } from 'vue'

import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import { graphWalk, isGraphWalkKey } from '@/widgets/work-item-graph/utils/graphWalk.ts'

interface KeyboardInput {
  /** The node the camera is placed around, which the keyboard enters on. */
  anchorId: Ref<string | null>
  /** The frame the field's nodes are drawn in. */
  canvas: Readonly<Ref<HTMLElement | null>>
  placed: Ref<GraphLayout | null>
  /** Bring a node into sight, `margin` clear of the flow's edges. */
  reveal: (node: PlacedNode, margin?: number) => void
}

export function useGraphKeyboard(input: KeyboardInput) {
  const current = ref<string | null>(null)
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

  /** Move the keyboard to one node: the camera brings it into sight, then it takes focus. */
  async function focusNode(id: string) {
    current.value = id
    const node = placedNode(id)
    if (node) input.reveal(node)
    await nextTick()
    // The camera placed it; the browser must not scroll the flow's clipped box to it too.
    nodeButton(id)?.focus({ preventScroll: true })
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
   * node the operator can see.
   */
  function onFocus(id: string) {
    current.value = id
    const node = placedNode(id)
    if (node && nodeButton(id)?.matches(':focus-visible')) input.reveal(node, 0)
  }

  return {
    isTabStop: (node: PlacedNode) => node.work_item_id === tabStop.value,
    onKeydown,
    onFocus,
  }
}
